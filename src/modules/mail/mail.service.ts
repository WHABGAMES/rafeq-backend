/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Welcome Credentials Email Template              ║
 * ║                                                                               ║
 * ║  📧 Method to add to MailService for sending login credentials                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 * 
 * أضف هذا الـ method في mail.service.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// أضف هذا الـ interface في الأعلى
// ═══════════════════════════════════════════════════════════════════════════════

interface WelcomeCredentialsOptions {
  to: string;
  name: string;
  storeName: string;
  email: string;
  password: string;
  loginUrl: string;
  isNewUser: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// أضف هذا الـ method في MailService class
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🎉 إرسال بيانات الدخول للتاجر
 */
async sendWelcomeCredentials(options: WelcomeCredentialsOptions): Promise<boolean> {
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
          
          <!-- Header with Logo -->
          <tr>
            <td align="center" style="padding: 30px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr">
                <tr>
                  <td style="vertical-align: middle; padding-left: 12px;">
                    <svg width="48" height="48" viewBox="0 0 100 100">
                      <defs>
                        <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style="stop-color:#2dd4bf"/>
                          <stop offset="50%" style="stop-color:#a78bfa"/>
                          <stop offset="100%" style="stop-color:#a855f7"/>
                        </linearGradient>
                      </defs>
                      <polygon points="50,5 90,27.5 90,72.5 50,95 10,72.5 10,27.5" fill="none" stroke="url(#rg)" stroke-width="3"/>
                      <path d="M35,30 L35,70 M35,30 L55,30 Q70,30 70,45 Q70,55 55,55 L35,55 M55,55 L70,70" fill="none" stroke="url(#rg)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 32px; font-weight: bold; background: linear-gradient(135deg, #2dd4bf 0%, #a78bfa 50%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">RAFEQ</span>
                  </td>
                </tr>
              </table>
              <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 14px;">مساعدك الذكي لدعم العملاء</p>
            </td>
          </tr>
          
          <!-- Main Content Card -->
          <tr>
            <td style="background: linear-gradient(135deg, rgba(45, 212, 191, 0.1), rgba(168, 85, 247, 0.1)); border-radius: 16px; padding: 32px; border: 1px solid rgba(148, 163, 184, 0.2);">
              
              <!-- Greeting -->
              <h2 style="color: #ffffff; margin: 0 0 16px 0; font-size: 24px; text-align: right;">
                مرحباً ${name}! 👋
              </h2>
              
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.8; text-align: right; margin: 0 0 24px 0;">
                ${isNewUser ? 'يسعدنا انضمامك لعائلة رفيق! 🎉' : 'هذا تذكير ببيانات دخولك 🔐'}
              </p>

              <!-- Credentials Box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: rgba(15, 23, 42, 0.8); border-radius: 12px; border: 1px solid rgba(45, 212, 191, 0.3);">
                <tr>
                  <td style="padding: 24px;">
                    <h3 style="color: #2dd4bf; margin: 0 0 20px 0; font-size: 18px; text-align: right;">🔐 بيانات الدخول</h3>
                    
                    <!-- Email -->
                    <p style="color: #94a3b8; margin: 0 0 8px 0; font-size: 14px; text-align: right;">📧 البريد الإلكتروني:</p>
                    <p style="color: #ffffff; margin: 0 0 20px 0; font-size: 18px; font-weight: bold; background: rgba(45, 212, 191, 0.1); padding: 12px; border-radius: 8px; text-align: right; direction: ltr;">
                      ${email}
                    </p>
                    
                    <!-- Password -->
                    <p style="color: #94a3b8; margin: 0 0 8px 0; font-size: 14px; text-align: right;">🛡️ رمز الدخول:</p>
                    <p style="color: #ffffff; margin: 0; font-size: 20px; font-weight: bold; background: rgba(168, 85, 247, 0.1); padding: 12px; border-radius: 8px; text-align: center; font-family: 'Courier New', monospace; letter-spacing: 2px;">
                      ${password}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 32px 0;">
                    <a href="${loginUrl}" style="display: inline-block; background: linear-gradient(135deg, #2dd4bf, #a78bfa, #a855f7); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 18px; font-weight: bold;">
                      🚪 دخول لوحة التحكم
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security Note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: rgba(251, 191, 36, 0.1); border-radius: 8px; border-right: 4px solid #fbbf24;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="color: #fbbf24; margin: 0; font-size: 14px; text-align: right;">
                      💡 <strong>نصيحة أمنية:</strong> ننصحك بتغيير رمز الدخول من إعدادات الحساب.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px 0; text-align: center; border-top: 1px solid rgba(148, 163, 184, 0.2); margin-top: 24px;">
              <p style="color: #94a3b8; font-size: 14px; margin: 0 0 8px 0;">
                📞 تحتاج مساعدة؟ فريقنا متواجد 24/7 لخدمتك!
              </p>
              <p style="color: #64748b; font-size: 12px; margin: 0;">
                مع تحيات فريق رفيق 🤍
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
