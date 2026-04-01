/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import { OtpConfig, OtpRequestLog, PLATFORM_PRESETS } from './entities/otp-config.entity';
import { encrypt, decrypt } from '@common/utils/encryption.util';
import { SallaApiService } from '../stores/salla-api.service';
import { Store } from '../stores/entities/store.entity';

const IMAP_HOSTS: Record<string, string> = {
  'gmail.com': 'imap.gmail.com', 'hotmail.com': 'imap-mail.outlook.com',
  'outlook.com': 'imap-mail.outlook.com', 'live.com': 'imap-mail.outlook.com',
  'yahoo.com': 'imap.mail.yahoo.com', 'icloud.com': 'imap.mail.me.com',
};

@Injectable()
export class OtpRelayService {
  private readonly logger = new Logger(OtpRelayService.name);
  private readonly rateMap = new Map<string, number[]>();

  constructor(
    @InjectRepository(OtpConfig) private readonly configRepo: Repository<OtpConfig>,
    @InjectRepository(OtpRequestLog) private readonly logRepo: Repository<OtpRequestLog>,
    @InjectRepository(Store) private readonly storeRepo: Repository<Store>,
    private readonly sallaApi: SallaApiService,
  ) {}

  // ═══ ADMIN ═══════════════════════════════════════════════

  async getConfigs(tenantId: string, storeId: string): Promise<OtpConfig[]> {
    return this.configRepo.find({
      where: { tenantId, storeId } as any,
      order: { createdAt: 'DESC' } as any,
    });
  }

  async getConfig(id: string, tenantId: string): Promise<OtpConfig> {
    const c = await this.configRepo.findOne({ where: { id, tenantId } as any });
    if (!c) throw new NotFoundException('غير موجود');
    return c;
  }

  async createConfig(tenantId: string, storeId: string, data: any): Promise<OtpConfig> {
    const preset = PLATFORM_PRESETS[data.platform];
    if (preset && data.platform !== 'custom') {
      data.senderFilter = data.senderFilter || preset.senderEmail;
      data.subjectFilter = data.subjectFilter || preset.subjectContains;
      data.otpRegex = data.otpRegex || preset.otpRegex;
      data.otpLength = data.otpLength || preset.otpLength;
      data.needsUsername = preset.needsUsername;
      data.usernameLabel = data.usernameLabel || preset.usernameLabel;
    }
    if (!data.emailHost && data.emailUser) {
      const domain = data.emailUser.split('@')[1]?.toLowerCase();
      if (domain && IMAP_HOSTS[domain]) data.emailHost = IMAP_HOSTS[domain];
    }
    if (data.emailPassword) data.emailPassword = encrypt(data.emailPassword) || '';
    return this.configRepo.save(this.configRepo.create({ ...data, tenantId, storeId }));
  }

  async updateConfig(id: string, tenantId: string, data: any): Promise<OtpConfig> {
    const config = await this.getConfig(id, tenantId);
    if (data.emailPassword) data.emailPassword = encrypt(data.emailPassword) || '';
    else delete data.emailPassword;
    Object.assign(config, data);
    return this.configRepo.save(config);
  }

  async deleteConfig(id: string, tenantId: string): Promise<void> {
    await this.configRepo.softRemove(await this.getConfig(id, tenantId));
  }

  async testConnection(id: string, tenantId: string): Promise<{ success: boolean; message: string }> {
    const c = await this.configRepo
      .createQueryBuilder('c')
      .addSelect('c.emailPassword')
      .where('c.id = :id AND c.tenantId = :tenantId', { id, tenantId })
      .getOne();
    if (!c) throw new NotFoundException();
    const pw = decrypt(c.emailPassword);
    if (!pw) return { success: false, message: 'فشل فك تشفير كلمة المرور' };
    try {
      const imap = await this.openImap(c.emailHost, c.emailPort, c.emailUser, pw, c.emailTls);
      imap.end();
      return { success: true, message: 'تم الاتصال بنجاح ✅' };
    } catch (e: any) {
      return { success: false, message: `فشل: ${e?.message}` };
    }
  }

  // ═══ ANALYTICS ════════════════════════════════════════════

