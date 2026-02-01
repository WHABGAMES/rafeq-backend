/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp OTP Service                            ║
 * ║                                                                               ║
 * ║  📱 خدمة إرسال OTP عبر WhatsApp Business API                                   ║
 * ║  🔐 يستخدم Template معتمد من Meta                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WhatsAppOtpService {
  private readonly logger = new Logger(WhatsAppOtpService.name);
  
  private readonly API_VERSION = 'v18.0';
  private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * 📱 إرسال OTP عبر WhatsApp
   * 
   * يستخدم WhatsApp Authentication Template
   * 
   * @param phoneNumber رقم الهاتف (مع رمز الدولة)
   * @param otp رمز التحقق
   * @param merchantName اسم التاجر (للتخصيص)
   */
  async sendOtpWhatsApp(
    phoneNumber: string,
    otp: string,
    merchantName?: string,
  ): Promise<boolean> {
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    const templateName = this.configService.get<string>('WHATSAPP_OTP_TEMPLATE', 'otp_verification');

    if (!phoneNumberId || !accessToken) {
      this.logger.warn('⚠️ WhatsApp credentials not configured - OTP will not be sent via WhatsApp');
      return false;
    }

    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    try {
      // ─────────────────────────────────────────────────────────────────────────────
      // 📌 استخدام Template Authentication
      // Meta توفر template مُعتمد مسبقاً للـ OTP
      // أو يمكن إنشاء template خاص باسم otp_verification
      // ─────────────────────────────────────────────────────────────────────────────
      
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: 'ar', // العربية
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: otp, // رمز التحقق
                },
              ],
            },
            // إذا كان الـ Template يحتوي على زر Copy Code
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [
                {
                  type: 'text',
                  text: otp,
                },
              ],
            },
          ],
        },
      };

      const url = `${this.BASE_URL}/${phoneNumberId}/messages`;
      
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      if (response.data?.messages?.[0]?.id) {
        this.logger.log(`✅ WhatsApp OTP sent successfully to ${this.maskPhone(formattedPhone)}`, {
          messageId: response.data.messages[0].id,
        });
        return true;
      }

      return false;

    } catch (error: any) {
      // ─────────────────────────────────────────────────────────────────────────────
      // إذا فشل الـ Template، نجرب إرسال رسالة نصية مباشرة
      // (يعمل فقط إذا كان هناك محادثة نشطة خلال 24 ساعة)
      // ─────────────────────────────────────────────────────────────────────────────
      this.logger.warn(`WhatsApp Template failed, trying direct message...`, {
        error: error.response?.data || error.message,
      });

      return this.sendDirectOtpMessage(formattedPhone, otp, merchantName);
    }
  }

  /**
   * 📱 إرسال OTP كرسالة نصية مباشرة
   * يعمل فقط إذا كان هناك محادثة نشطة (خلال 24 ساعة)
   */
  private async sendDirectOtpMessage(
    phoneNumber: string,
    otp: string,
    merchantName?: string,
  ): Promise<boolean> {
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');

    if (!phoneNumberId || !accessToken) {
      return false;
    }

    try {
      const message = merchantName
        ? `مرحباً ${merchantName}! 👋\n\nرمز التحقق الخاص بك للدخول إلى رفيق:\n\n🔐 *${otp}*\n\nالرمز صالح لمدة 5 دقائق.\n\nإذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة.`
        : `رمز التحقق الخاص بك للدخول إلى رفيق:\n\n🔐 *${otp}*\n\nالرمز صالح لمدة 5 دقائق.`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        text: {
          preview_url: false,
          body: message,
        },
      };

      const url = `${this.BASE_URL}/${phoneNumberId}/messages`;
      
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      if (response.data?.messages?.[0]?.id) {
        this.logger.log(`✅ WhatsApp OTP (direct) sent to ${this.maskPhone(phoneNumber)}`);
        return true;
      }

      return false;

    } catch (error: any) {
      this.logger.error(`❌ Failed to send WhatsApp OTP to ${this.maskPhone(phoneNumber)}`, {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * 📞 تنسيق رقم الهاتف
   * WhatsApp يتطلب الرقم بدون + وبدون مسافات
   */
  private formatPhoneNumber(phone: string): string {
    // إزالة كل شيء ما عدا الأرقام
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

  /**
   * 🔍 التحقق من إمكانية إرسال WhatsApp
   */
  isWhatsAppConfigured(): boolean {
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    return !!(phoneNumberId && accessToken);
  }
}
