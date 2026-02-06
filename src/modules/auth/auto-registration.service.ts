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
 * ║  2. Webhook يوصل (app.store.authorize)                                        ║
 * ║  3. البحث عن الإيميل في قاعدة البيانات                                         ║
 * ║  4. إذا جديد: إنشاء حساب + باسورد = Aa + رقم التلفون                           ║
 * ║  5. إذا موجود: إرسال تذكير ببيانات الدخول                                      ║
 * ║  6. إرسال بيانات الدخول عبر Email (و WhatsApp لاحقاً)                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

        // توليد باسورد جديد (لا نخزنه في preferences لأسباب أمنية)
        password = this.generatePassword(mobile);
      }

      // ════════════════════════════════════════════════════════════════
      // 📧 إرسال بيانات الدخول
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
        hasSetPassword: true, // الباسورد تم توليده تلقائياً
        // ⚠️ لا نخزن الباسورد كنص واضح في preferences لأسباب أمنية
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
   * Format: Aa + رقم التلفون
   * Example: Aa966512345678
   * Fallback: Aa + رقم عشوائي
   */
  private generatePassword(mobile?: string): string {
    // تنظيف رقم الجوال من أي رموز
    if (mobile && typeof mobile === 'string') {
      const cleanMobile = mobile.replace(/\D/g, '');
      if (cleanMobile.length >= 6) {
        return `Aa${cleanMobile}`;
      }
    }
    // fallback - توليد رقم عشوائي إذا لم يكن هناك رقم جوال
    const randomNum = Date.now().toString().slice(-8);
    this.logger.warn(`⚠️ No valid mobile, using fallback password`);
    return `Aa${randomNum}`;
  }

  /**
   * 📧 إرسال بيانات الدخول عبر Email و WhatsApp
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
    // 📱 إرسال WhatsApp (جاهز للتفعيل لاحقاً)
    // ════════════════════════════════════════════════════════════════
    // TODO: تفعيل عند ربط WhatsApp Business API
    /*
    try {
      await this.whatsAppService.sendWelcomeCredentials({
        to: mobile,
        storeName,
        email,
        password,
        loginUrl: 'https://rafeq.ai',
      });
      this.logger.log(`📱 WhatsApp message sent to ${mobile}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send WhatsApp: ${error.message}`);
    }
    */

    this.logger.log(`✅ Welcome credentials sent - Email: ${email}, Mobile: ${mobile}`);
  }
}
