import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository, MoreThan, Raw } from 'typeorm';
import Redis from 'ioredis';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { OtpConfig, OtpRequestLog, PLATFORM_PRESETS } from './entities/otp-config.entity';
import { encrypt, decrypt } from '@common/utils/encryption.util';
import { SallaApiService, SallaOrder } from '../stores/salla-api.service';
import { Store, StorePlatform } from '../stores/entities/store.entity';
import { Channel, ChannelType, ChannelStatus } from '../channels/entities/channel.entity';
import { WhatsAppBaileysService } from '../channels/whatsapp/whatsapp-baileys.service';
import { TelegramOtpClientService, PREDEFINED_BOT_FLOWS } from './telegram-otp-client.service';
import { CreateOtpRelayConfigDto, UpdateOtpRelayConfigDto } from './dto/otp-relay.dto';
import { getErrorMessage, getHttpErrorDetails } from '@common/utils/error.util';

const IMAP_HOSTS: Record<string, string> = {
  'gmail.com': 'imap.gmail.com', 'googlemail.com': 'imap.gmail.com',
  'hotmail.com': 'imap-mail.outlook.com', 'outlook.com': 'imap-mail.outlook.com',
  'outlook.sa': 'imap-mail.outlook.com', 'live.com': 'imap-mail.outlook.com',
  'yahoo.com': 'imap.mail.yahoo.com', 'icloud.com': 'imap.mail.me.com',
};

interface ExtractResult {
  code: string | null;
  emailUsername: string | null;
  reason?: 'no_email' | 'username_mismatch' | 'too_old' | 'no_code' | 'telegram_bot_failed';
}

interface OrderData {
  referenceId: string;
  customerName: string;
  customerPhone: string;
}

type OtpConfigChanges = Partial<CreateOtpRelayConfigDto>;

export interface OtpAnalyticsResult {
  config: {
    totalViews: number;
    totalRequests: number;
    successCount: number;
    failCount: number;
    successRate: number;
  };
  daily: Array<{ date: string; total: number; success: number; fail: number }>;
  recentLogs: OtpRequestLog[];
}

export interface OtpRequestResult {
  code: string;
  platform: string;
  message: string;
}

export interface OtpPlatformOption {
  value: string;
  label: string;
  icon: string;
  senderEmail: string;
  otpRegex: string;
  otpLength: number;
  freshnessMinutes?: number;
  needsUsername: boolean;
  usernameLabel: string;
  usernameRegex: string;
}

// ═══ القوالب الافتراضية ═══
const DEFAULT_EMPLOYEE_TEMPLATE = `🔑 طلب رمز تحقق

📦 رقم الطلب: #{رقم_الطلب}
👤 العميل: {اسم_العميل}
📱 هاتف العميل: {رقم_العميل}
🎮 حساب: {اسم_الحساب}

📊 المحاولة رقم: {رقم_المحاولة}`;

const DEFAULT_CUSTOMER_TEMPLATE = `✅ رمز التحقق الخاص بك:

🔐 {رمز_التفعيل}

📦 رقم الطلب: #{رقم_الطلب}
🎮 الحساب: {اسم_الحساب}

⚠️ لا تشارك هذا الرمز مع أي شخص`;

const SAFE_FIELDS = new Set([
  'slug', 'platform', 'pageTitle', 'pageSubtitle', 'logoUrl', 'logoSize',
  'bgColor', 'primaryColor', 'cardColor', 'textColor', 'secondaryTextColor',
  'bgImageUrl', 'successMsg', 'noCodeMsg', 'needsUsername', 'usernameLabel',
  'orderLabel', 'buttonText', 'footerText', 'showRafeqBadge',
  'emailHost', 'emailPort', 'emailUser', 'emailPassword', 'emailTls',
  'senderFilter', 'otpRegex', 'otpLength',
  'freshnessMinutes', 'verifyOrder', 'rateLimit', 'isActive', 'usernameRegex',
  'notifyEmployees', 'employeePhones', 'employeeEmails', 'employeeMsgTemplate',
  'sendCodeToCustomer', 'customerMsgTemplate',
  'maxCodesPerOrder',
  'otpMethod', 'telegramBotFlowId',
  'supportWhatsapp', 'supportDiscord', 'supportInstagram', 'supportTiktok', 'supportTwitter',
  'compensationEnabled', 'maxCompensationsPerOrder', 'compensationMethod',
  'compensationButtonText', 'compensationSuccessMsg', 'compensationEmptyMsg', 'compensationLimitMsg',
  'compensationNotifyEmployee', 'compensationEmployeeTemplate',
  'compensationNotifyCustomer', 'compensationCustomerTemplate',
]);

