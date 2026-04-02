/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { OtpConfig, OtpRequestLog, PLATFORM_PRESETS } from './entities/otp-config.entity';
import { encrypt, decrypt } from '@common/utils/encryption.util';
import { SallaApiService } from '../stores/salla-api.service';
import { Store } from '../stores/entities/store.entity';

let Imap: any;
let simpleParser: any;
try {
  Imap = require('imap');
  simpleParser = require('mailparser').simpleParser;
} catch {
  // Will throw at runtime when actually used
}

const IMAP_HOSTS: Record<string, string> = {
  'gmail.com': 'imap.gmail.com', 'googlemail.com': 'imap.gmail.com',
  'hotmail.com': 'imap-mail.outlook.com', 'outlook.com': 'imap-mail.outlook.com',
  'outlook.sa': 'imap-mail.outlook.com', 'live.com': 'imap-mail.outlook.com',
  'yahoo.com': 'imap.mail.yahoo.com', 'icloud.com': 'imap.mail.me.com',
};

interface ExtractResult {
  code: string | null;
  emailUsername: string | null;
}

/** الحقول المسموح تعديلها — whitelist مشتركة بين create + update */
const SAFE_FIELDS = new Set([
  'slug', 'platform', 'pageTitle', 'pageSubtitle', 'logoUrl',
  'bgColor', 'primaryColor', 'cardColor', 'textColor', 'secondaryTextColor',
  'bgImageUrl', 'successMsg', 'noCodeMsg', 'needsUsername', 'usernameLabel',
  'orderLabel', 'buttonText', 'footerText', 'showRafeqBadge',
  'emailHost', 'emailPort', 'emailUser', 'emailPassword', 'emailTls',
  'senderFilter', 'subjectFilter', 'otpRegex', 'otpLength',
  'freshnessMinutes', 'verifyOrder', 'rateLimit', 'isActive', 'usernameRegex',
]);

function pickSafe(data: Record<string, any>): Record<string, any> {
  const safe: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    if (SAFE_FIELDS.has(key)) safe[key] = data[key];
  }
  return safe;
}

@Injectable()
export class OtpRelayService {
  private readonly logger = new Logger(OtpRelayService.name);
  private readonly rateMap = new Map<string, number[]>();
  private lastRateCleanup = Date.now();

  constructor(
    @InjectRepository(OtpConfig) private readonly configRepo: Repository<OtpConfig>,
    @InjectRepository(OtpRequestLog) private readonly logRepo: Repository<OtpRequestLog>,
    @InjectRepository(Store) private readonly storeRepo: Repository<Store>,
    private readonly sallaApi: SallaApiService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // ADMIN
  // ═══════════════════════════════════════════════════════════

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
    const safe = pickSafe(data);
    const preset = PLATFORM_PRESETS[safe.platform];
    if (preset && safe.platform !== 'custom') {
      safe.senderFilter = safe.senderFilter || preset.senderEmail;
      safe.subjectFilter = safe.subjectFilter || preset.subjectContains;
      safe.otpRegex = safe.otpRegex || preset.otpRegex;
      safe.otpLength = safe.otpLength || preset.otpLength;
      safe.needsUsername = preset.needsUsername;
      safe.usernameLabel = safe.usernameLabel || preset.usernameLabel;
      safe.usernameRegex = safe.usernameRegex || preset.usernameRegex;
    }
    if (!safe.emailHost && safe.emailUser) {
      const domain = safe.emailUser.split('@')[1]?.toLowerCase();
      if (domain && IMAP_HOSTS[domain]) safe.emailHost = IMAP_HOSTS[domain];
    }
    if (safe.emailPassword) safe.emailPassword = encrypt(safe.emailPassword) || '';
    const entity = this.configRepo.create();
    Object.assign(entity, safe, { tenantId, storeId });
    return this.configRepo.save(entity);
  }

