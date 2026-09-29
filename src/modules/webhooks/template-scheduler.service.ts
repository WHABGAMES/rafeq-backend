/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║        RAFIQ PLATFORM - Template Scheduler Service                             ║
 * ║                                                                                ║
 * ║  📌 يدير الإرسال المؤجل للقوالب عبر BullMQ                                    ║
 * ║  ✅ جدولة الإرسال بعد تأخير محدد                                               ║
 * ║  ✅ إلغاء الإرسال المعلّق (عند إكمال الطلب مثلاً)                                ║
 * ║  ✅ منع التكرار — لا يرسل نفس القالب لنفس العميل مرتين                          ║
 * ║  ✅ دعم التسلسلات (سلة متروكة 1→2→3)                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ScheduledTemplateSend,
  ScheduledSendStatus,
} from '@database/entities/scheduled-template-send.entity';
import { MessageTemplate } from '@database/entities/message-template.entity';

export interface ScheduleTemplateJobData {
  scheduledSendId: string;
  templateId: string;
  tenantId: string;
  storeId?: string;
  customerPhone: string;
  customerName?: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class TemplateSchedulerService {
  private readonly logger = new Logger(TemplateSchedulerService.name);

  constructor(
    @InjectRepository(ScheduledTemplateSend)
    private readonly scheduledSendRepo: Repository<ScheduledTemplateSend>,

    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,

    @InjectQueue('template-scheduler')
    private readonly schedulerQueue: Queue,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // جدولة إرسال مؤجل
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ جدولة إرسال قالب بعد تأخير محدد
   * يُنشئ سجل في DB + job في BullMQ
   */
  async scheduleDelayedSend(params: {
    template: MessageTemplate;
    tenantId: string;
    storeId?: string;
    customerPhone: string;
    customerName?: string;
    referenceId?: string;
    referenceType?: string;
    triggerEvent: string;
    payload: Record<string, unknown>;
    delayMinutes: number;
    sequenceGroupKey?: string;
    sequenceOrder?: number;
  }): Promise<ScheduledTemplateSend | null> {
    const {
      template, tenantId, storeId, customerPhone, customerName,
      referenceId, referenceType, triggerEvent, payload,
      delayMinutes, sequenceGroupKey, sequenceOrder,
    } = params;

    // ✅ فحص التكرار — لا نرسل نفس القالب لنفس العميل لنفس المرجع
    const isDuplicate = await this.isDuplicateSend(
      tenantId, template.id, customerPhone, referenceId,
    );

    if (isDuplicate) {
      this.logger.warn(
        `🔁 Duplicate detected: template="${template.name}" phone=${customerPhone} ref=${referenceId}`,
      );
      return null;
    }

    // ✅ فحص حد الإرسال لكل عميل
    const sendSettings = template.sendSettings;
    if (sendSettings?.maxSendsPerCustomer) {
      const isOverLimit = await this.isOverSendLimit(
        tenantId, template.id, customerPhone,
        sendSettings.maxSendsPerCustomer.count,
        sendSettings.maxSendsPerCustomer.periodDays,
      );
      if (isOverLimit) {
        this.logger.warn(
          `⛔ Send limit reached: template="${template.name}" phone=${customerPhone}`,
        );
        return null;
      }
    }

    // حساب وقت الإرسال
    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    // إنشاء سجل في DB
    const scheduledSend = this.scheduledSendRepo.create({
      tenantId,
      storeId,
      templateId: template.id,
      templateName: template.name,
      customerPhone,
      customerName,
      referenceId,
      referenceType,
      triggerEvent,
      sequenceGroupKey,
      sequenceOrder,
      status: ScheduledSendStatus.PENDING,
      scheduledAt,
      payload,
    });

    const saved = await this.scheduledSendRepo.save(scheduledSend);

    // إنشاء BullMQ job مع delay
    const delayMs = delayMinutes * 60 * 1000;
    const jobData: ScheduleTemplateJobData = {
      scheduledSendId: saved.id,
      templateId: template.id,
      tenantId,
      storeId,
      customerPhone,
      customerName,
      payload,
    };

    const job = await this.schedulerQueue.add(
      `send-template-${template.name}`,
      jobData,
      {
        delay: delayMs,
        jobId: `sched-${saved.id}`,
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { count: 5000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
      },
    );

    // حفظ bullJobId للإلغاء لاحقاً
    saved.bullJobId = job.id;
    await this.scheduledSendRepo.save(saved);

    this.logger.log(
      `⏰ Scheduled: "${template.name}" → ${customerPhone} at ${scheduledAt.toISOString()} (delay: ${delayMinutes}min)`,
      { scheduledSendId: saved.id, jobId: job.id },
    );

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إلغاء الإرسال المعلّق
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ إلغاء كل الإرسال المعلّق لمرجع معين
   * مثال: عميل أكمل الطلب → ألغِ تذكيرات السلة المتروكة
   */
  async cancelPendingSends(params: {
    tenantId: string;
    referenceId: string;
    reason: string;
    sequenceGroupKey?: string;
  }): Promise<number> {
    const { tenantId, referenceId, reason, sequenceGroupKey } = params;

    const whereClause: FindOptionsWhere<ScheduledTemplateSend> = {
      tenantId,
      status: ScheduledSendStatus.PENDING,
    };

    if (sequenceGroupKey) {
      whereClause.sequenceGroupKey = sequenceGroupKey;
      whereClause.referenceId = referenceId;
    } else {
      whereClause.referenceId = referenceId;
    }

    const pendingSends = await this.scheduledSendRepo.find({ where: whereClause });

    if (pendingSends.length === 0) return 0;

    let cancelledCount = 0;

    for (const send of pendingSends) {
      // إلغاء BullMQ job
      if (send.bullJobId) {
        try {
          const job = await this.schedulerQueue.getJob(send.bullJobId);
          if (job) {
            await job.remove();
            this.logger.log(`🗑️ Removed BullMQ job: ${send.bullJobId}`);
          }
        } catch (err) {
          this.logger.warn(`⚠️ Failed to remove job ${send.bullJobId}: ${err}`);
        }
      }

      // تحديث الحالة
      send.status = ScheduledSendStatus.CANCELLED;
      send.cancelledAt = new Date();
      send.cancelReason = reason;
      cancelledCount++;
    }

    await this.scheduledSendRepo.save(pendingSends);

    this.logger.log(
      `❌ Cancelled ${cancelledCount} pending sends for ref=${referenceId} (reason: ${reason})`,
    );

    return cancelledCount;
  }

  /**
   * ✅ إلغاء كل الإرسال المعلّق لرقم هاتف عميل + تسلسل محدد
   */
  async cancelSequenceSends(params: {
    tenantId: string;
    customerPhone: string;
    sequenceGroupKey: string;
    reason: string;
  }): Promise<number> {
    const { tenantId, customerPhone, sequenceGroupKey, reason } = params;

    const pendingSends = await this.scheduledSendRepo.find({
      where: {
        tenantId,
        customerPhone,
        sequenceGroupKey,
        status: ScheduledSendStatus.PENDING,
      },
    });

    if (pendingSends.length === 0) return 0;

    for (const send of pendingSends) {
      if (send.bullJobId) {
        try {
          const job = await this.schedulerQueue.getJob(send.bullJobId);
          if (job) await job.remove();
        } catch (err) {
          this.logger.warn(`⚠️ Failed to remove job: ${err}`);
        }
      }

      send.status = ScheduledSendStatus.CANCELLED;
      send.cancelledAt = new Date();
      send.cancelReason = reason;
    }

    await this.scheduledSendRepo.save(pendingSends);
    return pendingSends.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Event Listeners — إلغاء تلقائي عند أحداث معينة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ عند إنشاء طلب → ألغِ تذكيرات السلة المتروكة
   */
  @OnEvent('order.created')
  async onOrderCreatedCancelCart(payload: Record<string, unknown>) {
    const tenantId = payload.tenantId as string;
    const raw = (payload.raw || payload) as Record<string, unknown>;
    const customer = (raw.customer || {}) as Record<string, unknown>;
    const phone = String(customer.mobile || customer.phone || raw.customerPhone || '');

    if (!tenantId || !phone) return;

    const cancelled = await this.cancelSequenceSends({
      tenantId,
      customerPhone: phone.replace(/[\s()+-]/g, ''),
      sequenceGroupKey: 'cart_abandoned',
      reason: 'العميل أكمل الطلب',
    });

    if (cancelled > 0) {
      this.logger.log(`🛒→✅ Cancelled ${cancelled} abandoned cart reminders (customer completed order)`);
    }

    // ✅ إلغاء ديناميكي — أي قالب فيه cancelOnEvents يتضمن 'order.created'
    await this.dynamicCancelByEvent('order.created', tenantId, raw);
  }

  /**
   * ✅ عند الدفع → ألغِ تذكيرات الدفع
   */
  @OnEvent('order.payment.updated')
  async onPaymentCancelReminders(payload: Record<string, unknown>) {
    const tenantId = payload.tenantId as string;
    const raw = (payload.raw || payload) as Record<string, unknown>;
    const orderId = String(raw.id || raw.orderId || '');

    if (!tenantId || !orderId) return;

    const cancelled = await this.cancelPendingSends({
      tenantId,
      referenceId: orderId,
      reason: 'تم الدفع',
    });

    if (cancelled > 0) {
      this.logger.log(`💳 Cancelled ${cancelled} payment reminders (payment received)`);
    }

    await this.dynamicCancelByEvent('order.payment.updated', tenantId, raw);
  }

  /**
   * ✅ v2: عند تسليم الطلب → ألغِ أي إرسال معلّق مرتبط بهذا الطلب
   */
  @OnEvent('order.delivered')
  async onOrderDeliveredCancel(payload: Record<string, unknown>) {
    const tenantId = payload.tenantId as string;
    const raw = (payload.raw || payload) as Record<string, unknown>;
    await this.dynamicCancelByEvent('order.delivered', tenantId, raw);
  }

  /**
   * ✅ v2: عند إلغاء الطلب → ألغِ أي إرسال معلّق مرتبط بهذا الطلب
   */
  @OnEvent('order.cancelled')
  async onOrderCancelledCancel(payload: Record<string, unknown>) {
    const tenantId = payload.tenantId as string;
    const raw = (payload.raw || payload) as Record<string, unknown>;
    const orderId = String(raw.id || raw.orderId || '');

    if (!tenantId || !orderId) return;

    // إلغاء كل الإرسال المعلّق لهذا الطلب
    const cancelled = await this.cancelPendingSends({
      tenantId,
      referenceId: orderId,
      reason: 'تم إلغاء الطلب',
    });

    if (cancelled > 0) {
      this.logger.log(`❌ Cancelled ${cancelled} pending sends (order cancelled)`);
    }

    await this.dynamicCancelByEvent('order.cancelled', tenantId, raw);
  }

  /**
   * ✅ v2: عند استرجاع الطلب → ألغِ أي إرسال معلّق
   */
  @OnEvent('order.refunded')
  async onOrderRefundedCancel(payload: Record<string, unknown>) {
    const tenantId = payload.tenantId as string;
    const raw = (payload.raw || payload) as Record<string, unknown>;
    await this.dynamicCancelByEvent('order.refunded', tenantId, raw);
  }

  /**
   * ✅ v2: إلغاء ديناميكي بناءً على cancelOnEvents في sendSettings
   * يبحث عن كل الإرسال المعلّق الذي قالبه يتضمن هذا الحدث في cancelOnEvents
   */
  private async dynamicCancelByEvent(
    eventName: string,
    tenantId: string,
    rawData: Record<string, unknown>,
  ): Promise<void> {
    if (!tenantId) return;

    try {
      // البحث عن القوالب التي فيها cancelOnEvents تتضمن هذا الحدث
      const templates = await this.templateRepo
        .createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere(`t.send_settings->'cancelOnEvents' ? :event`, { event: eventName })
        .andWhere('t.deleted_at IS NULL')
        .select(['t.id', 't.name'])
        .getMany();

      if (templates.length === 0) return;

      const templateIds = templates.map(t => t.id);
      const orderId = String(rawData.id || rawData.orderId || rawData.order_id || '');
      const customer = (rawData.customer || {}) as Record<string, unknown>;
      const phone = String(customer.mobile || customer.phone || rawData.customerPhone || '').replace(/[\s()+-]/g, '');

      // البحث عن الإرسال المعلّق لهذه القوالب
      const qb = this.scheduledSendRepo
        .createQueryBuilder('s')
        .where('s.tenant_id = :tenantId', { tenantId })
        .andWhere('s.template_id IN (:...templateIds)', { templateIds })
        .andWhere('s.status = :status', { status: ScheduledSendStatus.PENDING });

      // تضييق البحث حسب المرجع أو رقم الهاتف
      if (orderId) {
        qb.andWhere('(s.reference_id = :orderId OR s.customer_phone = :phone)', { orderId, phone });
      } else if (phone) {
        qb.andWhere('s.customer_phone = :phone', { phone });
      }

      const pendingSends = await qb.getMany();
      if (pendingSends.length === 0) return;

      let cancelledCount = 0;
      for (const send of pendingSends) {
        if (send.bullJobId) {
          try {
            const job = await this.schedulerQueue.getJob(send.bullJobId);
            if (job) await job.remove();
          } catch (err) {
            this.logger.warn(`⚠️ Failed to remove job: ${err}`);
          }
        }
        send.status = ScheduledSendStatus.CANCELLED;
        send.cancelledAt = new Date();
        send.cancelReason = `حدث إلغاء: ${eventName}`;
        cancelledCount++;
      }

      await this.scheduledSendRepo.save(pendingSends);

      if (cancelledCount > 0) {
        this.logger.log(
          `🔄 Dynamic cancel: ${cancelledCount} sends cancelled by event "${eventName}" (templates: ${templates.map(t => t.name).join(', ')})`,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Dynamic cancel failed for event "${eventName}": ${msg}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // فحص التكرار
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ هل يوجد إرسال معلّق أو مُرسل لنفس القالب + العميل + المرجع؟
   */
  private async isDuplicateSend(
    tenantId: string,
    templateId: string,
    customerPhone: string,
    referenceId?: string,
  ): Promise<boolean> {
    const where: FindOptionsWhere<ScheduledTemplateSend> = {
      tenantId,
      templateId,
      customerPhone,
      status: In([ScheduledSendStatus.PENDING, ScheduledSendStatus.SENT]),
    };

    if (referenceId) {
      where.referenceId = referenceId;
    }

    const existing = await this.scheduledSendRepo.findOne({
      where,
      select: ['id'],
    });

    return !!existing;
  }

  /**
   * ✅ هل تجاوز العميل حد الإرسال الأقصى؟
   */
  private async isOverSendLimit(
    tenantId: string,
    templateId: string,
    customerPhone: string,
    maxCount: number,
    periodDays: number,
  ): Promise<boolean> {
    const since = new Date();
    since.setDate(since.getDate() - periodDays);

    const count = await this.scheduledSendRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.template_id = :templateId', { templateId })
      .andWhere('s.customer_phone = :customerPhone', { customerPhone })
      .andWhere('s.status = :status', { status: ScheduledSendStatus.SENT })
      .andWhere('s.sent_at >= :since', { since })
      .getCount();

    return count >= maxCount;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إحصائيات
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStats(tenantId: string): Promise<{
    pending: number;
    sent: number;
    cancelled: number;
    failed: number;
  }> {
    const results = await this.scheduledSendRepo
      .createQueryBuilder('s')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('s.tenant_id = :tenantId', { tenantId })
      .groupBy('s.status')
      .getRawMany();

    const stats = { pending: 0, sent: 0, cancelled: 0, failed: 0 };
    for (const row of results) {
      const key = row.status as keyof typeof stats;
      if (key in stats) stats[key] = parseInt(row.count, 10);
    }
    return stats;
  }

  /**
   * ✅ تحديث حالة الإرسال بعد النجاح
   */
  async markAsSent(scheduledSendId: string, finalMessage?: string): Promise<void> {
    const update: QueryDeepPartialEntity<ScheduledTemplateSend> = {
      status: ScheduledSendStatus.SENT,
      sentAt: new Date(),
      finalMessage,
      attempts: () => 'attempts + 1',
    };
    await this.scheduledSendRepo.update(scheduledSendId, update);
  }

  /**
   * ✅ تحديث حالة الإرسال بعد الفشل
   */
  async markAsFailed(scheduledSendId: string, errorMessage: string): Promise<void> {
    const update: QueryDeepPartialEntity<ScheduledTemplateSend> = {
      status: ScheduledSendStatus.FAILED,
      errorMessage,
      attempts: () => 'attempts + 1',
    };
    await this.scheduledSendRepo.update(scheduledSendId, update);
  }

  /**
   * ✅ جلب سجل الإرسال المجدول
   */
  async findById(id: string): Promise<ScheduledTemplateSend | null> {
    return this.scheduledSendRepo.findOne({ where: { id } });
  }
}