  async getAnalytics(id: string, tenantId: string, days = 7): Promise<any> {
    const config = await this.getConfig(id, tenantId);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const logs = await this.logRepo.find({
      where: { configId: id, createdAt: MoreThan(since) } as any,
      order: { createdAt: 'DESC' } as any,
      take: 100,
    });

    const daily: Record<string, { total: number; success: number; fail: number }> = {};
    logs.forEach((l: OtpRequestLog) => {
      const day = l.createdAt.toISOString().split('T')[0];
      if (!daily[day]) daily[day] = { total: 0, success: 0, fail: 0 };
      daily[day].total++;
      if (l.success) daily[day].success++;
      else daily[day].fail++;
    });

    return {
      config: {
        totalViews: config.totalViews,
        totalRequests: config.totalRequests,
        successCount: config.successCount,
        failCount: config.failCount,
        successRate: config.totalRequests > 0 ? Math.round(config.successCount / config.totalRequests * 100) : 0,
      },
      daily: Object.entries(daily).map(([date, d]) => ({ date, ...d })),
      recentLogs: logs.slice(0, 20),
    };
  }

  // ═══ PUBLIC ══════════════════════════════════════════════

  async getPublicPage(slug: string): Promise<any> {
    const c = await this.configRepo.findOne({ where: { slug, isActive: true } as any });
    if (!c) return null;
    await this.configRepo.increment({ id: c.id } as any, 'totalViews', 1);
    const preset = PLATFORM_PRESETS[c.platform];
    return {
      pageTitle: c.pageTitle, pageSubtitle: c.pageSubtitle, logoUrl: c.logoUrl,
      bgColor: c.bgColor, primaryColor: c.primaryColor, cardColor: c.cardColor,
      textColor: c.textColor, secondaryTextColor: c.secondaryTextColor,
      bgImageUrl: c.bgImageUrl, successMsg: c.successMsg,
      noCodeMsg: c.noCodeMsg, needsUsername: c.needsUsername, usernameLabel: c.usernameLabel,
      orderLabel: c.orderLabel, buttonText: c.buttonText, platform: c.platform,
      platformLabel: preset?.label || c.platform, platformIcon: preset?.icon || '🔑',
      verifyOrder: c.verifyOrder, footerText: c.footerText, showRafeqBadge: c.showRafeqBadge,
    };
  }

  async requestOtp(slug: string, orderNumber: string, username: string, clientIp: string): Promise<any> {
    const start = Date.now();
    const c = await this.configRepo
      .createQueryBuilder('c')
      .addSelect('c.emailPassword')
      .where('c.slug = :slug AND c.isActive = true', { slug })
      .getOne();
    if (!c) throw new NotFoundException('الخدمة غير متوفرة');

    this.checkRate(clientIp, c.rateLimit);
    await this.configRepo.increment({ id: c.id } as any, 'totalRequests', 1);

    const log: Partial<OtpRequestLog> = {
      configId: c.id, tenantId: c.tenantId, storeId: c.storeId,
      orderNumber, username, clientIp, success: false,
    };

    try {
      // ✅ التحقق من الطلب
      if (c.verifyOrder && orderNumber) {
        const store = await this.storeRepo
          .createQueryBuilder('s')
          .addSelect('s.accessToken')
          .where('s.id = :storeId AND s.deletedAt IS NULL', { storeId: c.storeId })
          .getOne();

        if (!store?.accessToken || store.platform !== 'salla') {
          throw new BadRequestException('تعذر التحقق من الطلب');
        }

        const token = decrypt(store.accessToken);
        if (!token) throw new BadRequestException('تعذر التحقق');

        this.logger.log(`🔑 Verifying order ${orderNumber} in store ${c.storeId}`);
        const order = await this.sallaApi.searchOrderByReference(token, orderNumber);
        if (!order) {
          throw new NotFoundException('رقم الطلب غير موجود. تأكد من الرقم وحاول مرة أخرى.');
        }
        this.logger.log(`🔑 ✅ Order verified: ref=${order.reference_id}`);
      }

      const pw = decrypt(c.emailPassword);
      if (!pw) throw new BadRequestException('خطأ في إعدادات الإيميل');

      this.logger.log(`🔑 OTP: slug=${slug}, platform=${c.platform}, order=${orderNumber}`);

      const code = await this.extractOtp(c, pw);

      if (!code) {
        log.success = false;
        await this.configRepo.increment({ id: c.id } as any, 'failCount', 1);
        log.responseMs = Date.now() - start;
        await this.logRepo.save(this.logRepo.create(log));
        throw new NotFoundException(c.noCodeMsg || 'لم يتم العثور على رمز جديد. أعد إرسال الرمز من المنصة وحاول بعد دقيقة.');
      }

      log.success = true;
      await this.configRepo.increment({ id: c.id } as any, 'successCount', 1);
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log));

