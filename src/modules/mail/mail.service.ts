/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - System Mail Service                             ║
 * ║                                                                               ║
 * ║  📧 لإرسال رسائل النظام (OTP, ترحيب, إشعارات)                                    ║
 * ║  🔧 يستخدم Nodemailer مع Namecheap Private Email SMTP                         ║
 * ║  ✅ يدعم BCC للمراقبة                                                          ║
 * ║  🎨 تصميم متطابق مع الواجهة                                                    ║
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
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0c1222;">
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0c1222; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
          
          <!-- Logo Section - Icon RIGHT, RAFEQ LEFT -->
          <tr>
            <td align="center" style="padding: 30px 0 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr">
                <tr>
                  <!-- RAFEQ Text - LEFT -->
                  <td valign="middle" style="padding-right: 15px;">
                    <svg width="180" height="50" viewBox="0 0 180 50">
                      <defs>
                        <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" style="stop-color:#2dd4bf"/>
                          <stop offset="100%" style="stop-color:#a855f7"/>
                        </linearGradient>
                      </defs>
                      <text x="0" y="38" fill="url(#textGrad)" font-size="42" font-weight="700" font-family="Arial, sans-serif" letter-spacing="2">RAFEQ</text>
                    </svg>
                  </td>
                  <!-- Hexagon Logo - RIGHT -->
                  <td valign="middle">
                    <svg width="55" height="60" viewBox="0 0 100 110">
                      <defs>
                        <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style="stop-color:#2dd4bf"/>
                          <stop offset="100%" style="stop-color:#a855f7"/>
                        </linearGradient>
                      </defs>
                      <polygon points="50,5 95,27.5 95,77.5 50,100 5,77.5 5,27.5" fill="none" stroke="url(#hexGrad)" stroke-width="4"/>
                      <text x="50" y="65" text-anchor="middle" fill="url(#hexGrad)" font-size="45" font-weight="400" font-family="Arial, sans-serif">R</text>
                    </svg>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #111827; border-radius: 20px; overflow: hidden; border: 1px solid #1f2937;">
                
                <!-- Gradient Top Bar -->
                <tr>
                  <td style="height: 3px; background: linear-gradient(90deg, #2dd4bf, #a78bfa, #a855f7);"></td>
                </tr>
                
                <!-- Card Content -->
                <tr>
                  <td style="padding: 45px 35px;">
                    
                    <!-- Greeting -->
                    <p style="margin: 0 0 6px; font-size: 15px; color: #2dd4bf; text-align: center; font-weight: 500;">
                      👋 ${merchantName ? `مرحباً ${merchantName}!` : 'مرحباً!'}
                    </p>
                    
                    <!-- Title -->
                    <h1 style="margin: 0 0 10px; font-size: 26px; font-weight: 700; color: #ffffff; text-align: center;">
                      رمز التحقق الخاص بك
                    </h1>
                    
                    <!-- Subtitle -->
                    <p style="margin: 0 0 35px; font-size: 14px; color: #9ca3af; text-align: center;">
                      استخدم الرمز التالي للدخول إلى لوحة التحكم
                    </p>
                    
                    <!-- OTP Display -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                      <tr>
                        <td align="center">
                          <div style="background: linear-gradient(135deg, rgba(45, 212, 191, 0.08), rgba(168, 85, 247, 0.08)); border: 2px solid #374151; border-radius: 16px; padding: 28px 25px; display: inline-block; min-width: 300px;">
                            <p style="margin: 0 0 12px; font-size: 11px; font-weight: 600; color: #2dd4bf; text-transform: uppercase; letter-spacing: 3px;">رمز التحقق</p>
                            <p style="margin: 0; font-size: 44px; font-weight: 700; color: #ffffff; letter-spacing: 16px; font-family: 'Courier New', Consolas, monospace;">${otp}</p>
                          </div>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Timer -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                      <tr>
                        <td align="center">
                          <div style="background: rgba(55, 65, 81, 0.5); border: 1px solid #374151; border-radius: 25px; padding: 12px 28px; display: inline-block;">
                            <span style="color: #d1d5db; font-size: 13px;">🕐 صالح لمدة <strong style="color: #fbbf24;">5 دقائق</strong> فقط</span>
                          </div>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Security Warning -->
                    <p style="margin: 0 0 6px; font-size: 12px; color: #6b7280; text-align: center;">
                      إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #fbbf24; text-align: center;">
                      🔒 لا تشارك هذا الرمز مع أي شخص
                    </p>
                    
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 20px; text-align: center;">
              <p style="margin: 0 0 12px; font-size: 12px; color: #6b7280;">
                تحتاج مساعدة؟ 
                <a href="mailto:support@rafeq.ai" style="color: #2dd4bf; text-decoration: none;">support@rafeq.ai</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #4b5563;">
                © ${new Date().getFullYear()} RAFEQ - جميع الحقوق محفوظة
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
    const subject = `🎉 مرحباً بك في RAFEQ - تم تفعيل ${storeName}`;
    
    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مرحباً بك في RAFEQ</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0c1222;">
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0c1222;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
          
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 30px 0 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr">
                <tr>
                  <td valign="middle" style="padding-right: 15px;">
                    <svg width="180" height="50" viewBox="0 0 180 50">
                      <defs>
                        <linearGradient id="textGradW" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" style="stop-color:#2dd4bf"/>
                          <stop offset="100%" style="stop-color:#a855f7"/>
                        </linearGradient>
                      </defs>
                      <text x="0" y="38" fill="url(#textGradW)" font-size="42" font-weight="700" font-family="Arial, sans-serif" letter-spacing="2">RAFEQ</text>
                    </svg>
                  </td>
                  <td valign="middle">
                    <svg width="55" height="60" viewBox="0 0 100 110">
                      <defs>
                        <linearGradient id="hexGradW" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style="stop-color:#2dd4bf"/>
                          <stop offset="100%" style="stop-color:#a855f7"/>
                        </linearGradient>
                      </defs>
                      <polygon points="50,5 95,27.5 95,77.5 50,100 5,77.5 5,27.5" fill="none" stroke="url(#hexGradW)" stroke-width="4"/>
                      <text x="50" y="65" text-anchor="middle" fill="url(#hexGradW)" font-size="45" font-weight="400" font-family="Arial, sans-serif">R</text>
                    </svg>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #111827; border-radius: 20px; overflow: hidden; border: 1px solid #1f2937;">
                
                <!-- Gradient Bar -->
                <tr>
                  <td style="height: 3px; background: linear-gradient(90deg, #2dd4bf, #a78bfa, #a855f7);"></td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 45px 35px;">
                    
                    <!-- Celebration -->
                    <p style="margin: 0 0 15px; font-size: 50px; text-align: center;">🎉</p>
                    
                    <!-- Title -->
                    <h1 style="margin: 0 0 12px; font-size: 26px; font-weight: 700; color: #ffffff; text-align: center;">
                      أهلاً بك في RAFEQ!
                    </h1>
                    
                    <!-- Welcome -->
                    <p style="margin: 0 0 30px; font-size: 15px; color: #9ca3af; text-align: center; line-height: 1.7;">
                      مرحباً <span style="color: #2dd4bf; font-weight: 600;">${merchantName}</span>!
                      <br>
                      تم تفعيل متجرك <strong style="color: #ffffff;">"${storeName}"</strong> بنجاح
                    </p>
                    
                    <!-- Features -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: rgba(45, 212, 191, 0.08); border: 1px solid rgba(45, 212, 191, 0.2); border-radius: 14px; margin-bottom: 30px;">
                      <tr>
                        <td style="padding: 22px 28px;">
                          <p style="margin: 0 0 14px; font-size: 14px; font-weight: 600; color: #ffffff;">الآن يمكنك:</p>
                          <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 2;">
                            ✅ ربط قنوات التواصل (واتساب، تيليجرام)<br>
                            ✅ أتمتة الردود بالذكاء الاصطناعي<br>
                            ✅ إشعارات السلات المتروكة<br>
                            ✅ متابعة الطلبات تلقائياً<br>
                            ✅ حملات تسويقية فعّالة
                          </p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- CTA -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="https://rafeq.ai/dashboard" style="display: inline-block; background: linear-gradient(135deg, #2dd4bf, #a855f7); color: #ffffff; text-decoration: none; padding: 14px 45px; border-radius: 10px; font-size: 15px; font-weight: 600;">
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
            <td style="padding: 30px 20px; text-align: center;">
              <p style="margin: 0 0 12px; font-size: 12px; color: #6b7280;">
                فريقنا جاهز لمساعدتك 24/7
                <br>
                <a href="mailto:support@rafeq.ai" style="color: #2dd4bf; text-decoration: none;">support@rafeq.ai</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #4b5563;">
                © ${new Date().getFullYear()} RAFEQ - جميع الحقوق محفوظة
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
