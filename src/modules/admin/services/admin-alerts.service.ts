/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  AdminAlertsService — Super-admin event notification dispatcher          ║
 * ║                                                                          ║
 * ║  Responsibilities:                                                       ║
 * ║   • CRUD for alert recipients (phones that receive system alerts)        ║
 * ║   • Event dispatch: given (eventKey, payload), fan out to all            ║
 * ║     active recipients subscribed to that event                           ║
 * ║   • Message formatting per event type (WhatsApp-friendly markdown)       ║
 * ║   • Usage tracking (sent_count, last_sent_at)                            ║
 * ║   • Event metadata (for UI to render subscription checkboxes)            ║
 * ║                                                                          ║
 * ║  Scalability notes:                                                      ║
 * ║   • dispatchEvent is fire-and-forget from listener perspective           ║
 * ║   • Each recipient gets a separate BullMQ job (parallel, retryable)      ║
 * ║   • Failures in one recipient don't affect others                        ║
 * ║   • Schema auto-creates via onModuleInit (like other admin services)    ║
 * ║                                                                          ║
 * ║  Security:                                                               ║
 * ║   • No tenantId — admin-scoped only                                      ║
 * ║   • Phone format validation (E.164 strict)                               ║
 * ║   • Unique phone constraint prevents duplicates                          ║
 * ║   • Payload sanitization before logging                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository, DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { AdminAlertRecipient } from '../entities/admin-alert-recipient.entity';

// ─── Event metadata (single source of truth) ───────────────────────────────

export interface AlertEventMeta {
  key: string;
  label: string;
  labelEn: string;
  icon: string;
  description: string;
  category: 'onboarding' | 'security' | 'stores' | 'billing';
}

export const ALERT_EVENTS: AlertEventMeta[] = [
  {
    key: 'user.created',
    label: 'تاجر جديد سجّل',
    labelEn: 'New Merchant Registered',
    icon: '🆕',
    description: 'عند إنشاء حساب تاجر جديد في المنصة',
    category: 'onboarding',
  },
  {
    key: 'auth.login.new_device',
    label: 'دخول من جهاز جديد',
    labelEn: 'Login from New Device',
    icon: '🔐',
    description: 'عند دخول تاجر من جهاز/IP لم يُستخدم من قبل',
    category: 'security',
  },
  {
    key: 'auth.login.multiple_failures',
    label: 'محاولات دخول فاشلة متكرّرة',
    labelEn: 'Multiple Failed Login Attempts',
    icon: '⚠️',
    description: 'عند تكرار محاولات دخول فاشلة (3 أو أكثر) لنفس البريد',
    category: 'security',
  },
  {
    key: 'store.connected',
    label: 'متجر جديد ربط',
    labelEn: 'New Store Connected',
    icon: '🏪',
    description: 'عند ربط متجر Salla / Zid / Shopify بحساب تاجر',
    category: 'stores',
  },
  {
    key: 'subscription.created',
    label: 'اشتراك جديد',
    labelEn: 'New Subscription',
    icon: '💳',
    description: 'عند إنشاء اشتراك جديد (ترقية من الخطة المجانية)',
    category: 'billing',
  },
  {
    key: 'subscription.cancelled',
    label: 'إلغاء اشتراك',
    labelEn: 'Subscription Cancelled',
    icon: '❌',
    description: 'عند إلغاء تاجر لاشتراكه',
    category: 'billing',
  },
];

const EVENT_KEYS = new Set(ALERT_EVENTS.map(e => e.key));

// ─── Payload types ─────────────────────────────────────────────────────────

export interface AlertPayload {
  [key: string]: unknown;
}

// ─── Input DTOs ────────────────────────────────────────────────────────────

export interface CreateRecipientInput {
  name: string;
  phone: string;
  subscribedEvents?: string[];
  isActive?: boolean;
  note?: string;
}

