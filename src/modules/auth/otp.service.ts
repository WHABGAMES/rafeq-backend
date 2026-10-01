/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - OTP Service (Redis-Based)                       ║
 * ║                                                                               ║
 * ║  🔐 خدمة إنشاء والتحقق من رموز OTP                                             ║
 * ║  📧 يدعم البريد الإلكتروني                                                      ║
 * ║  📱 يدعم WhatsApp                                                             ║
 * ║  ⏱️ صلاحية الرمز: 5 دقائق                                                      ║
 * ║  🔄 محاولات التحقق: 5 محاولات كحد أقصى                                          ║
 * ║  🗄️ التخزين: Redis (Production-Ready)                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, UnauthorizedException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * قنوات إرسال OTP المدعومة
 */
export enum OtpChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

/**
 * سجل OTP المُخزن في Redis
 */
interface OtpRecord {
  otpHash: string;          // Hash فقط (لا نخزن الرمز الأصلي)
  email?: string;
  phone?: string;
  channel: OtpChannel;
  merchantId?: number;
  tenantId?: string;
  attempts: number;
  createdAt: number;        // Unix timestamp
  expiresAt: number;        // Unix timestamp
}

type AtomicVerificationResult = [number, (number | string)?];

// Redis executes Lua scripts atomically. Keeping the read, attempt increment and
// consume/delete operation in one script prevents two concurrent requests from
// accepting the same one-time password.
const VERIFY_OTP_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {0} end

local record = cjson.decode(raw)
local now = tonumber(ARGV[1])
if now > tonumber(record.expiresAt) then
  redis.call('DEL', KEYS[1])
  return {1}
end

if tonumber(record.attempts) >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {2}
end

record.attempts = tonumber(record.attempts) + 1
local ttl = math.max(1, math.ceil((tonumber(record.expiresAt) - now) / 1000))

if record.otpHash ~= ARGV[3] then
  redis.call('SETEX', KEYS[1], ttl, cjson.encode(record))
  return {3, tonumber(ARGV[2]) - tonumber(record.attempts)}
end