      this.logger.log(`🔑 ✅ OTP found: slug=${slug}, code=***${code.slice(-2)}`);
      return { code, platform: PLATFORM_PRESETS[c.platform]?.label || c.platform, message: c.successMsg };
    } catch (e: any) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) throw e;
      log.errorMsg = e?.message;
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log)).catch(() => {});
      throw new BadRequestException(e?.message || 'حدث خطأ');
    }
  }

  // ═══ IMAP ═══════════════════════════════════════════════

  private openImap(host: string, port: number, user: string, pw: string, tls: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user, password: pw, host, port, tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 15000, authTimeout: 15000,
      });
      imap.once('ready', () => resolve(imap));
      imap.once('error', (err: Error) => reject(err));
      imap.connect();
    });
  }

  private async extractOtp(config: OtpConfig, pw: string): Promise<string | null> {
    let imap: any = null;
    try {
      imap = await this.openImap(config.emailHost, config.emailPort, config.emailUser, pw, config.emailTls);

      await new Promise<void>((res, rej) => {
        imap.openBox('INBOX', true, (err: Error | null) => err ? rej(err) : res());
      });

      // ✅ فقط رسائل آخر X دقائق
      const since = new Date();
      since.setMinutes(since.getMinutes() - (config.freshnessMinutes || 3));

      const criteria: any[] = [['SINCE', since]];
      if (config.senderFilter) criteria.push(['FROM', config.senderFilter]);
      if (config.subjectFilter) criteria.push(['SUBJECT', config.subjectFilter]);

      const uids: number[] = await new Promise((res, rej) => {
        imap.search(criteria, (err: Error | null, results: number[]) => {
          if (err) rej(err); else res(results || []);
        });
      });

      if (uids.length === 0) {
        this.logger.debug(`🔑 No fresh emails (last ${config.freshnessMinutes}min)`);
        imap.end();
        return null;
      }

      // أحدث رسالة
      const latestUid = uids[uids.length - 1];
      const email: ParsedMail | null = await new Promise((resolve, reject) => {
        const f = imap.fetch([latestUid], { bodies: '' });
        let done = false;
        f.on('message', (msg: any) => {
          msg.on('body', (stream: any) => {
            simpleParser(stream, (err: Error | null, parsed: ParsedMail) => {
              if (err) reject(err);
              else { done = true; resolve(parsed); }
            });
          });
        });
        f.once('error', (err: Error) => { if (!done) reject(err); });
        f.once('end', () => { if (!done) resolve(null); });
      });

      imap.end();
      if (!email) return null;

      // ✅ التحقق من عمر الرسالة
      if (email.date) {
        const emailAge = (Date.now() - new Date(email.date).getTime()) / 60000;
        if (emailAge > (config.freshnessMinutes || 3)) {
          this.logger.debug(`🔑 Email too old: ${emailAge.toFixed(1)}min`);
          return null;
        }
      }

      const body = (email.text || '') + ' ' + (email.html || '');
      const regexStr = config.otpRegex || PLATFORM_PRESETS[config.platform]?.otpRegex || '([A-Z0-9]{4,8})';
      const match = body.match(new RegExp(regexStr, 'i'));
      return match?.[1] || null;
    } catch (e: any) {
      this.logger.error(`🔑 IMAP error: ${e?.message}`);
      if (imap) try { imap.end(); } catch { /* cleanup */ }
      throw new BadRequestException(`فشل الاتصال بالإيميل: ${e?.message}`);
    }
  }

  private checkRate(ip: string, limit: number): void {
    const now = Date.now();
    const ts = (this.rateMap.get(ip) || []).filter((t: number) => now - t < 60000);
    if (ts.length >= limit) throw new ForbiddenException('تجاوزت الحد المسموح. انتظر دقيقة.');
    ts.push(now);
    this.rateMap.set(ip, ts);
  }

  getPlatforms(): any[] {
    return Object.entries(PLATFORM_PRESETS).map(([value, p]) => ({ value, ...p }));
  }
}
