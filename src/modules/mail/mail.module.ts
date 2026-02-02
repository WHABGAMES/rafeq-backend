/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║        RAFEQ - تعليمات إضافة sendWelcomeCredentials إلى mail.service.ts       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 * 
 * ⚠️  مهم جداً: أضف هذا الكود داخل الـ class وليس خارجه!
 * 
 * الملف: src/modules/mail/mail.service.ts
 * الموقع: قبل السطر الأخير } (إغلاق الـ class)
 * 
 * ابحث عن:
 *   private stripHtml(html: string): string {
 *     return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
 *   }
 * }  <-- هذا هو إغلاق الـ class
 * 
 * أضف الكود التالي قبل } الأخيرة:
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 🎉 أضف هذا الـ method قبل إغلاق الـ class (قبل } الأخيرة)
// ═══════════════════════════════════════════════════════════════════════════════

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
      ? `🎉 مرحباً ${storeName}! حسابك في رفيق جاهز`
      : `🔐 تذكير ببيانات دخولك - رفيق`;

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مرحباً بك في رفيق</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background-color: #0f172a;">
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f172a; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
          
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 30px 0;">
              <div style="font-size: 42px; font-weight: 700; background: linear-gradient(135deg, #2dd4bf, #a78bfa, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                RAFEQ
              </div>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, rgba(45, 212, 191, 0.1), rgba(168, 139, 250, 0.1)); border-radius: 24px; border: 1px solid rgba(168, 139, 250, 0.2);">
                <tr>
                  <td style="padding: 48px 40px;">
                    
                    <!-- Welcome Message -->
                    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: 700; color: #ffffff; text-align: center;">
                      مرحباً ${name}! 👋
                    </h1>
                    
                    <p style="margin: 0 0 32px; font-size: 18px; color: #94a3b8; text-align: center; line-height: 1.6;">
                      ${isNewUser ? 'يسعدنا انضمامك لعائلة رفيق! 🎉' : 'هذا تذكير ببيانات دخولك 🔐'}
                    </p>
                    
                    <!-- Credentials Box -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: rgba(15, 23, 42, 0.6); border-radius: 16px; border: 1px solid rgba(168, 139, 250, 0.3);">
                      <tr>
                        <td style="padding: 32px;">
                          
                          <!-- Email -->
                          <div style="margin-bottom: 24px;">
                            <div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">📧 البريد الإلكتروني</div>
                            <div style="font-size: 20px; color: #2dd4bf; font-weight: 600; font-family: monospace; background: rgba(45, 212, 191, 0.1); padding: 12px 16px; border-radius: 8px; text-align: center;">
                              ${email}
                            </div>
                          </div>
                          
                          <!-- Password -->
                          <div>
                            <div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">🔑 رمز الدخول</div>
                            <div style="font-size: 24px; color: #a855f7; font-weight: 700; font-family: monospace; letter-spacing: 2px; background: rgba(168, 85, 247, 0.1); padding: 16px; border-radius: 8px; text-align: center;">
                              ${password}
                            </div>
                          </div>
                          
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Login Button -->
                    <div style="text-align: center; margin-top: 32px;">
                      <a href="${loginUrl}" style="display: inline-block; background: linear-gradient(135deg, #2dd4bf, #a78bfa, #a855f7); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 18px; font-weight: bold;">
                        🚀 دخول لوحة التحكم
                      </a>
                    </div>
                    
                    <!-- Security Tip -->
                    <div style="margin-top: 32px; padding: 16px; background: rgba(251, 191, 36, 0.1); border-radius: 12px; border: 1px solid rgba(251, 191, 36, 0.3);">
                      <p style="margin: 0; font-size: 14px; color: #fbbf24; text-align: center;">
                        💡 نصيحة: ننصحك بتغيير كلمة المرور بعد أول تسجيل دخول
                      </p>
                    </div>
                    
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px 0; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">
                مع تحيات فريق رفيق 💜
              </p>
            </td>
          </tr>
          
        </table>
        
      </td>
    </tr>
  </table>
  
</body>
</html>
    `.trim();

    return this.sendMail({ to, subject, html });
  }

// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️  تأكد أن هذا الكود داخل class MailService { ... }
// ═══════════════════════════════════════════════════════════════════════════════