  async updateConfig(id: string, tenantId: string, data: any): Promise<OtpConfig> {
    const config = await this.getConfig(id, tenantId);
    const safe = pickSafe(data);
    if (safe.emailPassword) safe.emailPassword = encrypt(safe.emailPassword) || '';
    else delete safe.emailPassword;
    Object.assign(config, safe);
    return this.configRepo.save(config);
  }

  async deleteConfig(id: string, tenantId: string): Promise<void> {
    await this.configRepo.softRemove(await this.getConfig(id, tenantId));
  }

  async testConnection(id: string, tenantId: string): Promise<{ success: boolean; message: string }> {
    const c = await this.configRepo
      .createQueryBuilder('c').addSelect('c.emailPassword')
      .where('c.id = :id AND c.tenantId = :tenantId', { id, tenantId }).getOne();
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

  // ═══════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════

  async getAnalytics(id: string, tenantId: string, days = 7): Promise<any> {
    const config = await this.getConfig(id, tenantId);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const logs = await this.logRepo.find({
      where: { configId: id, createdAt: MoreThan(since) } as any,
      order: { createdAt: 'DESC' } as any, take: 100,
    });
    const daily: Record<string, { total: number; success: number; fail: number }> = {};
    logs.forEach((l: OtpRequestLog) => {
      const day = l.createdAt.toISOString().split('T')[0];
      if (!daily[day]) daily[day] = { total: 0, success: 0, fail: 0 };
      daily[day].total++;
      if (l.success) daily[day].success++; else daily[day].fail++;
    });
    return {
      config: {
        totalViews: config.totalViews, totalRequests: config.totalRequests,
        successCount: config.successCount, failCount: config.failCount,
        successRate: config.totalRequests > 0 ? Math.round(config.successCount / config.totalRequests * 100) : 0,
      },
      daily: Object.entries(daily).map(([date, d]) => ({ date, ...d })),
      recentLogs: logs.slice(0, 20),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC PAGE
  // ═══════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════
  // OTP REQUEST
  // ═══════════════════════════════════════════════════════════

  async requestOtp(slug: string, orderNumber: string, username: string, clientIp: string): Promise<any> {
    const start = Date.now();
    orderNumber = (orderNumber || '').trim();
    username = (username || '').trim();

    const c = await this.configRepo
      .createQueryBuilder('c').addSelect('c.emailPassword')
      .where('c.slug = :slug AND c.isActive = true', { slug }).getOne();
    if (!c) throw new NotFoundException('الخدمة غير متوفرة');

    this.checkRate(clientIp, c.rateLimit);
    await this.configRepo.increment({ id: c.id } as any, 'totalRequests', 1);

    const log: Partial<OtpRequestLog> = {
      configId: c.id, tenantId: c.tenantId, storeId: c.storeId,
      orderNumber, username, clientIp, success: false,
    };

    try {
      // ═══ Step 1: Validate username BEFORE any heavy work ═══
      if (c.needsUsername && !username) {
        log.errorMsg = 'username required but empty';
        await this.saveFailLog(log, c.id, start);
        throw new BadRequestException('يجب إدخال اسم المستخدم.');
      }

      // ═══ Step 2: Verify order (with retry for Salla 500s) ═══
      if (c.verifyOrder && orderNumber) {
        await this.verifyOrder(c.storeId, orderNumber);
      }

      // ═══ Step 3: IMAP → smart search → extract code ═══
      const pw = decrypt(c.emailPassword);
      if (!pw) throw new BadRequestException('خطأ في إعدادات الإيميل');

      this.logger.log(`🔑 OTP: slug=${slug}, user=${username}, order=${orderNumber}`);
      const result = await this.extractOtp(c, pw, username);

      // ═══ Step 4: No code found ═══
      if (!result.code) {
        log.errorMsg = `no code found for user "${username}"`;
        await this.saveFailLog(log, c.id, start);
        throw new NotFoundException(c.noCodeMsg || 'لم يتم العثور على رمز جديد. أعد إرسال الرمز من المنصة وحاول بعد دقيقة.');
      }

      // ═══ Step 5: Success ═══
      log.success = true;
      await this.configRepo.increment({ id: c.id } as any, 'successCount', 1);
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log));

      this.logger.log(`🔑 ✅ Delivered: user=${username}, code=***${result.code.slice(-2)}, ${Date.now() - start}ms`);
      return { code: result.code, platform: PLATFORM_PRESETS[c.platform]?.label || c.platform, message: c.successMsg };

    } catch (e: any) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
      log.errorMsg = e?.message;
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log)).catch(() => {});
      throw new BadRequestException(e?.message || 'حدث خطأ');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE: Verify Order (Salla with retry)
  // ═══════════════════════════════════════════════════════════

