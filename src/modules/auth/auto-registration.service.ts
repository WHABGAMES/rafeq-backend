/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Auto Registration Service                      ║
 * ║                                                                                ║
 * ║  🎯 المهمة:                                                                    ║
 * ║  - إنشاء حساب تلقائي للتاجر عند تثبيت التطبيق                                   ║
 * ║  - إرسال بيانات الدخول عبر Email و WhatsApp                                   ║
 * ║                                                                                ║
 * ║  📋 السيناريو:                                                                 ║
 * ║  1. تاجر يثبّت التطبيق من سلة                                                  ║
 * ║  2. OAuth callback أو Webhook يوصل                                            ║
 * ║  3. البحث عن الإيميل في قاعدة البيانات                                         ║
 * ║  4. إذا جديد: إنشاء حساب + باسورد = Ra + رقم الجوال بدون كود الدولة           ║
 * ║  5. إذا موجود: إرسال تذكير ببيانات الدخول                                      ║
 * ║  6. إرسال بيانات الدخول عبر Email + WhatsApp                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcryptjs';

import { User, UserStatus, UserRole } from '@database/entities/user.entity';
import { Store } from '@modules/stores/entities/store.entity';
import { MailService } from '../mail/mail.service';

/**
 * 📌 بيانات التاجر من سلة
 */
export interface MerchantData {
  merchantId: number;
  email: string;
  mobile: string;
  name: string;
  storeName?: string;
  avatar?: string;
}

/**
 * 📌 نتيجة التسجيل التلقائي
 */
export interface AutoRegistrationResult {
  success: boolean;
  isNewUser: boolean;
  userId: string;
  tenantId: string | null;
  email: string;
  message: string;
}