redis.call('DEL', KEYS[1])
return {4, raw}
`;

/**
 * طريقة التحقق المتاحة
 */
export interface VerificationMethod {
  channel: OtpChannel;
  value: string;
  maskedValue: string;
  isAvailable: boolean;
}

@Injectable()
export class OtpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtpService.name);
  private redis: Redis;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // ⚙️ Configuration - قابل للتعديل
  // ═══════════════════════════════════════════════════════════════════════════════
  private readonly OTP_LENGTH = 6;
  private readonly OTP_EXPIRY_SECONDS = 5 * 60;       // 5 دقائق
  private readonly MAX_ATTEMPTS = 5;
  private readonly RESEND_COOLDOWN_SECONDS = 60;      // دقيقة واحدة
  private readonly KEY_PREFIX = 'rafiq:otp:';
  private readonly RATE_LIMIT_PREFIX = 'rafiq:otp_rate:';
  private readonly MAX_OTP_PER_HOUR = 5;              // حد أقصى 5 محاولات في الساعة

  constructor(private readonly configService: ConfigService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚀 Lifecycle Hooks
  // ═══════════════════════════════════════════════════════════════════════════════

  async onModuleInit(): Promise<void> {
    await this.initializeRedis();
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeRedis();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Redis Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  private async initializeRedis(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const db = this.configService.get<number>('REDIS_DB', 0);
    const useTls = this.configService.get<string>('REDIS_TLS') === 'true';

    try {
      this.redis = new Redis({
        host,
        port,
        password: password || undefined,
        db,
        ...(useTls && {
          tls: {},
        }),
        retryStrategy: (times: number) => {
          if (times > 5) {
            this.logger.error('❌ Redis connection failed after 5 retries for OTP Service');
            return null;
          }
          const delay = Math.min(times, 5) * 1000;
          this.logger.warn(`⚠️ Redis retry attempt ${times}, waiting ${delay}ms`);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        // ✅ FIX P4: keepAlive prevents Redis idle timeout disconnects (5min cycle)
        keepAlive: 30000,
        lazyConnect: false,
      });

      this.redis.on('connect', () => {
        this.logger.log('✅ OTP Service: Redis connected');
      });

      this.redis.on('ready', () => {
        this.logger.log('✅ OTP Service: Redis ready');
      });

      this.redis.on('error', (error) => {
        this.logger.error(`❌ OTP Service Redis error: ${error.message}`);
      });

      this.redis.on('close', () => {
        this.logger.warn('⚠️ OTP Service: Redis connection closed');
      });

      // Test connection
      const pong = await this.redis.ping();
      if (pong === 'PONG') {
        this.logger.log('✅ OTP Service: Redis ping successful');
      }

      // ✅ FIX P4: Application-level PING every 60s prevents idle timeout
      //    TCP keepAlive (30s) may not survive cloud Redis proxies
      //    PING is an actual Redis command that keeps the connection active
      this.pingInterval = setInterval(async () => {
        try {
          if (this.redis?.status === 'ready') {
            await this.redis.ping();
          }
        } catch {
          // Silent — reconnect strategy will handle it
        }
      }, 60_000);

    } catch (error) {
      this.logger.error('❌ Failed to initialize Redis for OTP Service', error);
      throw new Error('OTP Service requires Redis connection', { cause: error });
    }
  }

  private async closeRedis(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.redis) {
      try {
        await this.redis.quit();
        this.logger.log('✅ OTP Service: Redis connection closed gracefully');
      } catch (error) {
        this.logger.error('Error closing Redis connection', error);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔢 OTP Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔢 توليد OTP جديد
   */
  async generateOtp(
    identifier: string,
    channel: OtpChannel,
    options?: {
      merchantId?: number;
      tenantId?: string;
      email?: string;
      phone?: string;
    },
  ): Promise<{ otp: string; expiresAt: Date }> {
    const normalizedIdentifier = identifier.toLowerCase().trim();
    const key = this.getKey(normalizedIdentifier, channel);

    // 1️⃣ Rate Limiting - حماية من الإساءة
    await this.checkRateLimit(normalizedIdentifier, channel);

    // 2️⃣ Cooldown Check - منع الإرسال المتكرر
    const existing = await this.getOtpRecord(key);
    if (existing) {
      const timeSinceCreated = (Date.now() - existing.createdAt) / 1000;
      if (timeSinceCreated < this.RESEND_COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(this.RESEND_COOLDOWN_SECONDS - timeSinceCreated);
        throw new BadRequestException(
          `يرجى الانتظار ${waitTime} ثانية قبل طلب رمز جديد`,
        );
      }
    }

    // 3️⃣ Generate secure OTP
    const otp = this.generateSecureOtp();
    const now = Date.now();
    const expiresAt = now + (this.OTP_EXPIRY_SECONDS * 1000);

    // 4️⃣ Create record with hashed OTP
    const record: OtpRecord = {
      otpHash: this.hashOtp(otp),
      email: options?.email || (channel === OtpChannel.EMAIL ? normalizedIdentifier : undefined),
      phone: options?.phone || (channel === OtpChannel.WHATSAPP ? normalizedIdentifier : undefined),
      channel,
      merchantId: options?.merchantId,
      tenantId: options?.tenantId,
      attempts: 0,
      createdAt: now,
      expiresAt,
    };

    // 5️⃣ Store in Redis with automatic expiry
    await this.redis.setex(
      key,
      this.OTP_EXPIRY_SECONDS + 60, // إضافة 60 ثانية للأمان
      JSON.stringify(record),
    );

    // 6️⃣ Increment rate limit counter
    await this.incrementRateLimit(normalizedIdentifier, channel);

    this.logger.log(`🔑 OTP generated via ${channel}`, {
      identifier: this.maskValue(normalizedIdentifier, channel),
      merchantId: options?.merchantId,
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return { otp, expiresAt: new Date(expiresAt) };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ OTP Verification
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ التحقق من OTP
   */
  async verifyOtp(
    identifier: string,
    otp: string,
    channel: OtpChannel,
  ): Promise<{
    valid: boolean;
    merchantId?: number;
    tenantId?: string;
    email?: string;
    phone?: string;
  }> {
    const normalizedIdentifier = identifier.toLowerCase().trim();
    const key = this.getKey(normalizedIdentifier, channel);
    
    const result = await this.redis.eval(
      VERIFY_OTP_SCRIPT,
      1,
      key,
      Date.now().toString(),
      this.MAX_ATTEMPTS.toString(),
      this.hashOtp(otp),
    ) as AtomicVerificationResult;
    const [status, detail] = result;

    if (status === 0) {
      this.logger.warn('OTP not found', { identifier: this.maskValue(normalizedIdentifier, channel), channel });
      throw new UnauthorizedException('رمز التحقق غير صحيح أو منتهي الصلاحية');
    }
    if (status === 1) {
      this.logger.warn('OTP expired', { identifier: this.maskValue(normalizedIdentifier, channel) });
      throw new UnauthorizedException('انتهت صلاحية رمز التحقق');
    }
    if (status === 2) {
      this.logger.warn('Max OTP attempts exceeded', { identifier: this.maskValue(normalizedIdentifier, channel) });
      throw new UnauthorizedException('تم تجاوز عدد المحاولات المسموح. يرجى طلب رمز جديد');
    }
    if (status === 3) {
      this.logger.warn('Invalid OTP attempt', {
        identifier: this.maskValue(normalizedIdentifier, channel),
        remainingAttempts: detail,
      });
      throw new UnauthorizedException(`رمز التحقق غير صحيح. المحاولات المتبقية: ${detail}`);
    }
    if (status !== 4) {
      throw new UnauthorizedException('رمز التحقق غير صالح');
    }

    const record = JSON.parse(detail as string) as OtpRecord;
    this.logger.log(`✅ OTP verified successfully`, {
      identifier: this.maskValue(normalizedIdentifier, channel),
      channel,
    });

    return {
      valid: true,
      merchantId: record.merchantId,
      tenantId: record.tenantId,
      email: record.email,
      phone: record.phone,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔍 التحقق من وجود OTP نشط
   */
  async hasActiveOtp(identifier: string, channel: OtpChannel): Promise<boolean> {
    const key = this.getKey(identifier.toLowerCase().trim(), channel);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * ⏱️ الوقت المتبقي لإعادة الإرسال
   */
  async getResendCooldown(identifier: string, channel: OtpChannel): Promise<number> {
    const key = this.getKey(identifier.toLowerCase().trim(), channel);
    const record = await this.getOtpRecord(key);
    
    if (!record) return 0;
    
    const timeSinceCreated = (Date.now() - record.createdAt) / 1000;
    const remaining = this.RESEND_COOLDOWN_SECONDS - timeSinceCreated;
    
    return Math.max(0, Math.ceil(remaining));
  }

  /**
   * 🗑️ حذف OTP
   */
  async deleteOtp(identifier: string, channel: OtpChannel): Promise<void> {
    const key = this.getKey(identifier.toLowerCase().trim(), channel);
    await this.redis.del(key);
    this.logger.debug(`OTP deleted`, {
      identifier: this.maskValue(identifier, channel),
    });
  }

  /**
   * 📊 جلب معلومات OTP (للتصحيح والدعم)
   */
  async getOtpInfo(identifier: string, channel: OtpChannel): Promise<{
    exists: boolean;
    attemptsRemaining?: number;
    expiresInSeconds?: number;
    resendCooldownSeconds?: number;
  }> {
    const key = this.getKey(identifier.toLowerCase().trim(), channel);
    const record = await this.getOtpRecord(key);
    
    if (!record) {
      return { exists: false };
    }
    
    const now = Date.now();
    return {
      exists: true,
      attemptsRemaining: Math.max(0, this.MAX_ATTEMPTS - record.attempts),
      expiresInSeconds: Math.max(0, Math.ceil((record.expiresAt - now) / 1000)),
      resendCooldownSeconds: await this.getResendCooldown(identifier, channel),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛡️ Rate Limiting
  // ═══════════════════════════════════════════════════════════════════════════════

  private async checkRateLimit(identifier: string, channel: OtpChannel): Promise<void> {
    const rateLimitKey = `${this.RATE_LIMIT_PREFIX}${channel}:${identifier}`;
    const count = await this.redis.get(rateLimitKey);
    
    if (count && parseInt(count, 10) >= this.MAX_OTP_PER_HOUR) {
      this.logger.warn(`Rate limit exceeded`, {
        identifier: this.maskValue(identifier, channel),
        channel,
      });
      throw new BadRequestException(
        'تم تجاوز الحد الأقصى لطلبات رمز التحقق. يرجى المحاولة بعد ساعة.',
      );
    }
  }

  private async incrementRateLimit(identifier: string, channel: OtpChannel): Promise<void> {
    const rateLimitKey = `${this.RATE_LIMIT_PREFIX}${channel}:${identifier}`;
    const exists = await this.redis.exists(rateLimitKey);
    
    if (exists) {
      await this.redis.incr(rateLimitKey);
    } else {
      await this.redis.setex(rateLimitKey, 3600, '1'); // ساعة واحدة
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔒 Private Utilities
  // ═══════════════════════════════════════════════════════════════════════════════

  private getKey(identifier: string, channel: OtpChannel): string {
    return `${this.KEY_PREFIX}${channel}:${identifier}`;
  }

  private async getOtpRecord(key: string): Promise<OtpRecord | null> {
    try {
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as OtpRecord;
    } catch (error) {
      this.logger.error('Error parsing OTP record', error);
      return null;
    }
  }

  private generateSecureOtp(): string {
    // استخدام crypto لتوليد رقم عشوائي آمن
    const buffer = crypto.randomBytes(4);
    const number = buffer.readUInt32BE(0);
    return (number % 1000000).toString().padStart(this.OTP_LENGTH, '0');
  }

  private hashOtp(otp: string): string {
    const secret = this.configService.get<string>('JWT_SECRET', 'rafiq-otp-secret-key');
    return crypto
      .createHmac('sha256', secret)
      .update(otp)
      .digest('hex');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎭 Masking Utilities (Public)
  // ═══════════════════════════════════════════════════════════════════════════════

  maskValue(value: string, channel: OtpChannel): string {
    if (channel === OtpChannel.EMAIL) {
      return this.maskEmail(value);
    }
    return this.maskPhone(value);
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    
    const [localPart, domain] = parts;
    
    if (localPart.length <= 2) {
      return `${localPart[0]}***@${domain}`;
    }
    
    return `${localPart.slice(0, 2)}***${localPart.slice(-1)}@${domain}`;
  }

  private maskPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length < 8) return phone;
    
    const countryCode = cleaned.slice(0, 3);
    const lastFour = cleaned.slice(-4);
    const middleLength = Math.max(0, cleaned.length - 7);
    
    return `${countryCode}${'*'.repeat(middleLength)}${lastFour}`;
  }
}
