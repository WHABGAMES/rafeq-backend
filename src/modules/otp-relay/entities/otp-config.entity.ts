import { Entity, Column, Index, CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export enum OtpPlatform {
  STEAM = 'steam', NETFLIX = 'netflix', GMAIL = 'gmail', HOTMAIL = 'hotmail',
  OUTLOOK = 'outlook', YAHOO = 'yahoo', EPIC_GAMES = 'epic_games',
  PLAYSTATION = 'playstation', XBOX = 'xbox', DISCORD = 'discord',
  TWITTER = 'twitter', INSTAGRAM = 'instagram', TIKTOK = 'tiktok', CUSTOM = 'custom',
}

export const PLATFORM_PRESETS: Record<string, {
  label: string; icon: string; senderEmail: string; subjectContains: string;
  otpRegex: string; otpLength: number; needsUsername: boolean; usernameLabel: string;
  usernameRegex: string;
}> = {
  steam: { label: 'Steam', icon: '🎮', senderEmail: 'noreply@steampowered.com', subjectContains: '', otpRegex: '([A-Z0-9]{5})', otpLength: 5, needsUsername: true, usernameLabel: 'اسم المستخدم (Steam)', usernameRegex: '^([A-Za-z0-9_.-]+),' },
  netflix: { label: 'Netflix', icon: '🎬', senderEmail: 'info@account.netflix.com', subjectContains: 'verification', otpRegex: '(\\d{4,6})', otpLength: 4, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  gmail: { label: 'Gmail', icon: '📧', senderEmail: 'accounts.google.com', subjectContains: 'verification', otpRegex: '(\\d{6})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  hotmail: { label: 'Hotmail', icon: '📨', senderEmail: 'accountprotection.microsoft.com', subjectContains: 'security code', otpRegex: '(\\d{6,8})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  outlook: { label: 'Outlook', icon: '📬', senderEmail: 'accountprotection.microsoft.com', subjectContains: 'security code', otpRegex: '(\\d{6,8})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  epic_games: { label: 'Epic Games', icon: '🎯', senderEmail: 'help@epicgames.com', subjectContains: 'verification', otpRegex: '(\\d{6})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  playstation: { label: 'PlayStation', icon: '🕹️', senderEmail: 'sony.com', subjectContains: 'verification', otpRegex: '(\\d{6})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  discord: { label: 'Discord', icon: '💬', senderEmail: 'noreply@discord.com', subjectContains: 'verify', otpRegex: '(\\d{6})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
  custom: { label: 'مخصص', icon: '⚙️', senderEmail: '', subjectContains: '', otpRegex: '([A-Z0-9]{4,8})', otpLength: 6, needsUsername: false, usernameLabel: '', usernameRegex: '' },
};

@Entity('otp_configs')
@Index(['tenantId', 'storeId'])
@Index(['slug'], { unique: true })
export class OtpConfig extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'store_id', type: 'uuid' }) storeId: string;
  @Column({ type: 'varchar', length: 100, unique: true }) slug: string;
  @Column({ type: 'enum', enum: OtpPlatform, default: OtpPlatform.STEAM }) platform: OtpPlatform;

  // Page Design
  @Column({ name: 'page_title', default: 'الحصول على رمز التحقق' }) pageTitle: string;
  @Column({ name: 'page_subtitle', type: 'text', nullable: true }) pageSubtitle?: string;
  @Column({ name: 'logo_url', type: 'text', nullable: true }) logoUrl?: string;
  @Column({ name: 'bg_color', type: 'varchar', length: 7, default: '#0a0e1a' }) bgColor: string;
  @Column({ name: 'primary_color', type: 'varchar', length: 7, default: '#06b6d4' }) primaryColor: string;
  @Column({ name: 'card_color', type: 'varchar', length: 9, default: '#111827' }) cardColor: string;
  @Column({ name: 'text_color', type: 'varchar', length: 7, default: '#ffffff' }) textColor: string;
  @Column({ name: 'secondary_text_color', type: 'varchar', length: 7, default: '#94a3b8' }) secondaryTextColor: string;
  @Column({ name: 'bg_image_url', type: 'varchar', length: 500, nullable: true }) bgImageUrl?: string;
  @Column({ name: 'success_msg', default: 'تم استخراج الرمز بنجاح ✅' }) successMsg: string;
  @Column({ name: 'no_code_msg', default: 'لم يتم العثور على رمز جديد. أعد إرسال الرمز من المنصة وحاول بعد دقيقة.' }) noCodeMsg: string;
  @Column({ name: 'needs_username', type: 'boolean', default: false }) needsUsername: boolean;
  @Column({ name: 'username_label', default: 'اسم المستخدم' }) usernameLabel: string;
  @Column({ name: 'order_label', default: 'رقم الطلب' }) orderLabel: string;
  @Column({ name: 'button_text', default: 'الحصول على الرمز' }) buttonText: string;
  @Column({ name: 'footer_text', type: 'varchar', length: 255, nullable: true }) footerText?: string;
  @Column({ name: 'show_rafeq_badge', type: 'boolean', default: true }) showRafeqBadge: boolean;

  // ═══ Support Contact ═══
  @Column({ name: 'support_whatsapp', type: 'varchar', length: 20, nullable: true }) supportWhatsapp?: string;
  @Column({ name: 'support_discord', type: 'varchar', length: 255, nullable: true }) supportDiscord?: string;
  @Column({ name: 'support_instagram', type: 'varchar', length: 100, nullable: true }) supportInstagram?: string;
  @Column({ name: 'support_tiktok', type: 'varchar', length: 100, nullable: true }) supportTiktok?: string;
  @Column({ name: 'support_twitter', type: 'varchar', length: 100, nullable: true }) supportTwitter?: string;

  // Email IMAP
  @Column({ name: 'email_host' }) emailHost: string;
  @Column({ name: 'email_port', type: 'integer', default: 993 }) emailPort: number;
  @Column({ name: 'email_user' }) emailUser: string;
  @Column({ name: 'email_password', type: 'text', select: false }) emailPassword: string;
  @Column({ name: 'email_tls', type: 'boolean', default: true }) emailTls: boolean;

  // OTP Extraction
  @Column({ name: 'sender_filter', nullable: true }) senderFilter?: string;
  @Column({ name: 'subject_filter', nullable: true }) subjectFilter?: string;
  @Column({ name: 'otp_regex', type: 'varchar', length: 500, nullable: true }) otpRegex?: string;
  @Column({ name: 'otp_length', type: 'integer', default: 5 }) otpLength: number;
  @Column({ name: 'freshness_minutes', type: 'integer', default: 3 }) freshnessMinutes: number;
  @Column({ name: 'username_regex', type: 'varchar', length: 500, nullable: true }) usernameRegex?: string;

  // Security
  @Column({ name: 'verify_order', type: 'boolean', default: true }) verifyOrder: boolean;
  @Column({ name: 'rate_limit', type: 'integer', default: 3 }) rateLimit: number;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  // ═══ WhatsApp Notifications ═══════════════════════════════
  // إشعار الموظفين عند طلب رمز تحقق
  @Column({ name: 'notify_employees', type: 'boolean', default: false }) notifyEmployees: boolean;
  @Column({ name: 'employee_phones', type: 'text', nullable: true, comment: 'أرقام هواتف الموظفين مفصولة بفاصلة (966XXXXXXXXX)' }) employeePhones?: string;

  @Column({ name: 'employee_emails', type: 'text', nullable: true, comment: 'إيميلات الموظفين مفصولة بفاصلة' }) employeeEmails?: string;
  @Column({ name: 'employee_msg_template', type: 'text', nullable: true }) employeeMsgTemplate?: string;

  // إرسال الكود للعميل عبر واتساب
  @Column({ name: 'send_code_to_customer', type: 'boolean', default: false }) sendCodeToCustomer: boolean;
  @Column({ name: 'customer_msg_template', type: 'text', nullable: true }) customerMsgTemplate?: string;

  // ═══ Order Code Limit ═══════════════════════════════════
  // عدد مرات استخراج الكود لكل طلب — 0 = بلا حد
  @Column({ name: 'max_codes_per_order', type: 'integer', default: 1 }) maxCodesPerOrder: number;

  // ═══ OTP Method — طريقة استخراج الكود ═══════════════════
  @Column({ name: 'otp_method', type: 'varchar', length: 20, default: 'email', comment: 'email | telegram_bot' })
  otpMethod: string;

  @Column({ name: 'telegram_bot_flow_id', type: 'varchar', length: 50, nullable: true, comment: 'معرّف flow البوت (مثل: netflix_household)' })
  telegramBotFlowId?: string;

  // ═══ Compensation System — نظام التعويضات ═══════════════
  @Column({ name: 'compensation_enabled', type: 'boolean', default: false, comment: 'تفعيل خدمة التعويضات' })
  compensationEnabled: boolean;

  @Column({ name: 'compensation_method', type: 'varchar', length: 20, default: 'auto', comment: 'manual | auto' })
  compensationMethod: string;

  @Column({ name: 'max_compensations_per_order', type: 'integer', default: 1, comment: 'عدد التعويضات المسموحة لكل طلب' })
  maxCompensationsPerOrder: number;

  @Column({ name: 'compensation_button_text', type: 'varchar', length: 100, default: 'طلب تعويض', comment: 'نص زر التعويض' })
  compensationButtonText: string;

  @Column({ name: 'compensation_success_msg', type: 'text', default: 'تم تعويضك بحساب جديد بنجاح ✅', comment: 'رسالة نجاح التعويض' })
  compensationSuccessMsg: string;

  @Column({ name: 'compensation_empty_msg', type: 'text', default: 'عذراً، لا توجد حسابات متاحة حالياً. تواصل مع الدعم.', comment: 'رسالة نفاذ المخزون' })
  compensationEmptyMsg: string;

  @Column({ name: 'compensation_limit_msg', type: 'text', default: 'تم استنفاد عدد التعويضات المسموحة لهذا الطلب.', comment: 'رسالة تجاوز الحد' })
  compensationLimitMsg: string;

  @Column({ name: 'compensation_notify_employee', type: 'boolean', default: false, comment: 'إشعار الموظف عند التعويض' })
  compensationNotifyEmployee: boolean;

  @Column({ name: 'compensation_employee_template', type: 'text', nullable: true, comment: 'قالب رسالة إشعار التعويض للموظف' })
  compensationEmployeeTemplate?: string;

  @Column({ name: 'compensation_notify_customer', type: 'boolean', default: false, comment: 'إرسال التعويض للعميل عبر واتساب' })
  compensationNotifyCustomer: boolean;

  @Column({ name: 'compensation_customer_template', type: 'text', nullable: true, comment: 'قالب رسالة التعويض للعميل' })
  compensationCustomerTemplate?: string;

  // ── إحصائيات التعويضات (cached) ──
  @Column({ name: 'inventory_total', type: 'integer', default: 0 }) inventoryTotal: number;
  @Column({ name: 'inventory_available', type: 'integer', default: 0 }) inventoryAvailable: number;
  @Column({ name: 'total_compensations', type: 'integer', default: 0 }) totalCompensations: number;

  // Analytics
  @Column({ name: 'total_views', type: 'integer', default: 0 }) totalViews: number;
  @Column({ name: 'total_requests', type: 'integer', default: 0 }) totalRequests: number;
  @Column({ name: 'success_count', type: 'integer', default: 0 }) successCount: number;
  @Column({ name: 'fail_count', type: 'integer', default: 0 }) failCount: number;
}

@Entity('otp_request_logs')
@Index(['configId'])
@Index(['tenantId', 'createdAt'])
export class OtpRequestLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'config_id', type: 'uuid' }) configId: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'store_id', type: 'uuid' }) storeId: string;
  @Column({ name: 'order_number', nullable: true }) orderNumber?: string;
  @Column({ nullable: true }) username?: string;
  @Column({ name: 'client_ip', type: 'varchar', length: 50 }) clientIp: string;
  @Column({ type: 'boolean', default: false }) success: boolean;
  @Column({ name: 'error_msg', type: 'text', nullable: true }) errorMsg?: string;
  @Column({ name: 'response_ms', type: 'integer', nullable: true }) responseMs?: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
