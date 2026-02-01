/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - System Mail Service                             ║
 * ║                                                                               ║
 * ║  📧 لإرسال رسائل النظام (OTP, ترحيب, إشعارات)                                    ║
 * ║  🔧 يستخدم Nodemailer مع Namecheap Private Email SMTP                         ║
 * ║  ✅ يدعم BCC للمراقبة                                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  bcc?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = this.configService.get<string>('SMTP_HOST', 'mail.privateemail.com');
    const port = this.configService.get<number>('SMTP_PORT', 465);
    const secure = this.configService.get<boolean>('SMTP_SECURE', true);
    const user = this.configService.get<string>('SMTP_USER', 'no-reply@rafeq.ai');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!pass) {
      this.logger.warn('⚠️ SMTP_PASS not configured - emails will not be sent');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    this.transporter.verify((error) => {
      if (error) {
        this.logger.error('❌ SMTP connection failed:', error.message);
      } else {
        this.logger.log('✅ SMTP connection established successfully');
      }
    });
  }

  /**
   * 📧 إرسال بريد
   */
  async sendMail(options: SendMailOptions): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('SMTP not configured, skipping email send');
      return false;
    }

    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL', 'no-reply@rafeq.ai');
    const fromName = this.configService.get<string>('SMTP_FROM_NAME', 'RAFEQ');
    const bccEmail = this.configService.get<string>('BCC_EMAIL');

    try {
      const info = await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: options.to,
        bcc: options.bcc || bccEmail,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
      });

      this.logger.log(`✅ Email sent: ${info.messageId}`, { to: options.to, bcc: bccEmail || 'none' });
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${options.to}`, error);
      return false;
    }
  }

  /**
   * 🔐 إرسال OTP للتاجر
   */
  async sendOtpEmail(to: string, otp: string, merchantName?: string): Promise<boolean> {
    const subject = `رمز التحقق الخاص بك - RAFEQ`;
    
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>رمز التحقق - RAFEQ</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #0a0a0f;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(180deg, #0a0a0f 0%, #12121a 50%, #0d1117 100%);">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse;">
          
          <!-- Logo Header -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <table role="presentation" style="margin: 0 auto;" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 15px;">
                    <span style="color: #ffffff; font-size: 32px; font-weight: bold; letter-spacing: 3px;">RAFEQ</span>
                  </td>
                  <td>
                    <table cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%); border-radius: 12px; width: 48px; height: 48px;">
                      <tr>
                        <td align="center" valign="middle" style="width: 48px; height: 48px;">
                          <span style="color: #ffffff; font-size: 26px; font-weight: bold;">R</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(145deg, rgba(30,30,40,0.9) 0%, rgba(20,20,30,0.95) 100%); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; overflow: hidden;">
                
                <!-- Card Body -->
                <tr>
                  <td style="padding: 50px 40px;">
                    
                    <!-- Greeting -->
                    <p style="margin: 0 0 10px; color: #10b981; font-size: 16px; text-align: center;">
                      ${merchantName ? `مرحباً ${merchantName}! 👋` : 'مرحباً بك! 👋'}
                    </p>
                    
                    <!-- Title -->
                    <h1 style="margin: 0 0 15px; color: #ffffff; font-size: 28px; font-weight: bold; text-align: center;">
                      رمز التحقق الخاص بك
                    </h1>
                    
                    <p style="margin: 0 0 40px; color: #9ca3af; font-size: 16px; line-height: 1.6; text-align: center;">
                      استخدم الرمز التالي للدخول إلى لوحة التحكم
                    </p>
                    
                    <!-- OTP Box -->
                    <table role="presentation" style="width: 100%; margin: 0 0 35px;">
                      <tr>
                        <td>
                          <table role="presentation" style="width: 100%; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%); border: 2px solid #10b981; border-radius: 16px;">
                            <tr>
                              <td style="padding: 35px 20px; text-align: center;">
                                <p style="margin: 0 0 12px; color: #10b981; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 3px;">رمز التحقق</p>
                                <p style="margin: 0; color: #ffffff; font-size: 46px; font-weight: bold; letter-spacing: 14px; font-family: 'Courier New', Consolas, monospace;">
                                  ${otp}
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Timer Warning -->
                    <table role="presentation" style="width: 100%; margin: 0 0 30px;">
                      <tr>
                        <td>
                          <table role="presentation" style="width: 100%; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px;">
                            <tr>
                              <td style="padding: 16px; text-align: center;">
                                <p style="margin: 0; color: #fbbf24; font-size: 14px;">
                                  ⏱️ الرمز صالح لمدة <strong>5 دقائق</strong> فقط
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Security Note -->
                    <p style="margin: 0; color: #6b7280; font-size: 13px; text-align: center; line-height: 1.8;">
                      إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.
                      <br>
                      <span style="color: #ef4444;">🔒 لا تشارك هذا الرمز مع أي شخص.</span>
                    </p>
                    
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 40px 20px; text-align: center;">
              <p style="margin: 0 0 15px; color: #6b7280; font-size: 13px;">
                تحتاج مساعدة؟ تواصل معنا على
                <a href="mailto:support@rafeq.ai" style="color: #10b981; text-decoration: none; font-weight: 500;">support@rafeq.ai</a>
              </p>
              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="padding: 0 10px;">
                    <a href="https://rafeq.ai" style="color: #4b5563; text-decoration: none; font-size: 12px;">الموقع</a>
                  </td>
                  <td style="color: #374151;">|</td>
                  <td style="padding: 0 10px;">
                    <a href="https://rafeq.ai/privacy" style="color: #4b5563; text-decoration: none; font-size: 12px;">الخصوصية</a>
                  </td>
                  <td style="color: #374151;">|</td>
                  <td style="padding: 0 10px;">
                    <a href="https://rafeq.ai/terms" style="color: #4b5563; text-decoration: none; font-size: 12px;">الشروط</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 20px 0 0; color: #374151; font-size: 11px;">
                © ${new Date().getFullYear()} RAFEQ. جميع الحقوق محفوظة.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    return this.sendMail({ to, subject, html });
  }

  /**
   * 🎉 إرسال بريد ترحيبي للتاجر الجديد
   */
  async sendWelcomeEmail(to: string, merchantName: string, storeName: string): Promise<boolean> {
    const subject = `مرحباً بك في RAFEQ! 🎉`;
    
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مرحباً بك - RAFEQ</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #0a0a0f;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(180deg, #0a0a0f 0%, #12121a 50%, #0d1117 100%);">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse;">
          
          <!-- Logo Header -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <table role="presentation" style="margin: 0 auto;" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right: 15px;">
                    <span style="color: #ffffff; font-size: 32px; font-weight: bold; letter-spacing: 3px;">RAFEQ</span>
                  </td>
                  <td>
                    <table cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%); border-radius: 12px; width: 48px; height: 48px;">
                      <tr>
                        <td align="center" valign="middle" style="width: 48px; height: 48px;">
                          <span style="color: #ffffff; font-size: 26px; font-weight: bold;">R</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(145deg, rgba(30,30,40,0.9) 0%, rgba(20,20,30,0.95) 100%); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; overflow: hidden;">
                
                <!-- Celebration Header -->
                <tr>
                  <td style="padding: 40px 40px 20px; text-align: center;">
                    <p style="margin: 0; font-size: 50px;">🎉</p>
                  </td>
                </tr>
                
                <!-- Card Body -->
                <tr>
                  <td style="padding: 0 40px 50px;">
                    
                    <!-- Title -->
                    <h1 style="margin: 0 0 15px; color: #ffffff; font-size: 28px; font-weight: bold; text-align: center;">
                      أهلاً بك في RAFEQ!
                    </h1>
                    
                    <p style="margin: 0 0 30px; color: #9ca3af; font-size: 16px; line-height: 1.6; text-align: center;">
                      مرحباً <span style="color: #10b981; font-weight: 600;">${merchantName}</span>! تم تفعيل التطبيق على متجرك
                      <strong style="color: #ffffff;">"${storeName}"</strong> بنجاح!
                    </p>
                    
                    <!-- Features List -->
                    <table role="presentation" style="width: 100%; margin: 0 0 35px;">
                      <tr>
                        <td style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 16px; padding: 25px;">
                          <p style="margin: 0 0 15px; color: #ffffff; font-size: 15px; font-weight: 600;">الآن يمكنك:</p>
                          <table role="presentation" style="width: 100%;">
                            <tr><td style="padding: 8px 0; color: #d1d5db; font-size: 14px;">✅ ربط قنوات التواصل (واتساب، تيليجرام، إنستغرام)</td></tr>
                            <tr><td style="padding: 8px 0; color: #d1d5db; font-size: 14px;">✅ أتمتة الردود الذكية بالذكاء الاصطناعي</td></tr>
                            <tr><td style="padding: 8px 0; color: #d1d5db; font-size: 14px;">✅ إرسال إشعارات السلات المتروكة</td></tr>
                            <tr><td style="padding: 8px 0; color: #d1d5db; font-size: 14px;">✅ متابعة الطلبات والشحنات تلقائياً</td></tr>
                            <tr><td style="padding: 8px 0; color: #d1d5db; font-size: 14px;">✅ إطلاق حملات تسويقية فعّالة</td></tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- CTA Button -->
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td align="center">
                          <a href="https://rafeq.ai/dashboard" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; padding: 16px 45px; border-radius: 12px; font-size: 16px; font-weight: bold;">
                            الدخول للوحة التحكم ←
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 40px 20px; text-align: center;">
              <p style="margin: 0 0 15px; color: #6b7280; font-size: 13px;">
                تحتاج مساعدة؟ فريقنا جاهز لخدمتك 24/7
                <br>
                <a href="mailto:support@rafeq.ai" style="color: #10b981; text-decoration: none;">support@rafeq.ai</a>
              </p>
              <p style="margin: 0; color: #374151; font-size: 11px;">
                © ${new Date().getFullYear()} RAFEQ. جميع الحقوق محفوظة.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    return this.sendMail({ to, subject, html });
  }

  /**
   * إزالة HTML tags
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