export interface UpdateRecipientInput {
  name?: string;
  phone?: string;
  subscribedEvents?: string[];
  isActive?: boolean;
  note?: string;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class AdminAlertsService implements OnModuleInit {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(
    @InjectRepository(AdminAlertRecipient)
    private readonly recipientRepo: Repository<AdminAlertRecipient>,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── Schema bootstrap (idempotent) ───────────────────────────────────────

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS admin_alert_recipients (
          id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
          name              VARCHAR(100) NOT NULL,
          phone             VARCHAR(20)  NOT NULL UNIQUE,
          subscribed_events JSONB        NOT NULL DEFAULT '[]',
          is_active         BOOLEAN      NOT NULL DEFAULT true,
          note              VARCHAR(500),
          sent_count        INT          NOT NULL DEFAULT 0,
          last_sent_at      TIMESTAMPTZ,
          created_by        UUID         NOT NULL,
          updated_by        UUID,
          created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_alert_recipient_active
          ON admin_alert_recipients (is_active)
      `);
      // Note: phone has a UNIQUE constraint which auto-creates an index — no need for another.
      this.logger.log('✅ admin_alert_recipients: ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[onModuleInit] schema setup failed: ${msg}`);
    }
  }

  // ─── Metadata (for UI) ───────────────────────────────────────────────────