  private async verifyOrder(storeId: string, orderNumber: string): Promise<void> {
    const store = await this.storeRepo
      .createQueryBuilder('s').addSelect('s.accessToken')
      .where('s.id = :storeId AND s.deletedAt IS NULL', { storeId }).getOne();
    if (!store?.accessToken || store.platform !== 'salla') throw new BadRequestException('تعذر التحقق من الطلب');
    const token = decrypt(store.accessToken);
    if (!token) throw new BadRequestException('تعذر التحقق');

    let order: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        order = await this.sallaApi.searchOrderByReference(token, orderNumber);
        break;
      } catch (e: any) {
        if (attempt === 2 || e?.response?.status !== 500) throw e;
        this.logger.warn(`🔑 Salla 500 — retry ${attempt}/2`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (!order) throw new NotFoundException('رقم الطلب غير موجود. تأكد من الرقم وحاول مرة أخرى.');
    this.logger.log(`🔑 ✅ Order verified: ${orderNumber}`);
  }

  private async saveFailLog(log: Partial<OtpRequestLog>, configId: string, start: number): Promise<void> {
    log.success = false;
    log.responseMs = Date.now() - start;
    await this.configRepo.increment({ id: configId } as any, 'failCount', 1);
    await this.logRepo.save(this.logRepo.create(log)).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE: IMAP
  // ═══════════════════════════════════════════════════════════

  private openImap(host: string, port: number, user: string, pw: string, tls: boolean): Promise<any> {
    if (!Imap) throw new BadRequestException('حزمة imap غير مثبتة — npm install imap mailparser');
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

  private safeClose(imap: any): void {
    if (imap) try { imap.end(); } catch { /* already closed */ }
  }

  // ═══════════════════════════════════════════════════════════
  // FIX #1: جلب إيميل واحد بدون race condition
  //
  // الخطأ القديم: resolve على f.once('end') → الـ buffer ناقص
  // الإصلاح: resolve على stream.on('end') → الـ buffer كامل
  // + نجلب INTERNALDATE من attributes (وقت وصول الإيميل الحقيقي)
  // ═══════════════════════════════════════════════════════════

  private fetchOneEmail(imap: any, uid: number): Promise<{ raw: string; internalDate: Date | null }> {
    return new Promise((resolve, reject) => {
      const f = imap.fetch([uid], { bodies: '', struct: true });
      let raw = '';
      let internalDate: Date | null = null;
      let streamEnded = false;
      let attrsReceived = false;

      const tryResolve = () => {
        if (streamEnded && attrsReceived) resolve({ raw, internalDate });
      };

      f.on('message', (msg: any) => {
        msg.on('body', (stream: any) => {
          stream.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
          stream.on('end', () => { streamEnded = true; tryResolve(); });
        });
        msg.on('attributes', (attrs: any) => {
          internalDate = attrs.date || null; // IMAP INTERNALDATE
          attrsReceived = true;
          tryResolve();
        });
      });

      f.once('error', (err: Error) => reject(err));

      // Safety: إذا ما جا message event خلال 10 ثواني
      setTimeout(() => {
        if (!streamEnded) resolve({ raw, internalDate });
      }, 10000);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CORE: Smart OTP extraction
  //
  // FIX #1: fetchOneEmail بدون race condition
  // FIX #2: INTERNALDATE بدل Date header (دقة العمر)
  // FIX #3: extractCode يراعي نوع المنصة
  //
  // الفلو:
  //   1. IMAP SEARCH + BODY filter (server-side)
  //   2. Loop newest → oldest (max 5)
  //   3. fetchOneEmail (stream-end + INTERNALDATE)
  //   4. Age check via INTERNALDATE
  //   5. Username match
  //   6. Code extraction (platform-aware filter)
  // ═══════════════════════════════════════════════════════════

  private async extractOtp(config: OtpConfig, pw: string, requestedUsername?: string): Promise<ExtractResult> {
    let imap: any = null;
    try {
      imap = await this.openImap(config.emailHost, config.emailPort, config.emailUser, pw, config.emailTls);
      await new Promise<void>((res, rej) => {
        imap.openBox('INBOX', true, (err: Error | null) => err ? rej(err) : res());
      });

      const freshnessMin = config.freshnessMinutes || 3;
      const since = new Date();
      since.setMinutes(since.getMinutes() - freshnessMin);

      const usernameRegexStr = config.usernameRegex || PLATFORM_PRESETS[config.platform]?.usernameRegex;
      const otpRegexStr = config.otpRegex || PLATFORM_PRESETS[config.platform]?.otpRegex || '([A-Z0-9]{4,8})';
      const needsMatch = config.needsUsername && !!requestedUsername && !!usernameRegexStr;

      // ═══ IMAP SEARCH — server-side filtering ═══
      const criteria: any[] = [['SINCE', since]];
      if (config.senderFilter) criteria.push(['FROM', config.senderFilter]);
      if (config.subjectFilter) criteria.push(['SUBJECT', config.subjectFilter]);
      if (needsMatch) criteria.push(['BODY', requestedUsername!.trim()]);

      const uids: number[] = await new Promise((res, rej) => {
        imap.search(criteria, (err: Error | null, r: number[]) => err ? rej(err) : res(r || []));
      });

      this.logger.log(`🔑 IMAP: ${uids.length} emails${needsMatch ? ` matching "${requestedUsername}"` : ''} (last ${freshnessMin}min)`);
      if (uids.length === 0) { this.safeClose(imap); return { code: null, emailUsername: null }; }

      // ═══ Loop: newest → oldest (max 5) ═══
      const scanUids = uids.slice(-5).reverse();

      for (const uid of scanUids) {
        try {
          // FIX #1: جلب بدون race condition + INTERNALDATE
          const { raw, internalDate } = await this.fetchOneEmail(imap, uid);

          if (!raw || raw.length < 100) {
            this.logger.log(`🔑 UID=${uid} empty/tiny (${raw.length} chars)`);
            continue;
          }

          const email = await simpleParser(raw);
          if (!email) {
            this.logger.log(`🔑 UID=${uid} parse failed`);
            continue;
          }

          // FIX #2: استخدم INTERNALDATE (وقت وصول الإيميل) بدل Date header (وقت الإرسال)
          const checkDate = internalDate || email.date;
          if (checkDate) {
            const ageMin = (Date.now() - new Date(checkDate).getTime()) / 60000;
            if (ageMin > freshnessMin) {
              this.logger.log(`🔑 UID=${uid} too old: ${ageMin.toFixed(1)}min > ${freshnessMin}min (${internalDate ? 'INTERNALDATE' : 'Date header'})`);
              continue;
            }
          }

          const textBody = email.text || '';
          const fullBody = textBody + ' ' + (email.html || '');

          // استخراج اليوزر نيم
          let emailUser: string | null = null;
          if (usernameRegexStr) {
            const m = textBody.match(new RegExp(usernameRegexStr, 'im'));
            emailUser = m?.[1] || null;
          }

          // مطابقة اليوزر نيم
          if (needsMatch) {
            if (!emailUser || emailUser.toLowerCase() !== requestedUsername!.trim().toLowerCase()) {
              this.logger.log(`🔑 UID=${uid} user mismatch: "${emailUser}" ≠ "${requestedUsername}"`);
              continue;
            }
            this.logger.log(`🔑 UID=${uid} ✅ user: "${emailUser}"`);
          }

          // FIX #3: استخراج الكود — فلترة ذكية حسب نوع المنصة
          const code = this.extractCode(textBody, fullBody, otpRegexStr, emailUser);
          if (code) {
            this.safeClose(imap);
            this.logger.log(`🔑 ✅ Found: UID=${uid}, user="${emailUser}", code=***${code.slice(-2)}`);
            return { code, emailUsername: emailUser };
          }

          this.logger.log(`🔑 UID=${uid} user OK but no valid code (text: ${textBody.length} chars, regex: ${otpRegexStr})`);
        } catch (e: any) {
          this.logger.warn(`🔑 UID=${uid} error: ${e?.message}`);
          continue;
        }
      }

      this.safeClose(imap);
      this.logger.log(`🔑 ❌ No code found after scanning ${scanUids.length} emails`);
      return { code: null, emailUsername: null };
    } catch (e: any) {
      this.safeClose(imap);
      throw new BadRequestException(`فشل الاتصال بالإيميل: ${e?.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FIX #3: استخراج الكود — يراعي نوع المنصة
  //
  // لو needsUsername (Steam): فلترة 3 طبقات (تخطي أجزاء اليوزر + أرقام فقط + حروف فقط)
  // لو بدون username (Netflix/Discord): يرجع أول match مباشرة
  //
  // هذا يمنع فلتر "أرقام فقط" من كسر منصات الأرقام مثل Netflix (كود 1234)
  // ═══════════════════════════════════════════════════════════

  private extractCode(textBody: string, fullBody: string, regex: string, emailUsername: string | null): string | null {
    for (const body of [textBody, fullBody]) {
      const re = new RegExp(regex, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const candidate = m[1];

        // لو ما في يوزر نيم → أرجع أول match مباشرة (Netflix, Discord, Gmail, etc)
        if (!emailUsername) return candidate;

        // لو في يوزر نيم → فلترة ذكية عشان نميز الكود من أجزاء اليوزر
        // طبقة 1: تخطي إذا جزء من اليوزر نيم
        if (emailUsername.toLowerCase().includes(candidate.toLowerCase())) continue;
        // طبقة 2: تخطي أرقام فقط (أكواد Steam دائماً مخلوطة)
        if (/^\d+$/.test(candidate)) continue;
        // طبقة 3: تخطي حروف فقط
        if (/^[A-Z]+$/i.test(candidate)) continue;

        return candidate; // ✅ مخلوط حروف + أرقام ومو جزء من اليوزر
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // Rate limiter مع تنظيف تلقائي
  // ═══════════════════════════════════════════════════════════

  private checkRate(ip: string, limit: number): void {
    const now = Date.now();
    if (now - this.lastRateCleanup > 300_000) {
      this.lastRateCleanup = now;
      for (const [k, v] of this.rateMap.entries()) {
        if (v.every(t => now - t > 60000)) this.rateMap.delete(k);
      }
    }
    const ts = (this.rateMap.get(ip) || []).filter(t => now - t < 60000);
    if (ts.length >= limit) throw new ForbiddenException('تجاوزت الحد المسموح. انتظر دقيقة.');
    ts.push(now);
    this.rateMap.set(ip, ts);
  }

  getPlatforms(): any[] {
    return Object.entries(PLATFORM_PRESETS).map(([value, p]) => ({ value, ...p }));
  }
}
