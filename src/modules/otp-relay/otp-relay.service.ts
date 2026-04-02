/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { OtpConfig, OtpRequestLog, PLATFORM_PRESETS } from './entities/otp-config.entity';
import { encrypt, decrypt } from '@common/utils/encryption.util';
import { SallaApiService } from '../stores/salla-api.service';
import { Store } from '../stores/entities/store.entity';

// ✅ Dynamic require — لا يكسر البلد لو الحزم مو مثبتة بعد
let Imap: any;
let simpleParser: any;
try {
  Imap = require('imap');
  simpleParser = require('mailparser').simpleParser;
} catch {
  // Will throw at runtime when actually used, not at build time
}

const IMAP_HOSTS: Record<string, string> = {
  'gmail.com': 'imap.gmail.com', 'hotmail.com': 'imap-mail.outlook.com',
  'outlook.com': 'imap-mail.outlook.com', 'live.com': 'imap-mail.outlook.com',
  'yahoo.com': 'imap.mail.yahoo.com', 'icloud.com': 'imap.mail.me.com',
};

/** نتيجة استخراج الكود من الإيميل */
interface ExtractResult {
  code: string | null;
  emailUsername: string | null;
}

@Injectable()
export class OtpRelayService {
  private readonly logger = new Logger(OtpRelayService.name);
  private readonly rateMap = new Map<string, number[]>();