function pickSafe(data: object): OtpConfigChanges {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => SAFE_FIELDS.has(key)),
  ) as OtpConfigChanges;
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
    @InjectRepository(Channel) private readonly channelRepo: Repository<Channel>,
    private readonly sallaApi: SallaApiService,
    private readonly whatsapp: WhatsAppBaileysService,
    @Optional() private readonly telegramOtp: TelegramOtpClientService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  // ═══ ADMIN ═══════════════════════════════════════════════

  async getConfigs(tenantId: string, storeId: string): Promise<OtpConfig[]> {
    return this.configRepo.find({ where: { tenantId, storeId }, order: { createdAt: 'DESC' } });
  }

  async getConfig(id: string, tenantId: string): Promise<OtpConfig> {
    const c = await this.configRepo.findOne({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('غير موجود');
    return c;
  }

  async createConfig(tenantId: string, storeId: string, data: CreateOtpRelayConfigDto): Promise<OtpConfig> {
    const safe = pickSafe(data);
    const preset = safe.platform ? PLATFORM_PRESETS[safe.platform] : undefined;
    if (preset && safe.platform !== 'custom') {
      safe.senderFilter = safe.senderFilter || preset.senderEmail;
      safe.otpRegex = safe.otpRegex || preset.otpRegex;
      safe.otpLength = safe.otpLength || preset.otpLength;
      if (preset.freshnessMinutes) safe.freshnessMinutes = preset.freshnessMinutes;
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

  async updateConfig(id: string, tenantId: string, data: UpdateOtpRelayConfigDto): Promise<OtpConfig> {
    const config = await this.getConfig(id, tenantId);
    const safe = pickSafe(data);
    if (safe.emailPassword) safe.emailPassword = encrypt(safe.emailPassword) || '';
    else delete safe.emailPassword;

    // ✅ FIX: عند تغيير المنصة → إعادة تعيين الإعدادات للـ preset الجديد
    if (safe.platform && safe.platform !== config.platform) {
      const preset = PLATFORM_PRESETS[safe.platform];
      if (preset) {
        this.logger.log(`🔄 Platform changed: ${config.platform} → ${safe.platform} — resetting to preset`);
        safe.senderFilter = preset.senderEmail || '';
        safe.otpRegex = preset.otpRegex;
        safe.otpLength = preset.otpLength;
        if (preset.freshnessMinutes) safe.freshnessMinutes = preset.freshnessMinutes;
        safe.needsUsername = preset.needsUsername;
        safe.usernameLabel = preset.usernameLabel;
        safe.usernameRegex = preset.usernameRegex;
      }
    }

    // ✅ Telegram bot method always needs email (via username field)
    if ((safe.otpMethod || config.otpMethod) === 'telegram_bot') {
      safe.needsUsername = true;
      if (!safe.usernameLabel) safe.usernameLabel = 'البريد الإلكتروني';
    }

    Object.assign(config, safe);
    return this.configRepo.save(config);
  }

  async deleteConfig(id: string, tenantId: string): Promise<void> {
    await this.configRepo.softRemove(await this.getConfig(id, tenantId));
  }

  async testConnection(id: string, tenantId: string): Promise<{ success: boolean; message: string }> {
    const c = await this.configRepo.createQueryBuilder('c').addSelect('c.emailPassword')
      .where('c.id = :id AND c.tenantId = :tenantId', { id, tenantId }).getOne();
    if (!c) throw new NotFoundException();
    const pw = decrypt(c.emailPassword);
    if (!pw) return { success: false, message: 'فشل فك تشفير كلمة المرور' };
    try {
      const imap = await this.openImap(c.emailHost, c.emailPort, c.emailUser, pw, c.emailTls);
      await this.closeImap(imap);
      return { success: true, message: 'تم الاتصال بنجاح ✅' };
    } catch (error: unknown) {
      return { success: false, message: `فشل: ${getErrorMessage(error)}` };
    }
  }

  // ═══ ANALYTICS ═══════════════════════════════════════════

  async getAnalytics(id: string, tenantId: string, days = 7): Promise<OtpAnalyticsResult> {
    const config = await this.getConfig(id, tenantId);
    const since = new Date(); since.setDate(since.getDate() - days);
    const logs = await this.logRepo.find({ where: { configId: id, createdAt: MoreThan(since) }, order: { createdAt: 'DESC' }, take: 100 });
    const daily: Record<string, { total: number; success: number; fail: number }> = {};
    logs.forEach((l: OtpRequestLog) => {
      const day = l.createdAt.toISOString().split('T')[0];
      if (!daily[day]) daily[day] = { total: 0, success: 0, fail: 0 };
      daily[day].total++; if (l.success) daily[day].success++; else daily[day].fail++;
    });
    return {
      config: { totalViews: config.totalViews, totalRequests: config.totalRequests, successCount: config.successCount, failCount: config.failCount,
        successRate: config.totalRequests > 0 ? Math.round(config.successCount / config.totalRequests * 100) : 0 },
      daily: Object.entries(daily).map(([date, d]) => ({ date, ...d })),
      recentLogs: logs.slice(0, 20),
    };
  }

  // ═══ PUBLIC PAGE ═════════════════════════════════════════

  async getPublicPage(slug: string): Promise<Record<string, unknown> | null> {
    // أولاً: فحص بدون فلتر isActive لمعرفة إذا الرابط معطل بسبب انتهاء الاشتراك
    const anyConfig = await this.configRepo.findOne({ where: { slug } });
    if (!anyConfig) return null;

    if (!anyConfig.isActive) {
      // الرابط موجود لكن معطل — على الأغلب بسبب انتهاء الاشتراك
      return {
        suspended: true,
        message: 'هذه الخدمة متوقفة حالياً. يرجى التواصل مع صاحب المتجر.',
        pageTitle: anyConfig.pageTitle,
        logoUrl: anyConfig.logoUrl,
        bgColor: anyConfig.bgColor,
        cardColor: anyConfig.cardColor,
        textColor: anyConfig.textColor,
        primaryColor: anyConfig.primaryColor,
      };
    }

    const c = anyConfig;
    await this.configRepo.increment({ id: c.id }, 'totalViews', 1);
    const preset = PLATFORM_PRESETS[c.platform];
    return {
      pageTitle: c.pageTitle, pageSubtitle: c.pageSubtitle, logoUrl: c.logoUrl, logoSize: c.logoSize || 96,
      bgColor: c.bgColor, primaryColor: c.primaryColor, cardColor: c.cardColor,
      textColor: c.textColor, secondaryTextColor: c.secondaryTextColor,
      bgImageUrl: c.bgImageUrl, successMsg: c.successMsg,
      noCodeMsg: c.noCodeMsg, needsUsername: c.needsUsername, usernameLabel: c.usernameLabel,
      orderLabel: c.orderLabel, buttonText: c.buttonText, platform: c.platform,
      platformLabel: preset?.label || c.platform, platformIcon: preset?.icon || '🔑',
      verifyOrder: c.verifyOrder, footerText: c.footerText, showRafeqBadge: c.showRafeqBadge,
      supportWhatsapp: c.supportWhatsapp, supportDiscord: c.supportDiscord,
      supportInstagram: c.supportInstagram, supportTiktok: c.supportTiktok, supportTwitter: c.supportTwitter,
      // Compensation
      compensationEnabled: c.compensationEnabled || false,
      compensationMethod: c.compensationMethod || 'auto',
      compensationButtonText: c.compensationButtonText || 'طلب تعويض',
      otpMethod: c.otpMethod || 'email',
    };
  }

  // ═══ OTP REQUEST ═════════════════════════════════════════

  async requestOtp(slug: string, orderNumber: string, username: string, clientIp: string): Promise<OtpRequestResult> {
    const start = Date.now();
    orderNumber = (orderNumber || '').trim();
    username = (username || '').trim();

    const c = await this.configRepo.createQueryBuilder('c').addSelect('c.emailPassword')
      .where('c.slug = :slug AND c.isActive = true', { slug }).getOne();
    if (!c) throw new NotFoundException('الخدمة غير متوفرة');

    await this.checkRate(clientIp, slug, c.rateLimit);
    await this.configRepo.increment({ id: c.id }, 'totalRequests', 1);

    const log: Partial<OtpRequestLog> = {
      configId: c.id, tenantId: c.tenantId, storeId: c.storeId,
      orderNumber, username, clientIp, success: false,
    };

    try {
      // Step 1: Validate username
      if (c.needsUsername && !username) {
        log.errorMsg = 'username required';
        await this.saveFailLog(log, c.id, start);
        throw new BadRequestException('يجب إدخال اسم المستخدم.');
      }

      // Step 2: Verify order + get customer data
      let orderData: OrderData | null = null;
      if (c.verifyOrder && orderNumber) {
        orderData = await this.verifyOrder(c.storeId, orderNumber);
      }

      // Step 2.5: Check order code limit (before IMAP to save resources)
      // ✅ الحد يتحقق بـ order + username — طلب واحد فيه عدة حسابات، كل حساب له حده
      if (c.maxCodesPerOrder > 0 && orderNumber) {
        const where: FindOptionsWhere<OtpRequestLog> = { configId: c.id, orderNumber, success: true };
        if (c.needsUsername && username) {
          where.username = Raw(alias => `LOWER(${alias}) = LOWER(:uname)`, { uname: username });
        }

        const usedCount = await this.logRepo.count({ where });
        if (usedCount >= c.maxCodesPerOrder) {
          log.errorMsg = `order limit reached: ${usedCount}/${c.maxCodesPerOrder} (user=${username || 'N/A'})`;
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException(
            c.maxCodesPerOrder === 1
              ? 'سبق وتم إعطاؤك رمز التفعيل لهذا الحساب. يرجى التواصل مع الدعم.'
              : `تم استخدام الحد المسموح (${c.maxCodesPerOrder} رموز) لهذا الحساب في هذا الطلب. يرجى التواصل مع الدعم.`,
          );
        }
      }

      // Step 3: Extract OTP — Email or Telegram Bot
      let result: ExtractResult;

      if (c.otpMethod === 'telegram_bot') {
        if (!c.telegramBotFlowId) {
          log.errorMsg = 'telegram bot not configured';
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException('يوجد خلل في الإعدادات. تواصل مع الدعم.');
        }
        // ── Telegram Bot method ──
        if (!this.telegramOtp?.isAvailable()) {
          log.errorMsg = 'telegram client not available';
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException('يوجد خلل مؤقت. حاول لاحقاً أو تواصل مع الدعم.');
        }

        const flowDef = PREDEFINED_BOT_FLOWS[c.telegramBotFlowId];
        if (!flowDef) {
          log.errorMsg = `unknown flow: ${c.telegramBotFlowId}`;
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException('يوجد خلل في الإعدادات. تواصل مع الدعم.');
        }

        const email = username; // في Telegram method، اليوزرنيم = الإيميل
        if (!email) {
          log.errorMsg = 'email required for telegram bot';
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException('يرجى إدخال البريد الإلكتروني');
        }

        this.logger.log(`🤖 OTP via Telegram: slug=${slug}, bot=@${flowDef.botUsername}, email=${email.slice(0, 3)}***`);
        const flow = flowDef.buildFlow(email);
        const botResult = await this.telegramOtp.executeBotFlow(flowDef.botUsername, flow);

        result = {
          code: botResult.success ? botResult.code! : null,
          emailUsername: email,
          reason: botResult.success ? undefined : 'telegram_bot_failed',
        };
      } else {
        // ── Email IMAP method (default) ──
        const pw = decrypt(c.emailPassword);
        if (!pw) throw new BadRequestException('خطأ في إعدادات الإيميل');
        this.logger.log(`🔑 OTP via Email: slug=${slug}, user=${username}, order=${orderNumber}`);
        result = await this.extractOtp(c, pw, username);
      }

      // Step 4: Handle failure
      if (!result.code) {
        if (result.reason === 'username_mismatch') {
          log.errorMsg = `username mismatch: "${username}"`;
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException('اسم المستخدم غير مطابق للحساب. تأكد من اسم المستخدم وحاول مرة أخرى.');
        }
        if (result.reason === 'telegram_bot_failed') {
          log.errorMsg = `telegram bot failed`;
          await this.saveFailLog(log, c.id, start);
          throw new BadRequestException('يوجد خلل في استخراج الكود. تواصل مع الدعم.');
        }
        log.errorMsg = `no code (${result.reason || 'unknown'})`;
        await this.saveFailLog(log, c.id, start);
        throw new NotFoundException(c.noCodeMsg || 'لم يتم العثور على رمز جديد. أعد إرسال الرمز من المنصة وحاول بعد دقيقة.');
      }

      // Step 5: Success — save log
      log.success = true;
      await this.configRepo.increment({ id: c.id }, 'successCount', 1);
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log));
      this.logger.log(`🔑 ✅ Delivered: user=${username}, code=***${result.code.slice(-2)}, ${Date.now() - start}ms`);

      // Step 6: Fire-and-forget WhatsApp notifications
      this.sendNotifications(c, orderNumber, username, result.code, orderData).catch((error: unknown) =>
        this.logger.error(`🔑 Notification error: ${getErrorMessage(error)}`),
      );

      return { code: result.code, platform: PLATFORM_PRESETS[c.platform]?.label || c.platform, message: c.successMsg };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      const message = getErrorMessage(error);
      log.errorMsg = message;
      log.responseMs = Date.now() - start;
      await this.logRepo.save(this.logRepo.create(log)).catch(() => {});
      throw new BadRequestException(message || 'حدث خطأ');
    }
  }

  // ═══ WHATSAPP NOTIFICATIONS ═══════════════════════════════

  private async sendNotifications(config: OtpConfig, orderNumber: string, username: string, code: string, orderData: OrderData | null): Promise<void> {
    const channelId = await this.findWhatsAppChannel(config.storeId);
    if (!channelId) {
      this.logger.warn(`🔑 No WhatsApp channel for store ${config.storeId} — skipping notifications`);
      return;
    }

    // عدد المحاولات السابقة الناجحة لنفس الطلب + اليوزر
    const attemptCount = await this.getAttemptCount(config.id, orderNumber, username);

    const vars: Record<string, string> = {
      '{رقم_الطلب}': orderNumber || '',
      '{اسم_العميل}': orderData?.customerName || 'عميل',
      '{رقم_العميل}': orderData?.customerPhone || '',
      '{اسم_الحساب}': username || '',
      '{رمز_التفعيل}': code,
      '{رقم_المحاولة}': String(attemptCount),
    };

    // ═══ إشعار الموظفين ═══
    if (config.notifyEmployees && config.employeePhones) {
      const template = config.employeeMsgTemplate || DEFAULT_EMPLOYEE_TEMPLATE;
      const message = this.renderTemplate(template, vars);
      const phones = String(config.employeePhones).split(',').map(p => p.trim().replace(/[^0-9+]/g, '')).filter(p => p.length >= 9);

      for (const phone of phones) {
        try {
          await this.whatsapp.sendTextMessage(channelId, phone, message);
          this.logger.log(`🔑 📤 Employee notified: ${phone.slice(-4)}`);
        } catch (error: unknown) {
          this.logger.warn(`🔑 ❌ Failed to notify ${phone.slice(-4)}: ${getErrorMessage(error)}`);
        }
      }
    }

    // ═══ إرسال الكود للعميل ═══
    if (config.sendCodeToCustomer && orderData?.customerPhone) {
      const template = config.customerMsgTemplate || DEFAULT_CUSTOMER_TEMPLATE;
      const message = this.renderTemplate(template, vars);
      const phone = String(orderData.customerPhone).replace(/[^0-9+]/g, '');

      if (phone.length >= 9) {
        try {
          await this.whatsapp.sendTextMessage(channelId, phone, message);
          this.logger.log(`🔑 📤 OTP sent to customer: ${phone.slice(-4)}`);
        } catch (error: unknown) {
          this.logger.warn(`🔑 ❌ Failed to send OTP to customer: ${getErrorMessage(error)}`);
        }
      } else {
        this.logger.warn(`🔑 ⚠️ Invalid customer phone: "${orderData.customerPhone}" — skipping`);
      }
    }
  }

  private renderTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(key, value);
    }
    return result;
  }

  private async getAttemptCount(configId: string, orderNumber: string, username: string): Promise<number> {
    const where: FindOptionsWhere<OtpRequestLog> = { configId, orderNumber, success: true };
    if (username) {
      where.username = Raw(alias => `LOWER(${alias}) = LOWER(:uname)`, { uname: username });
    }
    return this.logRepo.count({ where });
  }

  private async findWhatsAppChannel(storeId: string): Promise<string | null> {
    const channel = await this.channelRepo.findOne({
      where: { storeId, type: ChannelType.WHATSAPP_QR, status: ChannelStatus.CONNECTED },
    });
    return channel?.id || null;
  }

  // ═══ ORDER VERIFICATION (returns customer data) ═════════

  private async verifyOrder(storeId: string, orderNumber: string): Promise<OrderData> {
    const store = await this.storeRepo.createQueryBuilder('s').addSelect('s.accessToken')
      .where('s.id = :storeId AND s.deletedAt IS NULL', { storeId }).getOne();
    if (!store?.accessToken || store.platform !== StorePlatform.SALLA) throw new BadRequestException('تعذر التحقق من الطلب');
    const token = decrypt(store.accessToken);
    if (!token) throw new BadRequestException('تعذر التحقق');

    let order: SallaOrder | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { order = await this.sallaApi.searchOrderByReference(token, orderNumber); break; }
      catch (error: unknown) {
        if (attempt === 2 || getHttpErrorDetails(error).status !== 500) throw error;
        this.logger.warn(`🔑 Salla 500 — retry`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (!order) throw new NotFoundException('رقم الطلب غير موجود. تأكد من الرقم وحاول مرة أخرى.');
    this.logger.log(`🔑 ✅ Order verified: ${orderNumber}`);

    return {
      referenceId: order.reference_id,
      customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim() || 'عميل',
      customerPhone: String(order.customer?.mobile || order.shipping?.receiver?.phone || '').replace(/[^0-9+]/g, ''),
    };
  }

  private async saveFailLog(log: Partial<OtpRequestLog>, configId: string, start: number): Promise<void> {
    log.success = false; log.responseMs = Date.now() - start;
    await this.configRepo.increment({ id: configId }, 'failCount', 1);
    await this.logRepo.save(this.logRepo.create(log)).catch(() => {});
  }

  // ═══ IMAP ═══════════════════════════════════════════════

  private async openImap(host: string, port: number, user: string, password: string, tls: boolean): Promise<ImapFlow> {
    const client = new ImapFlow({
      host,
      port,
      secure: tls,
      auth: { user, pass: password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      logger: false,
    });

    await client.connect();
    return client;
  }

  private async closeImap(client: ImapFlow | null): Promise<void> {
    if (!client) return;

    try {
      if (client.usable) await client.logout();
      else client.close();
    } catch {
      client.close();
    }
  }

  private async fetchOneEmail(client: ImapFlow, uid: number): Promise<{ raw: string; internalDate: Date | null }> {
    const message = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
    if (!message) return { raw: '', internalDate: null };

    const internalDate = message.internalDate
      ? new Date(message.internalDate)
      : null;

    return {
      raw: message.source?.toString() || '',
      internalDate: Number.isNaN(internalDate?.getTime()) ? null : internalDate,
    };
  }

  // ═══ CORE: Smart OTP extraction ═════════════════════════

  private async extractOtp(config: OtpConfig, pw: string, requestedUsername?: string): Promise<ExtractResult> {
    let imap: ImapFlow | null = null;
    let mailboxLock: { release(): void } | null = null;
    try {
      imap = await this.openImap(config.emailHost, config.emailPort, config.emailUser, pw, config.emailTls);
      mailboxLock = await imap.getMailboxLock('INBOX', { readOnly: true });

      const freshnessMin = config.freshnessMinutes || 3;
      const since = new Date(); since.setMinutes(since.getMinutes() - freshnessMin);
      const usernameRegexStr = config.usernameRegex || PLATFORM_PRESETS[config.platform]?.usernameRegex;
      const otpRegexStr = config.otpRegex || PLATFORM_PRESETS[config.platform]?.otpRegex || '([A-Z0-9]{4,8})';
      const needsMatch = config.needsUsername && !!requestedUsername && !!usernameRegexStr;

      // ✅ IMAP SEARCH — بدون BODY filter لأن بعض السيرفرات حساسة لحالة الأحرف
      // المطابقة تتم في الكود (case-insensitive) بعد جلب الإيميلات
      const criteria: { since: Date; from?: string } = { since };
      if (config.senderFilter) criteria.from = config.senderFilter;

      const uids = (await imap.search(criteria, { uid: true })) || [];

      this.logger.log(`🔑 IMAP: ${uids.length} emails (last ${freshnessMin}min)${needsMatch ? `, will match "${requestedUsername}" in code` : ''}`);

      if (uids.length === 0) return { code: null, emailUsername: null, reason: 'no_email' };

      const scanUids = uids.slice(-10).reverse();
      let hadUserMismatch = false;
      for (const uid of scanUids) {
        try {
          const { raw, internalDate } = await this.fetchOneEmail(imap, uid);
          if (!raw || raw.length < 100) { this.logger.log(`🔑 UID=${uid} empty`); continue; }
          const email = await simpleParser(raw);
          if (!email) continue;

          const checkDate = internalDate || email.date;
          if (checkDate && (Date.now() - new Date(checkDate).getTime()) / 60000 > freshnessMin) {
            this.logger.log(`🔑 UID=${uid} too old`); continue;
          }

          const textBody = email.text || '';
          const fullBody = textBody + ' ' + (email.html || '');

          // Username extraction (text → HTML fallback)
          let emailUser: string | null = null;
          if (usernameRegexStr) {
            let m = textBody.match(new RegExp(usernameRegexStr, 'im'));
            if (!m) { const safe = usernameRegexStr.replace(/^\^/, ''); m = fullBody.match(new RegExp(safe, 'im')); }
            emailUser = m?.[1] || null;
          }

          if (needsMatch) {
            if (!emailUser || emailUser.toLowerCase() !== requestedUsername!.trim().toLowerCase()) {
              this.logger.log(`🔑 UID=${uid} user mismatch: "${emailUser}" ≠ "${requestedUsername}"`);
              hadUserMismatch = true;
              continue;
            }
            this.logger.log(`🔑 UID=${uid} ✅ user: "${emailUser}"`);
          }

          const code = this.extractCode(textBody, fullBody, otpRegexStr, emailUser, config.otpLength);
          if (code) {
            this.logger.log(`🔑 ✅ Found: UID=${uid}, user="${emailUser}", code=***${code.slice(-2)}`);
            return { code, emailUsername: emailUser };
          }
          this.logger.log(`🔑 UID=${uid} no valid code`);
        } catch (error: unknown) {
          this.logger.warn(`🔑 UID=${uid} error: ${getErrorMessage(error)}`);
          continue;
        }
      }

      // ✅ إذا فيه إيميلات لكن ما طابق اليوزرنيم → username_mismatch
      if (needsMatch && hadUserMismatch) {
        this.logger.log(`🔑 ❌ Scanned ${scanUids.length} emails, none matched "${requestedUsername}" (case-insensitive)`);
        return { code: null, emailUsername: null, reason: 'username_mismatch' };
      }
      return { code: null, emailUsername: null, reason: 'no_code' };
    } catch (error: unknown) {
      throw new BadRequestException(`فشل الاتصال بالإيميل: ${getErrorMessage(error)}`);
    } finally {
      mailboxLock?.release();
      await this.closeImap(imap);
    }
  }

  private extractCode(textBody: string, fullBody: string, regex: string, username: string | null, expectedLength?: number): string | null {
    for (const body of [textBody, fullBody]) {
      const re = new RegExp(regex, 'g'); let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const c = m[1];
        // ✅ FIX: تحقق من طول الكود إذا محدد
        if (expectedLength && expectedLength > 0 && c.length !== expectedLength) continue;
        if (!username) return c;
        if (username.toLowerCase().includes(c.toLowerCase())) continue;
        if (/^\d+$/.test(c)) continue;
        if (/^[A-Z]+$/i.test(c)) continue;
        return c;
      }
    }
    return null;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔒 FIX F-06: حد معدل OTP عبر Redis (مشترك بين كل النسخ، ذرّي)
   * ───────────────────────────────────────────────────────────────────────────
   * المشكلة السابقة: rateMap في ذاكرة العملية الواحدة — يُعاد ضبطه عند إعادة
   * التشغيل، وغير مشترك بين النسخ (التوسّع الأفقي يضاعف الحد الفعّال).
   *
   * الحل: عدّاد ذرّي في Redis (INCR + EXPIRE) لنافذة 60 ثانية، مفتاحه slug+ip
   * فيُحسب الحد لكل خدمة ولكل عميل معاً عبر كل النسخ.
   *
   * التوافر: لو Redis غير متاح (تطوير/عطل)، نهبط بأمان إلى العدّاد في الذاكرة —
   * fail-open لا يُسقط الخدمة، والحد يظل مطبَّقاً لكن لكل عملية.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  // سكربت Lua ذرّي: INCR + ضبط EXPIRE في عملية واحدة لا تنقسم.
  // يمنع «المفتاح الأبدي»: لو انقطعت العملية بين INCR وEXPIRE منفصلين، لبقي
  // المفتاح بلا TTL فيحظر العميل للأبد. الذرّية تُلغي هذه الفجوة تماماً.
  // يُعيد العدّاد بعد الزيادة. نضبط EXPIRE عند أول طلب أو إن فُقد الـ TTL (‎-1).
  private static readonly RATE_LUA =
    "local c = redis.call('INCR', KEYS[1]) " +
    "if c == 1 or redis.call('TTL', KEYS[1]) == -1 then " +
    "redis.call('EXPIRE', KEYS[1], ARGV[1]) end " +
    "return c";

  private async checkRate(ip: string, slug: string, limit: number): Promise<void> {
    const safeIp = (ip || 'unknown').slice(0, 64);
    const windowSeconds = 60;

    // المسار الأساسي: Redis (ذرّي ومشترك عبر النسخ)
    if (this.redis && this.redis.status === 'ready') {
      try {
        const key = `otp_rate:${slug}:${safeIp}`;
        const count = Number(
          await this.redis.eval(OtpRelayService.RATE_LUA, 1, key, String(windowSeconds)),
        );
        if (count > limit) {
          throw new ForbiddenException('تجاوزت الحد المسموح. انتظر دقيقة.');
        }
        return;
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        // خطأ Redis (لا تجاوز حد) → نهبط للذاكرة، لا نُسقط الطلب
        this.logger.warn(
          `⚠️ فشل حد المعدل عبر Redis — هبوط إلى الذاكرة: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // الاحتياطي: عدّاد في الذاكرة (لكل عملية) — fail-open
    this.checkRateInMemory(`${slug}:${safeIp}`, limit);
  }

  /** احتياطي في الذاكرة يُستخدم فقط عند تعذّر Redis */
  private checkRateInMemory(key: string, limit: number): void {
    const now = Date.now();
    if (now - this.lastRateCleanup > 300_000) {
      this.lastRateCleanup = now;
      for (const [k, v] of this.rateMap.entries()) { if (v.every(t => now - t > 60000)) this.rateMap.delete(k); }
    }
    const ts = (this.rateMap.get(key) || []).filter(t => now - t < 60000);
    if (ts.length >= limit) throw new ForbiddenException('تجاوزت الحد المسموح. انتظر دقيقة.');
    ts.push(now); this.rateMap.set(key, ts);
  }

  getPlatforms(): OtpPlatformOption[] {
    return Object.entries(PLATFORM_PRESETS).map(([value, preset]) => ({ value, ...preset }));
  }
}