  getAvailableEvents(): AlertEventMeta[] {
    return ALERT_EVENTS;
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  private validatePhone(phone: string): string {
    const cleaned = phone.trim().replace(/\s+/g, '');
    // E.164: +[country code][number], 8-15 digits total after +
    const e164 = /^\+[1-9]\d{7,14}$/;
    if (!e164.test(cleaned)) {
      throw new BadRequestException(
        'رقم الجوال غير صالح — يجب أن يبدأ بـ + وكود الدولة (مثال: +966500000000)',
      );
    }
    return cleaned;
  }

  private validateEvents(events: string[]): string[] {
    if (!Array.isArray(events)) {
      throw new BadRequestException('subscribedEvents يجب أن يكون مصفوفة');
    }
    const unique = [...new Set(events)];
    for (const k of unique) {
      if (!EVENT_KEYS.has(k)) {
        throw new BadRequestException(`حدث غير معروف: ${k}`);
      }
    }
    return unique;
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async createRecipient(
    input: CreateRecipientInput,
    adminId: string,
  ): Promise<AdminAlertRecipient> {
    if (!input.name?.trim()) {
      throw new BadRequestException('الاسم مطلوب');
    }
    const phone = this.validatePhone(input.phone || '');
    const subscribedEvents = this.validateEvents(input.subscribedEvents || []);

    // Check duplicate phone (unique constraint, but we give a friendly error)
    const existing = await this.recipientRepo.findOne({ where: { phone } });
    if (existing) {
      throw new ConflictException(`الرقم ${phone} مسجّل مسبقاً`);
    }

    const recipient = this.recipientRepo.create({
      name: input.name.trim(),
      phone,
      subscribedEvents,
      isActive: input.isActive ?? true,
      note: input.note?.trim() || undefined,
      createdBy: adminId,
    });

    // ✅ Defensive: catch UNIQUE violation that bypasses our pre-check
    // (can happen in multi-node deployments between findOne and save)
    try {
      const saved = await this.recipientRepo.save(recipient);
      this.logger.log(`✅ Recipient created: ${saved.id} (${saved.phone})`);
      return saved;
    } catch (err) {
      const e = err as { code?: string; driverError?: { code?: string } };
      const pgCode = e?.code || e?.driverError?.code;
      if (pgCode === '23505') {
        throw new ConflictException(`الرقم ${phone} مسجّل مسبقاً`);
      }
      throw err;
    }
  }

  async getAllRecipients(): Promise<AdminAlertRecipient[]> {
    return this.recipientRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getRecipientById(id: string): Promise<AdminAlertRecipient> {
    const r = await this.recipientRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`المستقبل غير موجود: ${id}`);
    return r;
  }

  async updateRecipient(
    id: string,
    input: UpdateRecipientInput,
    adminId: string,
  ): Promise<AdminAlertRecipient> {
    const recipient = await this.getRecipientById(id);

    if (input.name !== undefined) {
      if (!input.name.trim()) throw new BadRequestException('الاسم لا يمكن أن يكون فارغاً');
      recipient.name = input.name.trim();
    }

    if (input.phone !== undefined) {
      const phone = this.validatePhone(input.phone);
      if (phone !== recipient.phone) {
        // Check for conflicts
        const other = await this.recipientRepo.findOne({ where: { phone } });
        if (other && other.id !== id) {
          throw new ConflictException(`الرقم ${phone} مسجّل لمستقبل آخر`);
        }
        recipient.phone = phone;
      }
    }

    if (input.subscribedEvents !== undefined) {
      recipient.subscribedEvents = this.validateEvents(input.subscribedEvents);
    }

    if (input.isActive !== undefined) {
      recipient.isActive = input.isActive;
    }

    if (input.note !== undefined) {
      recipient.note = input.note?.trim() || undefined;
    }

    recipient.updatedBy = adminId;

    // ✅ Defensive catch for UNIQUE violation on phone change
    try {
      const saved = await this.recipientRepo.save(recipient);
      this.logger.log(`📝 Recipient updated: ${id}`);
      return saved;
    } catch (err) {
      const e = err as { code?: string; driverError?: { code?: string } };
      const pgCode = e?.code || e?.driverError?.code;
      if (pgCode === '23505') {
        throw new ConflictException(`الرقم مسجّل مسبقاً لمستقبل آخر`);
      }
      throw err;
    }
  }

  async deleteRecipient(id: string): Promise<void> {
    const recipient = await this.getRecipientById(id);
    await this.recipientRepo.delete(id);
    this.logger.log(`🗑️ Recipient deleted: ${id} (${recipient.phone})`);
  }

  async toggleRecipient(id: string, adminId: string): Promise<AdminAlertRecipient> {
    const recipient = await this.getRecipientById(id);
    recipient.isActive = !recipient.isActive;
    recipient.updatedBy = adminId;
    return this.recipientRepo.save(recipient);
  }

  // ─── Test send (manual trigger from UI) ──────────────────────────────────

  async sendTestAlert(recipientId: string): Promise<{ success: boolean; jobId: string }> {
    const recipient = await this.getRecipientById(recipientId);

    const testMessage =
      `🧪 *رسالة اختبار من رفيق AI*\n\n` +
      `مرحباً ${recipient.name} 👋\n\n` +
      `إذا وصلتك هذه الرسالة، فإن الإشعارات تعمل بشكل صحيح ✅\n\n` +
      `الأحداث المُفعّلة عندك:\n` +
      (recipient.subscribedEvents.length > 0
        ? recipient.subscribedEvents
            .map(k => {
              const ev = ALERT_EVENTS.find(e => e.key === k);
              return `${ev?.icon || '•'} ${ev?.label || k}`;
            })
            .join('\n')
        : '(لا توجد أحداث — فعّل بعضها من لوحة الإدارة)') +
      `\n\n— فريق رفيق AI`;

    const job = await this.notificationQueue.add(
      'send-notification',
      {
        content: testMessage,
        channel: 'whatsapp',
        recipientPhone: recipient.phone,
        triggerEvent: 'admin_alert.test',
      },
      { attempts: 2, removeOnComplete: true, removeOnFail: false },
    );

    return { success: true, jobId: job.id as string };
  }

  // ─── Event dispatch (called by listener) ─────────────────────────────────

  /**
   * Fan out a system event to all matching recipients.
   * Non-blocking: failures are logged but don't throw.
   */
  async dispatchEvent(eventKey: string, payload: AlertPayload): Promise<void> {
    if (!EVENT_KEYS.has(eventKey)) {
      this.logger.warn(`dispatchEvent: unknown event key "${eventKey}"`);
      return;
    }

    try {
      // Find active recipients subscribed to this event (using JSONB contains)
      const recipients: AdminAlertRecipient[] = await this.dataSource.query(
        `SELECT id, name, phone FROM admin_alert_recipients
         WHERE is_active = true
           AND subscribed_events ? $1`,
        [eventKey],
      );

      if (recipients.length === 0) {
        this.logger.debug(`No recipients for event ${eventKey}`);
        return;
      }

      const message = this.formatMessage(eventKey, payload);

      // Queue one job per recipient (parallel, independent retries)
      let queued = 0;
      for (const r of recipients) {
        try {
          await this.notificationQueue.add(
            'send-notification',
            {
              content: message,
              channel: 'whatsapp',
              recipientPhone: r.phone,
              triggerEvent: `admin_alert.${eventKey}`,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: false,
            },
          );

          // Fire-and-forget usage tracking
          this.dataSource
            .query(
              `UPDATE admin_alert_recipients
               SET sent_count = sent_count + 1, last_sent_at = NOW()
               WHERE id = $1`,
              [r.id],
            )
            .catch(() => {});

          queued++;
        } catch (err) {
          this.logger.error(
            `Failed to queue alert to ${r.phone}: ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(`📤 Event ${eventKey}: queued ${queued}/${recipients.length} alerts`);
    } catch (err) {
      this.logger.error(
        `dispatchEvent failed for ${eventKey}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Message formatters (WhatsApp-friendly markdown) ────────────────────

  private formatMessage(eventKey: string, payload: AlertPayload): string {
    const when = this.formatDate(new Date());
    const event = ALERT_EVENTS.find(e => e.key === eventKey);
    const header = `${event?.icon || '🔔'} *${event?.label || eventKey}*`;

    switch (eventKey) {
      case 'user.created':
        return (
          `${header}\n\n` +
          `👤 الاسم: ${this.safe(payload.firstName)} ${this.safe(payload.lastName)}\n` +
          `📧 البريد: ${this.safe(payload.email)}\n` +
          (payload.tenantId ? `🏢 معرّف الحساب: ${this.safe(payload.tenantId)}\n` : '') +
          `🕐 الوقت: ${when}\n\n` +
          `— رفيق AI`
        );

      case 'auth.login.new_device':
        return (
          `${header}\n\n` +
          `📧 التاجر: ${this.safe(payload.email)}\n` +
          `🌐 IP: ${this.safe(payload.ipAddress)}\n` +
          `📱 الجهاز: ${this.truncate(String(payload.userAgent || 'غير معروف'), 80)}\n` +
          `🕐 الوقت: ${when}\n\n` +
          `إذا لم يكن هذا أنت، تواصل مع الدعم فوراً.\n` +
          `— رفيق AI`
        );

      case 'auth.login.multiple_failures':
        return (
          `${header}\n\n` +
          `📧 البريد المستهدف: ${this.safe(payload.email)}\n` +
          `🔢 عدد المحاولات: ${this.safe(payload.attempts)}\n` +
          `🌐 IP: ${this.safe(payload.ipAddress)}\n` +
          `🕐 الوقت: ${when}\n\n` +
          `قد يكون محاولة اختراق — راجع سجل التدقيق.\n` +
          `— رفيق AI`
        );

      case 'store.connected':
        return (
          `${header}\n\n` +
          `🛒 المنصة: ${this.safe(payload.platform)}\n` +
          `🏪 اسم المتجر: ${this.safe(payload.storeName) || '(غير محدد)'}\n` +
          (payload.tenantId ? `🏢 التاجر: ${this.safe(payload.tenantId)}\n` : '') +
          `🕐 الوقت: ${when}\n\n` +
          `— رفيق AI`
        );

      case 'subscription.created':
        return (
          `${header}\n\n` +
          `📧 التاجر: ${this.safe(payload.email) || this.safe(payload.tenantId)}\n` +
          `📦 الخطة: ${this.safe(payload.planName) || this.safe(payload.plan)}\n` +
          (payload.amount ? `💰 المبلغ: ${this.safe(payload.amount)}\n` : '') +
          `🕐 الوقت: ${when}\n\n` +
          `— رفيق AI`
        );

      case 'subscription.cancelled':
        return (
          `${header}\n\n` +
          `📧 التاجر: ${this.safe(payload.email) || this.safe(payload.tenantId)}\n` +
          `📦 الخطة: ${this.safe(payload.planName) || this.safe(payload.plan)}\n` +
          (payload.reason ? `📝 السبب: ${this.safe(payload.reason)}\n` : '') +
          `🕐 الوقت: ${when}\n\n` +
          `— رفيق AI`
        );

      default:
        return (
          `${header}\n\n` +
          `🕐 الوقت: ${when}\n\n` +
          `— رفيق AI`
        );
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private safe(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Prevent log/message injection + length cap
    return s.replace(/[\r\n\x00-\x1F]/g, ' ').slice(0, 200);
  }

  private truncate(s: string, max: number): string {
    if (!s) return '';
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  private formatDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }
}