  private static readonly UPDATABLE_FIELDS = new Set([
    'slug', 'platform', 'pageTitle', 'pageSubtitle', 'logoUrl',
    'bgColor', 'primaryColor', 'cardColor', 'textColor', 'secondaryTextColor',
    'bgImageUrl', 'successMsg', 'noCodeMsg', 'needsUsername', 'usernameLabel',
    'orderLabel', 'buttonText', 'footerText', 'showRafeqBadge',
    'emailHost', 'emailPort', 'emailUser', 'emailPassword', 'emailTls',
    'senderFilter', 'subjectFilter', 'otpRegex', 'otpLength',
    'freshnessMinutes', 'verifyOrder', 'rateLimit', 'isActive',
    'usernameRegex',
  ]);

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
      data.usernameRegex = data.usernameRegex || preset.usernameRegex;
    }
    if (!data.emailHost && data.emailUser) {
      const domain = data.emailUser.split('@')[1]?.toLowerCase();
      if (domain && IMAP_HOSTS[domain]) data.emailHost = IMAP_HOSTS[domain];
    }
    if (data.emailPassword) data.emailPassword = encrypt(data.emailPassword) || '';
    const entity = this.configRepo.create();
    Object.assign(entity, data, { tenantId, storeId });
    return this.configRepo.save(entity);
  }

  async updateConfig(id: string, tenantId: string, data: any): Promise<OtpConfig> {
    const config = await this.getConfig(id, tenantId);

    if (data.emailPassword) {
      data.emailPassword = encrypt(data.emailPassword) || '';
    } else {
      delete data.emailPassword;
    }

    const safe: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if (OtpRelayService.UPDATABLE_FIELDS.has(key)) {
        safe[key] = data[key];
      }
    }

    Object.assign(config, safe);
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

  // ═══ OTP REQUEST — السيناريو الكامل ═══════════════════════
  //
  // 1. العميل يدخل رقم الطلب + اسم المستخدم
  // 2. التحقق من رقم الطلب موجود في متجر التاجر (Salla API)
  // 3. فتح إيميل التاجر عبر IMAP
  // 4. البحث عن آخر إيميل من المنصة (Steam مثلاً) خلال آخر X دقائق
  // 5. استخراج اسم المستخدم من الإيميل ومطابقته مع المدخل
  //    - مطابق → استخراج الكود وإرجاعه
  //    - غير مطابق → رفض: "اسم المستخدم غير مطابق"
  // 6. إذا ما في إيميل جديد → رفض: "أعد إرسال الرمز"

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
      // ═══ الخطوة 1: التحقق من رقم الطلب في متجر التاجر ═══
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

      // ═══ الخطوة 2: فتح الإيميل واستخراج الكود + اسم المستخدم ═══
      const pw = decrypt(c.emailPassword);
      if (!pw) throw new BadRequestException('خطأ في إعدادات الإيميل');

      this.logger.log(`🔑 OTP: slug=${slug}, platform=${c.platform}, order=${orderNumber}, username=${username}`);

      const result = await this.extractOtp(c, pw);

      // ═══ الخطوة 3: ما في إيميل جديد ═══
      if (!result.code) {
        log.success = false;
        await this.configRepo.increment({ id: c.id } as any, 'failCount', 1);
        log.responseMs = Date.now() - start;
        await this.logRepo.save(this.logRepo.create(log));
        throw new NotFoundException(c.noCodeMsg || 'لم يتم العثور على رمز جديد. أعد إرسال الرمز من المنصة وحاول بعد دقيقة.');
      }

      // ═══ الخطوة 4: مطابقة اسم المستخدم ═══
      if (c.needsUsername && username && result.emailUsername) {
        const inputUser = username.trim().toLowerCase();
        const emailUser = result.emailUsername.trim().toLowerCase();

        if (inputUser !== emailUser) {
          this.logger.warn(`🔑 ❌ Username mismatch: input="${username}" vs email="${result.emailUsername}"`);
          log.success = false;
          log.errorMsg = `username mismatch: input=${username}, email=${result.emailUsername}`;
          await this.configRepo.increment({ id: c.id } as any, 'failCount', 1);
          log.responseMs = Date.now() - start;
          await this.logRepo.save(this.logRepo.create(log));
          throw new BadRequestException('اسم المستخدم غير مطابق للحساب. تأكد من اسم المستخدم وحاول مرة أخرى.');
        }

        this.logger.log(`🔑 ✅ Username verified: "${username}"`);
      }

      // ═══ الخطوة 5: نجاح — إرجاع الكود ═══
      log.success = true;
      await this.configRepo.increment({ id: c.id } as any, 'successCount', 1);
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log));

      this.logger.log(`🔑 ✅ OTP found: slug=${slug}, code=***${result.code.slice(-2)}`);
      return { code: result.code, platform: PLATFORM_PRESETS[c.platform]?.label || c.platform, message: c.successMsg };
    } catch (e: any) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
      log.errorMsg = e?.message;
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log)).catch(() => {});
      throw new BadRequestException(e?.message || 'حدث خطأ');
    }
  }

  // ═══ IMAP ═══════════════════════════════════════════════

  private openImap(host: string, port: number, user: string, pw: string, tls: boolean): Promise<any> {
    if (!Imap) throw new BadRequestException('حزمة imap غير مثبتة — شغّل: npm install imap mailparser');
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

  // ✅ استخراج الكود + اسم المستخدم من الإيميل
  private async extractOtp(config: OtpConfig, pw: string): Promise<ExtractResult> {
    let imap: any = null;
    try {
      imap = await this.openImap(config.emailHost, config.emailPort, config.emailUser, pw, config.emailTls);
      this.logger.log(`🔑 IMAP connected: ${config.emailHost} (${config.emailUser})`);

      await new Promise<void>((res, rej) => {
        imap.openBox('INBOX', true, (err: Error | null) => err ? rej(err) : res());
      });

      const freshnessMin = config.freshnessMinutes || 3;
      const since = new Date();
      since.setMinutes(since.getMinutes() - freshnessMin);

      // ✅ بحث أولي: بدون فلاتر — فقط الرسائل الحديثة (تشخيص)
      const allRecent: number[] = await new Promise((res, rej) => {
        imap.search([['SINCE', since]], (err: Error | null, results: number[]) => {
          if (err) rej(err); else res(results || []);
        });
      });
      this.logger.log(`🔑 INBOX total recent (SINCE ${since.toISOString()}): ${allRecent.length} emails`);

      // ✅ بحث بالفلاتر الكاملة
      const criteria: any[] = [['SINCE', since]];
      if (config.senderFilter) criteria.push(['FROM', config.senderFilter]);
      if (config.subjectFilter) criteria.push(['SUBJECT', config.subjectFilter]);

      this.logger.log(`🔑 Search criteria: FROM="${config.senderFilter || '*'}" SUBJECT="${config.subjectFilter || '*'}" SINCE=${freshnessMin}min`);

      const uids: number[] = await new Promise((res, rej) => {
        imap.search(criteria, (err: Error | null, results: number[]) => {
          if (err) rej(err); else res(results || []);
        });
      });

      this.logger.log(`🔑 Filtered results: ${uids.length} emails matched`);

      if (uids.length === 0) {
        // ✅ إذا في إيميلات حديثة لكن الفلتر ما طابقها — نعرض آخر إيميل عشان التشخيص
        if (allRecent.length > 0) {
          try {
            const lastUid = allRecent[allRecent.length - 1];
            const peek: any = await new Promise((resolve, reject) => {
              const f = imap.fetch([lastUid], { bodies: 'HEADER.FIELDS (FROM SUBJECT DATE)', struct: false });
              let done = false;
              f.on('message', (msg: any) => {
                msg.on('body', (stream: any) => {
                  let buf = '';
                  stream.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
                  stream.on('end', () => { done = true; resolve(buf); });
                });
              });
              f.once('error', (err: Error) => { if (!done) reject(err); });
              f.once('end', () => { if (!done) resolve(null); });
            });
            if (peek) this.logger.log(`🔑 Last inbox email headers:\n${peek.trim()}`);
          } catch { /* ignore diagnostic errors */ }
        }
        imap.end();
        this.logger.log(`🔑 ❌ No matching emails found — returning null`);
        return { code: null, emailUsername: null };
      }

      // أحدث رسالة — نجلب الإيميل كاملاً أولاً ثم نحلله (يمنع race condition)
      const latestUid = uids[uids.length - 1];
      this.logger.log(`🔑 Fetching latest email: UID=${latestUid}`);

      const rawEmail: string = await new Promise((resolve, reject) => {
        const f = imap.fetch([latestUid], { bodies: '' });
        let buffer = '';
        f.on('message', (msg: any) => {
          msg.on('body', (stream: any) => {
            stream.on('data', (chunk: Buffer) => { buffer += chunk.toString(); });
          });
        });
        f.once('error', (err: Error) => reject(err));
        f.once('end', () => resolve(buffer));
      });

      imap.end();

      if (!rawEmail) {
        this.logger.log(`🔑 ❌ Empty email body for UID ${latestUid}`);
        return { code: null, emailUsername: null };
      }

      this.logger.log(`🔑 Raw email size: ${rawEmail.length} chars — parsing...`);
      const email = await simpleParser(rawEmail);

      if (!email) {
        this.logger.log(`🔑 ❌ simpleParser returned null`);
        return { code: null, emailUsername: null };
      }

      // التحقق من عمر الرسالة
      if (email.date) {
        const emailAge = (Date.now() - new Date(email.date).getTime()) / 60000;
        this.logger.log(`🔑 Email date: ${email.date} | Age: ${emailAge.toFixed(1)}min | Limit: ${config.freshnessMinutes || 3}min`);
        if (emailAge > (config.freshnessMinutes || 3)) {
          this.logger.log(`🔑 ❌ Email too old: ${emailAge.toFixed(1)}min > ${config.freshnessMinutes || 3}min`);
          return { code: null, emailUsername: null };
        }
      }

      const textBody = email.text || '';
      const fullBody = textBody + ' ' + (email.html || '');

      // ═══ الخطوة A: استخراج اليوزر نيم أولاً ═══
      let emailUsername: string | null = null;
      const usernameRegexStr = config.usernameRegex || PLATFORM_PRESETS[config.platform]?.usernameRegex;

      if (usernameRegexStr && config.needsUsername) {
        const usernameMatch = textBody.match(new RegExp(usernameRegexStr, 'im'));
        emailUsername = usernameMatch?.[1] || null;
        this.logger.log(`🔑 Username extraction: "${emailUsername}" (regex: ${usernameRegexStr})`);
      }

      // ═══ الخطوة B: استخراج كود التحقق — ذكاء متعدد الطبقات ═══
      //
      // المشكلة: اليوزر نيم مثل "naeto56987" فيه "56987" يطابق [A-Z0-9]{5}
      // الحل: 3 طبقات فلترة:
      //   1. تخطي إذا الكود جزء من اليوزر نيم
      //   2. تخطي إذا الكود أرقام فقط (أكواد Steam/Epic/Discord دائماً فيها حروف)
      //   3. تخطي إذا الكود حروف فقط بدون أرقام (لتأمين إضافي)
      //
      // أمثلة:
      //   "56987" → أرقام فقط → SKIP
      //   "naeto" → حروف فقط → SKIP  
      //   "HQ57D" → حروف + أرقام → VALID ✅
      //   "MR8TX" → حروف + أرقام → VALID ✅

      const otpRegexStr = config.otpRegex || PLATFORM_PRESETS[config.platform]?.otpRegex || '([A-Z0-9]{4,8})';
      let code: string | null = null;

      for (const body of [textBody, fullBody]) {
        const regex = new RegExp(otpRegexStr, 'g');
        let match: RegExpExecArray | null;
        while ((match = regex.exec(body)) !== null) {
          const candidate = match[1];

          // طبقة 1: تخطي إذا جزء من اليوزر نيم
          if (emailUsername && emailUsername.toLowerCase().includes(candidate.toLowerCase())) {
            this.logger.log(`🔑 Skip "${candidate}" — substring of username "${emailUsername}"`);
            continue;
          }

          // طبقة 2: تخطي إذا أرقام فقط (أكواد التحقق دائماً فيها حروف)
          if (/^\d+$/.test(candidate)) {
            this.logger.log(`🔑 Skip "${candidate}" — digits only (not a verification code)`);
            continue;
          }

          // طبقة 3: تخطي إذا حروف فقط بدون أرقام (أكواد التحقق عادةً مخلوطة)
          if (/^[A-Z]+$/i.test(candidate)) {
            this.logger.log(`🔑 Skip "${candidate}" — letters only (not a verification code)`);
            continue;
          }

          // ✅ الكود مخلوط (حروف + أرقام) ومو جزء من اليوزر = كود تحقق صحيح
          code = candidate;
          this.logger.log(`🔑 ✅ Valid OTP found: "${candidate}"`);
          break;
        }
        if (code) break;
      }

      this.logger.log(`🔑 Extract result: code=${code || 'NONE'}, username=${emailUsername || 'N/A'}`);
      return { code, emailUsername };
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
