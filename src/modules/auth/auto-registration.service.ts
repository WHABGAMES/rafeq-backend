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
 * ║  4. إذا جديد: إنشاء حساب + باسورد + إرسال بيانات الدخول                        ║
 * ║  5. إذا موجود: ربط المتجر الجديد على نفس الحساب + إرسال تنبيه فقط             ║
 * ║     ❌ لا نغيّر tenantId — المتجر الجديد يُربط على tenant التاجر الموجود        ║
 * ║     ❌ لا نولّد باسورد — الباسورد محفوظ مشفر bcrypt ولا يُسترجع                 ║
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
  /** المنصة المصدر: 'salla' | 'zid' | أخرى (default: 'salla') */
  platform?: string;
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 Public: البحث عن مستخدم بالإيميل
  // يُستخدم من salla-oauth.service للتحقق قبل إنشاء tenant جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'tenantId', 'firstName', 'phone', 'preferences'],
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎯 معالجة تثبيت التطبيق
  // ═══════════════════════════════════════════════════════════════════════════════

  async handleAppInstallation(
    merchantData: MerchantData,
    store: Store,
  ): Promise<AutoRegistrationResult> {
    this.logger.log(`🔄 Processing app installation for merchant ${merchantData.merchantId}`);

    try {
      // البحث عن المستخدم بالإيميل
      const user = await this.userRepository.findOne({
        where: { email: merchantData.email.toLowerCase() },
        select: ['id', 'email', 'tenantId', 'firstName', 'preferences'],
      });

      if (!user) {
        // ════════════════════════════════════════════════════════════════
        // 🆕 مستخدم جديد — إنشاء حساب + إرسال بيانات الدخول
        // ════════════════════════════════════════════════════════════════
        return this.handleNewUser(merchantData, store);
      } else {
        // ════════════════════════════════════════════════════════════════
        // 👤 مستخدم موجود — ربط المتجر الجديد فقط
        // ❌ لا نغيّر tenantId (المتجر الجديد أصلاً مُربط بنفس tenant)
        // ❌ لا نولّد باسورد (الباسورد مشفر bcrypt ولا يُسترجع)
        // ════════════════════════════════════════════════════════════════
        return this.handleExistingUser(user, merchantData, store);
      }

    } catch (error: any) {
      this.logger.error(`❌ Failed to handle app installation: ${error.message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 مستخدم جديد — إنشاء حساب
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleNewUser(
    merchantData: MerchantData,
    store: Store,
  ): Promise<AutoRegistrationResult> {
    const { merchantId, email, mobile, name, storeName } = merchantData;

    this.logger.log(`👤 Creating new user for merchant ${merchantId}`);

    const password = this.generatePassword(mobile);
    const result = await this.createNewUser(merchantData, store, password);

    this.logger.log(`✅ New user created: ${result.user.id}`);

    // 📧📱 إرسال بيانات الدخول (إيميل + واتساب)
    await this.sendWelcomeCredentials({
      email: email.toLowerCase(),
      password,
      name: name || storeName || 'شريكنا',
      storeName: storeName || store.name || 'متجرك',
      mobile,
      isNewUser: true,
    });

    return {
      success: true,
      isNewUser: true,
      userId: result.user.id,
      tenantId: store.tenantId || null,
      email: email.toLowerCase(),
      message: 'تم إنشاء حساب جديد وإرسال بيانات الدخول',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 مستخدم موجود — ربط متجر جديد فقط (بدون تغيير باسورد)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleExistingUser(
    user: User,
    merchantData: MerchantData,
    store: Store,
  ): Promise<AutoRegistrationResult> {
    const { merchantId, email, mobile, name, storeName } = merchantData;

    this.logger.log(`👤 Existing user ${user.id} — linking new store (merchant ${merchantId})`);

    // ✅ إذا المستخدم ما عنده tenantId (حالة نادرة) → نحدّثه من المتجر
    if (!user.tenantId && store.tenantId) {
      await this.userRepository.update(user.id, { tenantId: store.tenantId });
      this.logger.log(`✅ Set missing tenantId for user ${user.id} → ${store.tenantId}`);
    }

    // ✅ تحديث merchantIds في preferences
    // 🐛 FIX: المستخدمون القدامى عندهم preferences.merchantId (رقم واحد)
    //    المستخدمون الجدد عندهم preferences.merchantIds (مصفوفة)
    //    نهاجر من الصيغة القديمة للجديدة
    const currentPrefs = (user.preferences as Record<string, unknown>) || {};

    // Migration: merchantId (old) → merchantIds (new)
    let merchantIds: number[] = [];
    if (Array.isArray(currentPrefs.merchantIds)) {
      merchantIds = currentPrefs.merchantIds as number[];
    } else if (typeof currentPrefs.merchantId === 'number' && currentPrefs.merchantId > 0) {
      // ← هاجر من الصيغة القديمة
      merchantIds = [currentPrefs.merchantId as number];
    }

    if (!merchantIds.includes(merchantId)) {
      merchantIds.push(merchantId);
    }

    await this.userRepository.update(user.id, {
      preferences: {
        ...currentPrefs,
        merchantId: undefined,  // ← حذف الحقل القديم
        merchantIds,
        lastStoreLinkedAt: new Date().toISOString(),
      },
    });

    // 📧📱 إرسال تنبيه "تم ربط متجر جديد" (بدون كلمة مرور)
    await this.sendNewStoreLinkedNotification({
      email: email.toLowerCase(),
      name: user.firstName || name || 'شريكنا',
      storeName: storeName || store.name || 'متجرك',
      mobile,
    });

    return {
      success: true,
      isNewUser: false,
      userId: user.id,
      tenantId: user.tenantId || null,
      email: email.toLowerCase(),
      message: 'تم ربط المتجر الجديد على حسابك الحالي',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏗️ إنشاء مستخدم جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  private async createNewUser(
    merchantData: MerchantData,
    store: Store,
    password: string,
  ): Promise<{ user: User }> {
    const { email, mobile, name, storeName, avatar, merchantId } = merchantData;

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
        source: `${merchantData.platform || 'salla'}_app_install`,
        merchantIds: [merchantId],
        hasSetPassword: true,
        passwordSetAt: new Date().toISOString(),
        autoRegistered: true,
        registeredAt: new Date().toISOString(),
      },
    });

    const savedUser = await this.userRepository.save(user);
    return { user: savedUser };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 توليد الباسورد (مستخدم جديد فقط)
  // ═══════════════════════════════════════════════════════════════════════════════

  private generatePassword(mobile?: string): string {
    if (mobile && typeof mobile === 'string') {
      let cleanMobile = mobile.replace(/\D/g, '');

      if (cleanMobile.startsWith('966') && cleanMobile.length > 9) {
        cleanMobile = cleanMobile.slice(3);
      }
      if (cleanMobile.startsWith('0') && cleanMobile.length > 9) {
        cleanMobile = cleanMobile.slice(1);
      }

      if (cleanMobile.length >= 6) {
        return `Ra${cleanMobile}`;
      }
    }

    const randomNum = Date.now().toString().slice(-8);
    this.logger.warn(`⚠️ No valid mobile, using fallback password`);
    return `Ra${randomNum}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧📱 إرسال بيانات الدخول (مستخدم جديد فقط)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async sendWelcomeCredentials(data: {
    email: string;
    password: string;
    name: string;
    storeName: string;
    mobile: string;
    isNewUser: boolean;
  }): Promise<void> {
    const { email, password, name, storeName, mobile } = data;

    // 📧 Email
    try {
      await this.mailService.sendWelcomeCredentials({
        to: email,
        name,
        storeName,
        email,
        password,
        loginUrl: 'https://rafeq.ai',
        isNewUser: true,
      });
      this.logger.log(`📧 Welcome email sent to ${email}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send welcome email: ${error.message}`);
    }

    // 📱 WhatsApp
    try {
      await this.sendWhatsAppMessage({
        mobile,
        message: [
          `مرحباً ${name}! 🎉`,
          ``,
          `تم تفعيل حسابك في *رفيق* بنجاح ✅`,
          ``,
          `🏪 المتجر: *${storeName}*`,
          ``,
          `🔑 *بيانات الدخول:*`,
          `📧 الإيميل: ${email}`,
          `🔐 كلمة المرور: *${password}*`,
          ``,
          `🚀 رابط الدخول: https://rafeq.ai`,
          ``,
          `💡 ننصحك بتغيير كلمة المرور بعد أول تسجيل دخول`,
        ].join('\n'),
      });
    } catch (error: any) {
      this.logger.error(`❌ Failed to send WhatsApp: ${error.message}`);
    }

    this.logger.log(`✅ Welcome credentials sent — Email: ${email}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧📱 إرسال تنبيه "تم ربط متجر جديد" (بدون كلمة مرور)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async sendNewStoreLinkedNotification(data: {
    email: string;
    name: string;
    storeName: string;
    mobile: string;
  }): Promise<void> {
    const { email, name, storeName, mobile } = data;

    // 📧 Email — تنبيه ربط متجر جديد
    try {
      await this.mailService.sendMail({
        to: email,
        subject: `🏪 تم ربط متجر جديد — ${storeName}`,
        html: this.buildNewStoreEmailHtml(name, storeName),
      });
      this.logger.log(`📧 New store notification sent to ${email}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send new store email: ${error.message}`);
    }

    // 📱 WhatsApp — تنبيه بدون باسورد
    try {
      await this.sendWhatsAppMessage({
        mobile,
        message: [
          `مرحباً ${name}! 🏪`,
          ``,
          `تم ربط متجر جديد على حسابك في *رفيق* ✅`,
          ``,
          `🏪 المتجر الجديد: *${storeName}*`,
          ``,
          `يمكنك إدارة جميع متاجرك من لوحة التحكم:`,
          `🚀 https://rafeq.ai`,
          ``,
          `سجّل الدخول بنفس بيانات حسابك الحالي.`,
        ].join('\n'),
      });
    } catch (error: any) {
      this.logger.error(`❌ Failed to send WhatsApp: ${error.message}`);
    }

    this.logger.log(`✅ New store notification sent — Email: ${email}, Store: ${storeName}`);
  }

  /**
   * 📧 بناء HTML لإيميل ربط متجر جديد
   */
  private buildNewStoreEmailHtml(name: string, storeName: string): string {
    return `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a; color: #e2e8f0; border-radius: 16px;">
        <div style="text-align: center; padding: 20px 0;">
          <h1 style="color: #2dd4bf; font-size: 24px; margin: 0;">🏪 متجر جديد مُربط</h1>
        </div>
        <div style="background-color: #1e293b; border-radius: 12px; padding: 24px; margin: 20px 0;">
          <p style="font-size: 16px; color: #e2e8f0; margin: 0 0 16px 0;">مرحباً ${name}! 👋</p>
          <p style="font-size: 15px; color: #94a3b8; margin: 0 0 16px 0;">
            تم ربط متجر جديد على حسابك في رفيق بنجاح:
          </p>
          <div style="background-color: #0f172a; border: 2px solid #2dd4bf; border-radius: 10px; padding: 16px; text-align: center; margin: 16px 0;">
            <span style="font-size: 20px; font-weight: 700; color: #2dd4bf;">🏪 ${storeName}</span>
          </div>
          <p style="font-size: 14px; color: #94a3b8; margin: 16px 0 0 0;">
            سجّل الدخول بنفس بيانات حسابك الحالي لإدارة جميع متاجرك.
          </p>
        </div>
        <div style="text-align: center; padding: 20px 0;">
          <a href="https://rafeq.ai" style="background-color: #2dd4bf; color: #0f172a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">
            🚀 الدخول إلى لوحة التحكم
          </a>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Helper
  // ═══════════════════════════════════════════════════════════════════════════════

  private async sendWhatsAppMessage(data: {
    mobile: string;
    message: string;
  }): Promise<void> {
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');

    if (!phoneNumberId || !accessToken) {
      this.logger.warn('⚠️ WhatsApp credentials not configured — skipping');
      return;
    }

    const formattedPhone = this.formatPhoneNumber(data.mobile);
    const apiVersion = 'v18.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: {
        preview_url: true,
        body: data.message,
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
        this.logger.log(`📱 WhatsApp sent to ${this.maskPhone(formattedPhone)}`, {
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

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('05')) {
      cleaned = '966' + cleaned.slice(1);
    } else if (cleaned.startsWith('5') && cleaned.length === 9) {
      cleaned = '966' + cleaned;
    }

    return cleaned;
  }

  private maskPhone(phone: string): string {
    if (phone.length < 8) return phone;
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  }
}