@Injectable()
export class AutoRegistrationService {
  private readonly logger = new Logger(AutoRegistrationService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * 🎯 معالجة تثبيت التطبيق وإنشاء/تحديث المستخدم
   */
  async handleAppInstallation(
    merchantData: MerchantData,
    store: Store,
  ): Promise<AutoRegistrationResult> {
    const { merchantId, email, mobile, name, storeName } = merchantData;

    this.logger.log(`🔄 Processing app installation for merchant ${merchantId}`);

    try {
      // البحث عن المستخدم بالإيميل
      let user = await this.userRepository.findOne({
        where: { email: email.toLowerCase() },
        select: ['id', 'email', 'tenantId', 'firstName', 'preferences'],
      });

      let isNewUser = false;
      let password = '';

      if (!user) {
        // ════════════════════════════════════════════════════════════════
        // 🆕 مستخدم جديد - إنشاء حساب
        // ════════════════════════════════════════════════════════════════
        this.logger.log(`👤 Creating new user for merchant ${merchantId}`);

        password = this.generatePassword(mobile);
        const result = await this.createNewUser(merchantData, store, password);
        
        user = result.user;
        isNewUser = true;

        this.logger.log(`✅ New user created: ${user.id}`);

      } else {
        // ════════════════════════════════════════════════════════════════
        // 👤 مستخدم موجود - تحديث البيانات
        // ════════════════════════════════════════════════════════════════
        this.logger.log(`👤 Existing user found: ${user.id}`);

        // تحديث الـ tenantId إذا لزم
        if (user.tenantId !== store.tenantId) {
          await this.userRepository.update(user.id, {
            tenantId: store.tenantId,
          });
        }

        // توليد الباسورد (نفس الصيغة دائماً لأنه مبني على رقم الجوال)
        password = this.generatePassword(mobile);
      }

      // ════════════════════════════════════════════════════════════════
      // 📧📱 إرسال بيانات الدخول عبر Email + WhatsApp
      // ════════════════════════════════════════════════════════════════
      await this.sendWelcomeCredentials({
        email: email.toLowerCase(),
        password,
        name: name || storeName || 'شريكنا',
        storeName: storeName || store.name || 'متجرك',
        mobile,
        isNewUser,
      });

      return {
        success: true,
        isNewUser,
        userId: user.id,
        tenantId: store.tenantId || null,
        email: email.toLowerCase(),
        message: isNewUser ? 'تم إنشاء حساب جديد' : 'تم إرسال تذكير ببيانات الدخول',
      };

    } catch (error: any) {
      this.logger.error(`❌ Failed to handle app installation: ${error.message}`);
      throw error;
    }
  }

  /**
   * 🆕 إنشاء مستخدم جديد
   */
  private async createNewUser(
    merchantData: MerchantData,
    store: Store,
    password: string,
  ): Promise<{ user: User }> {
    const { email, mobile, name, storeName, avatar, merchantId } = merchantData;

    // التحقق من وجود tenantId
    if (!store.tenantId) {
      throw new Error('Store must have a tenantId for user creation');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const nameParts = (name || storeName || 'مستخدم رفيق').split(' ');

    const user = this.userRepository.create({
      tenantId: store.tenantId,
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName: nameParts[0] || 'مستخدم',
      lastName: nameParts.slice(1).join(' ') || 'رفيق',
      phone: mobile,
      avatar: avatar,
      role: UserRole.OWNER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      preferences: {
        source: 'salla_app_install',
        merchantId: merchantId,
        hasSetPassword: true,
        passwordSetAt: new Date().toISOString(),
        autoRegistered: true,
        registeredAt: new Date().toISOString(),
      },
    });

    const savedUser = await this.userRepository.save(user);

    return { user: savedUser };
  }

  /**
   * 🔐 توليد الباسورد
   * Format: Ra + رقم الجوال بدون كود الدولة
   * Example: Ra561667877
   * Fallback: Ra + رقم عشوائي
   */
  private generatePassword(mobile?: string): string {
    if (mobile && typeof mobile === 'string') {
      let cleanMobile = mobile.replace(/\D/g, '');

      // إزالة كود الدولة السعودية (966)
      if (cleanMobile.startsWith('966') && cleanMobile.length > 9) {
        cleanMobile = cleanMobile.slice(3);
      }
      // إزالة الصفر البادئ (05xxxxxxxx → 5xxxxxxxx)
      if (cleanMobile.startsWith('0') && cleanMobile.length > 9) {
        cleanMobile = cleanMobile.slice(1);
      }

      if (cleanMobile.length >= 6) {
        return `Ra${cleanMobile}`;
      }
    }
    // fallback - توليد رقم عشوائي إذا لم يكن هناك رقم جوال
    const randomNum = Date.now().toString().slice(-8);
    this.logger.warn(`⚠️ No valid mobile, using fallback password`);
    return `Ra${randomNum}`;
  }

  /**
   * 📧📱 إرسال بيانات الدخول عبر Email + WhatsApp
   */
  private async sendWelcomeCredentials(data: {
    email: string;
    password: string;
    name: string;
    storeName: string;
    mobile: string;
    isNewUser: boolean;
  }): Promise<void> {
    const { email, password, name, storeName, mobile, isNewUser } = data;

    // ════════════════════════════════════════════════════════════════
    // 📧 إرسال Email
    // ════════════════════════════════════════════════════════════════
    try {
      await this.mailService.sendWelcomeCredentials({
        to: email,
        name,
        storeName,
        email,
        password,
        loginUrl: 'https://rafeq.ai',
        isNewUser,
      });
      this.logger.log(`📧 Welcome email sent to ${email}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send welcome email: ${error.message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // 📱 إرسال WhatsApp عبر WhatsApp Business API
    // ════════════════════════════════════════════════════════════════
    try {
      await this.sendWhatsAppCredentials({
        mobile,
        name,
        storeName,
        email,
        password,
      });
    } catch (error: any) {
      // WhatsApp فشل — مش مشكلة، الإيميل وصل
      this.logger.error(`❌ Failed to send WhatsApp: ${error.message}`);
    }

    this.logger.log(`✅ Welcome credentials sent — Email: ${email}, Mobile: ${mobile}`);
  }

  /**
   * 📱 إرسال بيانات الدخول عبر WhatsApp Business API
   *
   * يستخدم نفس إعدادات WHATSAPP_PHONE_NUMBER_ID و WHATSAPP_ACCESS_TOKEN
   * الموجودة في .env — نفس الإعدادات المستخدمة في WhatsAppOtpService
   */
  private async sendWhatsAppCredentials(data: {
    mobile: string;
    name: string;
    storeName: string;
    email: string;
    password: string;
  }): Promise<void> {
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');

    if (!phoneNumberId || !accessToken) {
      this.logger.warn('⚠️ WhatsApp credentials not configured — skipping WhatsApp notification');
      return;
    }

    const formattedPhone = this.formatPhoneNumber(data.mobile);
    const apiVersion = 'v18.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    // ────────────────────────────────────────────────────────────────
    // رسالة الترحيب مع بيانات الدخول
    // ────────────────────────────────────────────────────────────────
    const message = [
      `مرحباً ${data.name}! 🎉`,
      ``,
      `تم تفعيل حسابك في *رفيق* بنجاح ✅`,
      ``,
      `🏪 المتجر: *${data.storeName}*`,
      ``,
      `🔑 *بيانات الدخول:*`,
      `📧 الإيميل: ${data.email}`,
      `🔐 كلمة المرور: *${data.password}*`,
      ``,
      `🚀 رابط الدخول: https://rafeq.ai`,
      ``,
      `💡 ننصحك بتغيير كلمة المرور بعد أول تسجيل دخول`,
    ].join('\n');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: {
        preview_url: true,
        body: message,
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      if (response.data?.messages?.[0]?.id) {
        this.logger.log(`📱 WhatsApp welcome sent to ${this.maskPhone(formattedPhone)}`, {
          messageId: response.data.messages[0].id,
        });
      }
    } catch (error: any) {
      this.logger.error(`❌ WhatsApp API error: ${error.response?.data?.error?.message || error.message}`, {
        phone: this.maskPhone(formattedPhone),
        status: error.response?.status,
      });
    }
  }

  /**
   * 📞 تنسيق رقم الهاتف — WhatsApp يتطلب الرقم بدون + وبدون مسافات
   */
  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');

    // إضافة رمز السعودية إذا لم يكن موجوداً
    if (cleaned.startsWith('05')) {
      cleaned = '966' + cleaned.slice(1);
    } else if (cleaned.startsWith('5') && cleaned.length === 9) {
      cleaned = '966' + cleaned;
    }

    return cleaned;
  }

  /**
   * 🎭 إخفاء رقم الهاتف للـ logging
   */
  private maskPhone(phone: string): string {
    if (phone.length < 8) return phone;
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  }
}
