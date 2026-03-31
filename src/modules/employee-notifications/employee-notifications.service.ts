/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Employee Notifications Service                       ║
 * ║                                                                                ║
 * ║  المنطق الأساسي: إدارة القواعد + إرسال التنبيهات + استبدال القوالب            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

// Entities
import {
  NotificationRule,
  NotificationTriggerEvent,
  NotificationChannel,
  RecipientType,
} from './entities/notification-rule.entity';
import {
  EmployeeNotification,
  NotificationStatus,
} from './entities/employee-notification.entity';

// DTOs
import {
  CreateNotificationRuleDto,
  UpdateNotificationRuleDto,
  NotificationFilterDto,
  NotificationStatsResponseDto,
} from './dto/notification.dto';

// 👥 لجلب بيانات الموظفين الحقيقية
import { UsersService } from '../users/users.service';

// 🏪 لجلب اسم المتجر
import { StoresService } from '../stores/stores.service';

// 📦 لجلب بيانات الطلب من DB عند الحاجة
import { Order } from '@database/entities';

// 🔗 لجلب بيانات الطلب من Salla API
import { SallaApiService } from '../stores/salla-api.service';
import { Store } from '../stores/entities/store.entity';
import { decrypt } from '@common/utils/encryption.util';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface EmployeeInfo {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

interface EventContext {
  tenantId: string;
  storeId?: string;
  eventType: string;
  data: Record<string, unknown>;
  webhookEventId?: string;
}

interface TemplateVariables {
  [key: string]: string | number | null | undefined;
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

@Injectable()
export class EmployeeNotificationsService {
  private readonly logger = new Logger(EmployeeNotificationsService.name);

  constructor(
    @InjectRepository(NotificationRule)
    private readonly ruleRepository: Repository<NotificationRule>,

    @InjectRepository(EmployeeNotification)
    private readonly notificationRepository: Repository<EmployeeNotification>,

    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,

    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    @InjectQueue('employee-notifications')
    private readonly notificationQueue: Queue,

    // 👥 لجلب بيانات الموظفين
    private readonly usersService: UsersService,

    // 🏪 لجلب اسم المتجر
    private readonly storesService: StoresService,

    // 🔗 لجلب بيانات الطلب من Salla API
    private readonly sallaApiService: SallaApiService,

    // ⚙️ للإعدادات (مثل رابط الواجهة)
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // CRUD: قواعد التنبيهات
  // ═══════════════════════════════════════════════════════════

  /**
   * إنشاء قاعدة تنبيه جديدة
   */
  async createRule(
    tenantId: string,
    dto: CreateNotificationRuleDto,
    createdBy?: string,
  ): Promise<NotificationRule> {
    this.logger.log(`Creating notification rule: ${dto.name}`, { tenantId });

    const rule = this.ruleRepository.create({
      tenantId,
      ...dto,
      createdBy: createdBy || null,
    });

    const saved = await this.ruleRepository.save(rule);
    this.logger.log(`✅ Rule created: ${saved.id} - ${saved.name}`);
    return saved;
  }

  /**
   * تعديل قاعدة تنبيه
   */
  async updateRule(
    tenantId: string,
    ruleId: string,
    dto: UpdateNotificationRuleDto,
  ): Promise<NotificationRule> {
    const rule = await this.ruleRepository.findOne({
      where: { id: ruleId, tenantId },
    });

    if (!rule) {
      throw new NotFoundException(`Notification rule not found: ${ruleId}`);
    }

    Object.assign(rule, dto);
    const saved = await this.ruleRepository.save(rule);
    this.logger.log(`✅ Rule updated: ${saved.id}`);
    return saved;
  }

  /**
   * حذف قاعدة تنبيه
   */
  async deleteRule(tenantId: string, ruleId: string): Promise<void> {
    const rule = await this.ruleRepository.findOne({
      where: { id: ruleId, tenantId },
    });

    if (!rule) {
      throw new NotFoundException(`Notification rule not found: ${ruleId}`);
    }

    await this.ruleRepository.remove(rule);
    this.logger.log(`🗑️ Rule deleted: ${ruleId}`);
  }

  /**
   * جلب جميع قواعد التنبيه للتاجر
   */
  async getRules(tenantId: string): Promise<NotificationRule[]> {
    return this.ruleRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * جلب قاعدة واحدة
   */
  async getRule(tenantId: string, ruleId: string): Promise<NotificationRule> {
    const rule = await this.ruleRepository.findOne({
      where: { id: ruleId, tenantId },
    });

    if (!rule) {
      throw new NotFoundException(`Notification rule not found: ${ruleId}`);
    }

    return rule;
  }

  /**
   * تبديل حالة التفعيل
   */
  async toggleRule(
    tenantId: string,
    ruleId: string,
    isActive: boolean,
  ): Promise<NotificationRule> {
    const rule = await this.getRule(tenantId, ruleId);
    rule.isActive = isActive;
    return this.ruleRepository.save(rule);
  }

  // ═══════════════════════════════════════════════════════════
  // معالجة الأحداث وإرسال التنبيهات
  // ═══════════════════════════════════════════════════════════

  /**
   * ✅ المعالج الرئيسي: عند وصول حدث من المتجر
   * يبحث عن القواعد المطابقة ويُنشئ تنبيهات لكل موظف
   */
  async processEvent(context: EventContext): Promise<number> {
    const { tenantId, eventType, data } = context;

    this.logger.debug(`Processing event for notifications: ${eventType}`, { tenantId });

    // ✅ GUARD: التحقق أن الحدث موجود في enum قبل إرسال الاستعلام للـ DB
    // بعض الأحداث مثل app.installed / app.uninstalled هي أحداث lifecycle
    // غير موجودة في notification_rules_triggerevent_enum
    // إرسالها للـ DB يُسبب: "invalid input value for enum"
    const validTriggerEvents = Object.values(NotificationTriggerEvent) as string[];
    if (!validTriggerEvents.includes(eventType)) {
      this.logger.debug(`Event '${eventType}' is not a notification trigger — skipping`, { tenantId });
      return 0;
    }

    // 1. جلب القواعد المُفعّلة المطابقة للحدث
    const matchingRules = await this.ruleRepository.find({
      where: {
        tenantId,
        triggerEvent: eventType as NotificationTriggerEvent,
        isActive: true,
      },
    });

    if (matchingRules.length === 0) {
      this.logger.debug(`No active rules for event: ${eventType}`);
      return 0;
    }

    this.logger.log(
      `Found ${matchingRules.length} matching rules for ${eventType}`,
    );

    // ✅ جلب اسم المتجر من الـ Store
    const storeName = await this.getStoreName(context.tenantId, context.storeId);

    let totalNotifications = 0;

    // 2. لكل قاعدة، فحص الشروط وإنشاء التنبيهات
    for (const rule of matchingRules) {
      try {
        // فحص الشروط الإضافية
        if (!this.evaluateConditions(rule.conditions, data)) {
          this.logger.debug(`Rule ${rule.id} conditions not met, skipping`);
          continue;
        }

        // جلب المستلمين
        const recipients = await this.resolveRecipients(rule, data);

        if (recipients.length === 0) {
          this.logger.warn(`No recipients found for rule: ${rule.id}`);
          continue;
        }

        // تحضير المتغيرات
        // ✅ إذا البيانات فاضية (من communication webhook) → جلب من DB
        let enrichedData = data;
        if (this.isOrderEvent(context.eventType) && !this.hasOrderData(data)) {
          const dbData = await this.enrichOrderFromDB(data, context);
          if (dbData) enrichedData = dbData;
        }
        const variables = this.extractVariables(enrichedData, context);
        // ✅ تعيين اسم المتجر من الـ DB (بدلاً من الاعتماد على بيانات الـ webhook)
        if (storeName) variables['{اسم_المتجر}'] = storeName;

        // إنشاء تنبيه لكل موظف ولكل قناة (مع فلترة التوافق)
        for (const employee of recipients) {
          for (const channel of rule.channels) {
            // ✅ فلترة: لا ترسل whatsapp بدون جوال، ولا email بدون بريد
            if (!this.canSendToChannel(employee, channel)) {
              this.logger.debug(
                `⏭️ Skipping ${channel} for "${employee.name}" — missing contact info`,
              );
              continue;
            }

            const notification = await this.createNotification(
              rule,
              employee,
              channel,
              variables,
              context,
            );

            // إضافة للـ Queue للإرسال الفعلي
            await this.notificationQueue.add(
              `send-${channel}`,
              {
                notificationId: notification.id,
                channel,
                employeeId: employee.id,
                employeeName: employee.name,
                employeeEmail: employee.email,
                employeePhone: employee.phone,
                title: notification.title,
                message: notification.message,
                actionUrl: notification.actionUrl,
                priority: rule.priority,
              },
              {
                priority: rule.priority,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: true,
              },
            );

            totalNotifications++;
          }
        }

        // تحديث إحصائيات القاعدة
        const notificationCount = recipients.length * rule.channels.length;
        await this.ruleRepository.increment(
          { id: rule.id },
          'sentCount',
          notificationCount,
        );
        await this.ruleRepository.update(rule.id, {
          lastTriggeredAt: new Date(),
        });

      } catch (error) {
        this.logger.error(`Error processing rule ${rule.id}`, {
          error: error instanceof Error ? error.message : 'Unknown',
          ruleId: rule.id,
          eventType,
        });
      }
    }

    this.logger.log(
      `✅ Created ${totalNotifications} notifications for event: ${eventType}`,
    );

    return totalNotifications;
  }

  // ═══════════════════════════════════════════════════════════
  // إشعارات الموظف (Dashboard)
  // ═══════════════════════════════════════════════════════════

  /**
   * جلب إشعارات موظف محدد
   */
  async getEmployeeNotifications(
    tenantId: string,
    employeeId: string,
    filter: NotificationFilterDto,
  ): Promise<{ notifications: EmployeeNotification[]; total: number }> {
    const qb = this.notificationRepository
      .createQueryBuilder('n')
      .where('n.tenantId = :tenantId', { tenantId })
      .andWhere('n.employeeId = :employeeId', { employeeId })
      .andWhere('n.channel = :channel', { channel: NotificationChannel.DASHBOARD });

    if (filter.isRead !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead: filter.isRead });
    }

    if (filter.triggerEvent) {
      qb.andWhere('n.triggerEvent = :triggerEvent', {
        triggerEvent: filter.triggerEvent,
      });
    }

    const total = await qb.getCount();

    const notifications = await qb
      .orderBy('n.createdAt', 'DESC')
      .skip(filter.offset || 0)
      .take(filter.limit || 20)
      .getMany();

    return { notifications, total };
  }

  /**
   * عدد الإشعارات غير المقروءة
   */
  async getUnreadCount(tenantId: string, employeeId: string): Promise<number> {
    return this.notificationRepository.count({
      where: {
        tenantId,
        employeeId,
        channel: NotificationChannel.DASHBOARD,
        isRead: false,
      },
    });
  }

  /**
   * تحديث حالة القراءة
   */
  async markAsRead(
    tenantId: string,
    employeeId: string,
    notificationIds: string[],
  ): Promise<void> {
    await this.notificationRepository.update(
      {
        id: In(notificationIds),
        tenantId,
        employeeId,
      },
      {
        isRead: true,
        readAt: new Date(),
        status: NotificationStatus.READ,
      },
    );
  }

  /**
   * تحديد كل الإشعارات كمقروءة
   */
  async markAllAsRead(tenantId: string, employeeId: string): Promise<void> {
    await this.notificationRepository.update(
      {
        tenantId,
        employeeId,
        channel: NotificationChannel.DASHBOARD,
        isRead: false,
      },
      {
        isRead: true,
        readAt: new Date(),
        status: NotificationStatus.READ,
      },
    );
  }

  // ═══════════════════════════════════════════════════════════
  // إحصائيات
  // ═══════════════════════════════════════════════════════════

  async getStats(tenantId: string): Promise<NotificationStatsResponseDto> {
    const rules = await this.ruleRepository.find({ where: { tenantId } });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalSent, sentToday, failedCount] = await Promise.all([
      this.notificationRepository.count({ where: { tenantId } }),
      this.notificationRepository
        .createQueryBuilder('n')
        .where('n.tenantId = :tenantId', { tenantId })
        .andWhere('n.createdAt >= :today', { today })
        .getCount(),
      this.notificationRepository.count({
        where: { tenantId, status: NotificationStatus.FAILED },
      }),
    ]);

    // تجميع حسب القناة
    const byChannelRaw = await this.notificationRepository
      .createQueryBuilder('n')
      .select('n.channel', 'channel')
      .addSelect('COUNT(*)', 'count')
      .where('n.tenantId = :tenantId', { tenantId })
      .groupBy('n.channel')
      .getRawMany();

    const byChannel: Record<string, number> = {};
    for (const row of byChannelRaw) {
      byChannel[row.channel] = parseInt(row.count, 10);
    }

    // تجميع حسب الحدث
    const byEventRaw = await this.notificationRepository
      .createQueryBuilder('n')
      .select('n.triggerEvent', 'event')
      .addSelect('COUNT(*)', 'count')
      .where('n.tenantId = :tenantId', { tenantId })
      .groupBy('n.triggerEvent')
      .getRawMany();

    const byEvent: Record<string, number> = {};
    for (const row of byEventRaw) {
      byEvent[row.event] = parseInt(row.count, 10);
    }

    return {
      totalRules: rules.length,
      activeRules: rules.filter((r) => r.isActive).length,
      totalSent,
      sentToday,
      byChannel,
      byEvent,
      failedCount,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // إرسال تجريبي
  // ═══════════════════════════════════════════════════════════

  /**
   * إرسال تنبيه تجريبي لاختبار القاعدة
   */
  async sendTestNotification(
    tenantId: string,
    ruleId: string,
    testEmployeeId?: string,
  ): Promise<EmployeeNotification> {
    const rule = await this.getRule(tenantId, ruleId);

    // بيانات تجريبية
    const testData: Record<string, unknown> = {
      id: '12345',
      order_id: 12345,
      status: { name: 'جديد' },
      total: { amount: 250, currency: 'SAR' },
      customer: { first_name: 'أحمد', last_name: 'محمد', mobile: '0501234567' },
    };

    // ✅ استخدام البيانات الحقيقية من القاعدة
    const testPhone = rule.customPhones?.[0] || '+966501234567';
    const testEmail = rule.customEmails?.[0] || 'test@example.com';

    const testEmployee: EmployeeInfo = {
      id: testEmployeeId || 'test-employee-id',
      name: 'اختبار تنبيه',
      email: testEmail,
      phone: testPhone,
      role: 'support',
    };

    const variables = this.extractVariables(testData, {
      tenantId,
      eventType: rule.triggerEvent,
      data: testData,
    });
    // ✅ جلب اسم المتجر
    const storeName = await this.getStoreName(tenantId);
    if (storeName) variables['{اسم_المتجر}'] = storeName;

    let lastNotification: EmployeeNotification | null = null;

    // ✅ إرسال لكل قناة مع فلترة التوافق
    for (const channel of rule.channels) {
      // ✅ فلترة: لا ترسل whatsapp بدون جوال، ولا email بدون بريد
      if (!this.canSendToChannel(testEmployee, channel)) {
        this.logger.debug(
          `⏭️ Skipping test ${channel} for "${testEmployee.name}" — missing contact info`,
        );
        continue;
      }

      const notification = await this.createNotification(
        rule,
        testEmployee,
        channel,
        variables,
        {
          tenantId,
          eventType: rule.triggerEvent,
          data: testData,
        },
      );

      // ✅ إضافة للـ Queue للإرسال الفعلي
      await this.notificationQueue.add(
        `send-${channel}`,
        {
          notificationId: notification.id,
          channel,
          employeeId: testEmployee.id,
          employeeName: testEmployee.name,
          employeeEmail: testEmployee.email,
          employeePhone: testEmployee.phone,
          title: notification.title,
          message: notification.message,
          actionUrl: notification.actionUrl,
          priority: rule.priority,
          tenantId,
        },
        {
          priority: 1,
          attempts: 1, // اختبار = محاولة واحدة فقط
          removeOnComplete: true,
        },
      );

      lastNotification = notification;
      this.logger.log(`📧 Test notification queued: ${notification.id} → ${channel}`);
    }

    if (!lastNotification) {
      throw new NotFoundException(
        'لا يمكن إرسال التنبيه: المستلم لا يملك بيانات اتصال مناسبة للقنوات المحددة',
      );
    }

    return lastNotification;
  }

  // ═══════════════════════════════════════════════════════════
  // تحديث حالة الإرسال (يُستدعى من الـ Queue processor)
  // ═══════════════════════════════════════════════════════════

  async updateNotificationStatus(
    notificationId: string,
    status: NotificationStatus,
    errorMessage?: string,
  ): Promise<void> {
    const update: { status: NotificationStatus; errorMessage?: string } = { status };

    if (errorMessage) {
      update.errorMessage = errorMessage;
    }

    await this.notificationRepository.update(notificationId, update);

    // زيادة عدد المحاولات بشكل آمن
    await this.notificationRepository.increment(
      { id: notificationId },
      'attempts',
      1,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════

  /**
   * إنشاء سجل تنبيه في قاعدة البيانات
   */
  private async createNotification(
    rule: NotificationRule,
    employee: EmployeeInfo,
    channel: NotificationChannel,
    variables: TemplateVariables,
    context: EventContext,
  ): Promise<EmployeeNotification> {
    // استبدال المتغيرات في القالب حسب القناة
    const { title, message } = this.renderTemplate(rule, channel, {
      ...variables,
      '{اسم_الموظف}': employee.name,
      '{بريد_الموظف}': employee.email || '',
    });

    const actionUrl = this.buildActionUrl(context);

    const notification = this.notificationRepository.create({
      tenantId: context.tenantId,
      ruleId: rule.id,
      employeeId: employee.id,
      employeeName: employee.name,
      channel,
      triggerEvent: context.eventType,
      title,
      message,
      status: channel === NotificationChannel.DASHBOARD
        ? NotificationStatus.DELIVERED
        : NotificationStatus.PENDING,
      eventData: context.data,
      actionUrl,
      priority: rule.priority,
      webhookEventId: context.webhookEventId || null,
    });

    return this.notificationRepository.save(notification);
  }

  /**
   * استبدال المتغيرات في القالب + إضافة الفقرة التحفيزية
   */
  private renderTemplate(
    rule: NotificationRule,
    channel: NotificationChannel,
    variables: TemplateVariables,
  ): { title: string; message: string } {
    let title = '';
    let message = '';

    switch (channel) {
      case NotificationChannel.DASHBOARD:
        title = rule.dashboardTitle || this.getDefaultTitle(rule.triggerEvent);
        message = rule.dashboardTemplate || this.getDefaultTemplate(rule.triggerEvent);
        break;

      case NotificationChannel.EMAIL:
        title = rule.emailSubject || this.getDefaultTitle(rule.triggerEvent);
        message = rule.emailTemplate || this.getDefaultTemplate(rule.triggerEvent);
        break;

      case NotificationChannel.WHATSAPP:
        title = this.getDefaultTitle(rule.triggerEvent);
        message = rule.whatsappTemplate || this.getDefaultTemplate(rule.triggerEvent);
        break;
    }

    // استبدال كل المتغيرات
    for (const [key, value] of Object.entries(variables)) {
      const safeValue = value != null ? String(value) : '';
      title = title.replace(new RegExp(this.escapeRegex(key), 'g'), safeValue);
      message = message.replace(new RegExp(this.escapeRegex(key), 'g'), safeValue);
    }

    // ✅ تنظيف: إخفاء الأسطر اللي قيمتها فاضية أو افتراضية بعد الاستبدال
    const lines = message.split('\n').filter(line => {
      const trimmed = line.trim();
      // إخفاء أسطر فيها label بدون قيمة: "*حالة الطلب:*" أو "*حالة الطلب:* "
      if (trimmed.match(/^\*[^*]+:\*\s*$/)) return false;
      // إخفاء أسطر فيها "0 ر.س" أو "0" كقيمة وحيدة (مبلغ صفر)
      if (trimmed.match(/^\*[^*]+:\*\s*0(\s*ر\.س)?$/)) return false;
      // إخفاء أسطر فيها فقط "غير محدد" أو "غير متوفر"
      if (trimmed.match(/^\*[^*]+:\*\s*(غير محدد|غير متوفر)$/)) return false;
      // إخفاء سطر الشحن الافتراضي
      if (trimmed.match(/^\*[^*]+:\*\s*غير محدد،\s*لا يوجد تتبع$/)) return false;
      // إخفاء "لا توجد منتجات"
      if (trimmed === 'لا توجد منتجات') return false;
      return true;
    });
    // إخفاء عنوان قسم بدون محتوى بعده (مثل "🛒 *المنتجات:*" لو ما فيه منتجات)
    message = lines.filter((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.includes('المنتجات') && trimmed.includes('*') && !trimmed.includes('.')) {
        // section header — check if next non-empty line exists
        const nextNonEmpty = lines.slice(idx + 1).find(l => l.trim().length > 0);
        if (!nextNonEmpty || nextNonEmpty.trim().startsWith('فريق رفيق')) return false;
      }
      return true;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();

    // ✅ الترتيب: الرسالة → فريق رفيق يقولك + عبارة تناسب الحدث
    const motivational = this.getMotivationalText(rule.motivationalMessage, rule.triggerEvent);
    message = `${message}\n\nفريق رفيق يقولك:\n${motivational}`;

    return { title, message };
  }

  /**
   * ✅ عبارات تحفيزية مخصصة لكل حدث — 50+ عبارة لكل فئة
   * كل حدث يحصل على عبارات تناسب سياقه
   */
  private getMotivationalText(
    customMessage: string | null | undefined,
    triggerEvent?: string,
  ): string {
    if (customMessage && customMessage.trim()) {
      return customMessage.trim();
    }

    const eventMessages = this.getEventMessages(triggerEvent);
    return eventMessages[Math.floor(Math.random() * eventMessages.length)];
  }

  /**
   * ✅ عبارات مخصصة حسب نوع الحدث
   */
  private getEventMessages(triggerEvent?: string): string[] {
    // تصنيف الحدث
    const category = this.getEventCategory(triggerEvent);

    const messages: Record<string, string[]> = {

      // ═══════════════════════════════════════════════════════════
      // 🛒 طلب جديد / تحديث طلب / تحديث دفع
      // ═══════════════════════════════════════════════════════════
      order_new: [
        'مبروك الطلب الجديد! 🎉 اللهم بارك وزد',
        'ما شاء الله! طلب جديد = رزق جديد، الحمد لله 🤍',
        'اللهم بارك لك في تجارتك وارزقه أضعافاً 💫',
        'كل طلب هو ثمرة تعبك وجهدك، تستاهل! 💪',
        'نسأل الله يوصلك مليون طلب بإذن الله 🚀',
        'اللهم اجعل هذا الطلب فاتحة خير وبركة عليك 🌟',
        'ربي يبارك لك ويرزقك من حيث لا تحتسب ❤️',
        'طلب جديد = عميل يثق فيك، حافظ على ثقته 🤝',
        'الحمد لله على نعمة الرزق، اللهم زد وبارك 🤲',
        'ما شاء الله تبارك الله! تجارتك فيها بركة 🕋',
        'كل طلب يقربك من حلمك الكبير، واصل! 🎯',
        'اليوم طلب، وبكرا ألف طلب بإذن الله! 📈',
        'تجارتك ما شاء الله ماشية صح، واصل! 💎',
        'اللهم وسّع رزقك وبارك في كل طلب يأتيك ✨',
        'نفتخر فيك! كل طلب شهادة على جودة عملك 🏆',
        'ربي يفتح عليك أبواب الرزق من كل مكان 🚪',
        'الله يبارك لك.. عميل سعيد = تجارة ناجحة 😊',
        'نسأل الله أن يجعل كل يوم أفضل من اللي قبله 🌙',
        'حلمك الكبير يتحقق طلب بعد طلب، لا توقف! 🌍',
        'اللهم ارزقه رزقاً لا ينقطع وبركة لا تنتهي 💚',
        'كل طلب دليل على إن شغلك يوصل، أبدعت! 🎨',
        'ربنا يتمم عليك بالخير ويزيدك نجاح 🌺',
        'تفاءل بالخير.. هذا الطلب بداية يوم مبارك ☀️',
        'اللهم اجعل عملك خالصاً لوجهك واكتب لك التوفيق 🤲',
        'اللهم بارك في رزقه وارزقه حلالاً طيباً 🌿',
        'العميل اختارك من بين الكثير.. هذا يعني شي! ⭐',
        'نسأل الله يحقق لك كل أحلامك التجارية 🌠',
        'شغلك مميز، والعملاء يثقون فيك، واصل! 👑',
        'الله يعطيك العافية ويبارك في جهودك 💪',
        'أنت تصنع قصة نجاح يومياً، ما شاء الله 📖',
        'اللهم اجعل كل ريال يكسبه حلال فيه بركة 💰',
        'يوم مبارك وطلبات مباركة بإذن الله ☀️',
        'كل طلب لبنة في بناء إمبراطوريتك التجارية 🏰',
        'الخير جاي والرزق واسع، ثق بالله وتوكل عليه 🤲',
        'اللهم اجعل في كل طلب بركة وخير وربح 🌾',
        'أبشر بالخير! تجارتك ما شاء الله فيها نور 💡',
        'النجاح مو صدفة، هو نتيجة شغلك واهتمامك 🔧',
        'ربي يجعل كل يوم عندك أجمل من اللي قبله 🌸',
        'نسأل الله لك دوام التوفيق والنجاح والبركة 🌈',
        'عملك اليوم استثمار في غدك، وأنت على الطريق الصحيح 🛤️',
        'اللهم لا حسد، تجارتك فيها خير كثير! 🧿💚',
        'شكراً لأنك تثق فينا، نعدك بالأفضل دائماً 🤝',
        'اليوم بداية رحلة جميلة من النجاح والإنجاز ✈️',
        'ربي يوصلك للقمة وتبقى فيها يا بطل 🏔️',
        'سعداء بخدمتك ونتمنى لك مبيعات خيالية 🎉',
        'بسم الله ما شاء الله، رزقك واسع الحمد لله 🕋',
        'الأحلام الكبيرة تبدأ بطلب واحد، وها أنت بدأت! 🎬',
        'من هنا بدأ كبار التجار، واصل وشف النتيجة! 📊',
        'اللهم زده من فضلك ولا تحرمه من رزقك 🤲',
        'تخيل شكل متجرك بعد سنة، الطريق يبشر بالخير! 💭',
      ],

      // ═══════════════════════════════════════════════════════════
      // ❌ إلغاء طلب / استرجاع
      // ═══════════════════════════════════════════════════════════
      order_cancelled: [
        'لا تحزن، الرزق بيد الله وأبواب الخير كثيرة 🤍',
        'كل إلغاء فيه حكمة، ربي يعوضك بأفضل منه 🌟',
        'الصبر مفتاح الفرج، واللي راح الله يعوضك أحسن 🔑',
        'لا تخلي إلغاء واحد يؤثر على حماسك، واصل! 💪',
        'تذكر: حتى أنجح المتاجر تمر بإلغاءات، هذا طبيعي 📊',
        '"ما أصابك لم يكن ليخطئك" — ربي يعوضك خير ❤️',
        'خذها تجربة: هل يمكن تحسين شي؟ كل تجربة درس 📝',
        'الإلغاء مو نهاية العالم، الطلب الجاي أفضل بإذن الله 🚀',
        'نسأل الله يرزقك بدله عشر طلبات أفضل 🤲',
        'لا تنسى: 90% من طلباتك ناجحة، ركز على الإيجابي 😊',
        'ربما العميل يرجع لاحقاً، خلّ تعاملك يبقى مميز 🌺',
        'الإلغاء جزء من التجارة، المهم تتعلم منه 🧠',
        'اللهم عوضه خيراً مما فقد وارزقه فوق ما يتمنى 💫',
        'كل باب يُغلق، الله يفتح لك أبواب أوسع 🚪',
        'نصيحة: تواصل مع العميل بلطف، ربما يرجع 📱',
        'الرزق مكتوب ومقسوم، وربك كريم 🤍',
        'خلّك إيجابي! هذا الإلغاء ممكن يكون لحكمة 🌿',
        'لعل الله يدخر لك طلبات أكبر وأفضل قريباً ⭐',
        'تذكر: العبرة مو بعدد الطلبات بس، بل بالبركة فيها 🕋',
        'لا تضيع وقتك في الحزن، ركّز على الطلب الجاي! 🎯',
        'من كل تجربة نتعلم شي جديد، وأنت تتطور دائماً 📈',
        'ربي يصبرك ويعوضك بعملاء أوفياء وطلبات مباركة 🤲',
        'فكرة: اسأل العميل عن سبب الإلغاء بكل احترام 💬',
        'اللهم اجعل ما فاته خيراً، وما هو آتٍ أعظم 🌙',
        'نصيحة ذهبية: سياسة إرجاع مرنة تزيد ثقة العملاء 🏅',
        'الحياة فيها صعود ونزول، المهم إنك ما توقف أبداً 🏃',
        'ربي يبدلك خير، الرزق ما ينقص بإلغاء طلب 💚',
        'تذكر: أمازون تتعامل مع ملايين الإلغاءات يومياً 🌍',
        'هذا الإلغاء فرصة لمراجعة وتحسين تجربة العميل 🔍',
        'خلك واثق من نفسك ومن رزقك، اللي لك بيجيك 🤍',
        'اللهم ارزقه الصبر والعوض الجميل 🌸',
        'نصيحة: أحياناً المشكلة بالتوقعات، وضّح منتجاتك أكثر 📸',
        'لا تأخذها بشكل شخصي — التجارة فيها كسب وفيها دروس 📚',
        'يقولون: الخسارة أم الربح، لأنها تعلمنا نكسب أفضل 💡',
        'ربي يحفظ تجارتك ويبعد عنها كل مكروه 🛡️',
        'تفاءل! كل يوم فيه طلبات جديدة وفرص جديدة 🌅',
        'نسأل الله يجعل كل إلغاء درس يقربك من النجاح 🎓',
        'لا تقارن يومك السيئ بأحسن أيام غيرك، كل واحد له ظروفه 🌿',
        'اللهم اجبر خاطره واكتب له الخير من حيث لا يحتسب 🤲',
        'تعامل مع الإلغاء باحترافية = عميل يمكن يرجع مستقبلاً 🔄',
        'ابتسم 😊 هذا يوم واحد من أيام كثيرة جميلة قادمة',
        'الله لا يضيع تعب أحد، واجرك على جهدك محفوظ ❤️',
        'خذ نفس عميق، وارجع للعمل بهمة جديدة 🧘',
        'اللهم اجعل الخير في ما اخترت لنا 🤍',
        'نصيحة: وثّق أسباب الإلغاء، بتفيدك في التطوير 📋',
        'الإلغاء زي المطر.. يمر، والشمس ترجع أجمل ☀️',
        'ربي يعوضك بعملاء مخلصين يحبون منتجاتك 💜',
        'تذكر: كل تاجر ناجح مر بلحظات صعبة، وعداها 🦅',
        'لو ما في إلغاءات، ما كان في تطوير وتحسين! 🔧',
        'نسأل الله يفرج همك ويبدلك بالخير من كل باب 🌈',
      ],

      // ═══════════════════════════════════════════════════════════
      // 📋 إسناد طلب لموظف
      // ═══════════════════════════════════════════════════════════
      order_assigned: [
        'ثقتنا فيك كبيرة! الله يوفقك في خدمة هالعميل 🤝',
        'أنت الشخص المناسب لهذا الطلب، وفقك الله 💪',
        'العميل بين أيادٍ أمينة، نثق فيك 🌟',
        'خدمة العميل عبادة، الله يجزيك خير ❤️',
        'اهتمامك بالتفاصيل يصنع الفرق، واصل! 🔍',
        'تذكر: العميل الراضي أفضل تسويق مجاني 📣',
        'أنت قدها وقدود! الله يعطيك العافية 🏆',
        'خذ وقتك مع العميل وقدم أفضل تجربة ممكنة ⭐',
        'أمانة الطلب بين يديك، ونحن واثقين فيك 🤍',
        'اللهم وفقه في خدمة العميل وارزقه رضاه 🤲',
        'التميز في التفاصيل، وأنت شخص مميز 💎',
        'سرعة الرد + الاهتمام = عميل سعيد = كلنا سعداء 😊',
        'إحنا فريق واحد، وكل طلب ننجزه سوا 🤝',
        'نصيحة: ابدأ بالتحية الطيبة والابتسامة الرقمية 👋',
        'تعاملك مع العميل يعكس صورة المتجر بالكامل 🪞',
        'اللهم اجعله سبب لرزق ورضا العميل 💫',
        'أفضل شعور لما العميل يشكرك على خدمتك 🥰',
        'كل طلب تنجزه باحترافية = سمعة أفضل للمتجر 📈',
        'الله يعينك ويوفقك، أنت ركيزة من ركائز فريقنا 🏗️',
        'تابع الطلب أول بأول، العميل يحب المتابعة 📦',
        'أنت سفير المتجر في هالطلب، افتخر بنفسك! 🎖️',
        'التواصل الجيد مع العميل نصف الطريق للنجاح 📱',
        'كل تجربة إيجابية تبني علاقة طويلة مع العميل 🌱',
        'الأمانة في العمل من أعظم القيم، جزاك الله خيراً 🕋',
        'نفتخر بوجودك في الفريق، شغلك يفرق! 🌟',
        'خلّ العميل يحس إنه مميز، لأنه فعلاً كذلك 👑',
        'الصبر مع العميل ثمرته حلوة دائماً 🍎',
        'تذكر: كل عميل هو فرصة لبناء سمعة ممتازة 🏅',
        'اللهم يسّر أمره ووفقه في إتمام الطلب 🤲',
        'أنت تمثلنا بأفضل شكل، واثقين فيك تماماً 💜',
        'الله يعطيك العافية على كل جهد تبذله 💪',
        'خدمة الناس من أفضل الأعمال عند الله 🌿',
        'نصيحة: وثّق كل شي في الطلب للتسهيل مستقبلاً 📝',
        'الفريق الناجح يبدأ بأشخاص مثلك، شكراً لك 🙏',
        'كل عميل سعيد يكتب قصة نجاح جديدة للمتجر ✍️',
        'تعاملك الراقي هو أفضل إعلان مجاني 🎬',
        'اللهم بارك في وقته وجهده واجعله في ميزان حسناته 🤍',
        'خلّ شعارك دائماً: العميل أولاً 🥇',
        'نصيحة: لو واجهت مشكلة، لا تتردد تطلب مساعدة الفريق 🆘',
        'أنت لست مجرد موظف، أنت شريك نجاح حقيقي! 🤝',
        'كل طلب تنجزه يزيد خبرتك ويقويك 📚',
        'ربي يسعدك في عملك ويجعله خفيف على قلبك 💚',
        'نقدر تفانيك وإخلاصك، أنت كنز حقيقي للفريق 💎',
        'اهتم بالعميل كأنه ضيف عزيز، وشوف النتيجة 🫖',
        'نسأل الله يرزقك السعادة في عملك والتوفيق في حياتك 🌈',
        'تذكر: أنت تبني علاقات مو بس تنجز طلبات 🌱',
        'الله يجزيك خير على كل ابتسامة ترسمها على وجه عميل 😊',
        'فريقنا قوي بوجودك، واصل يا بطل! 🦁',
        'نصيحة: الرد السريع يخلي العميل يحس بالاهتمام ⚡',
        'كل عميل راضي هو قصة نجاح تنضاف لسجلك ⭐',
      ],

      // ═══════════════════════════════════════════════════════════
      // 👤 عميل جديد
      // ═══════════════════════════════════════════════════════════
      customer_new: [
        'مبروك عميل جديد! 🎉 ربي يكثر عملاءك',
        'كل عميل جديد فرصة لبناء علاقة طويلة الأمد 🌱',
        'اللهم اجعله عميل وفي يرجع مرة ثانية وثالثة 🤲',
        'عميل جديد = ثقة جديدة فيك، حافظ عليها! 🤝',
        'نسأل الله يبارك لك ويزيد عملاءك أضعاف 💫',
        'الانطباع الأول مهم جداً، خلّه يحب متجرك من أول تجربة 🌟',
        'ربي يجعل كل عميل يدخل متجرك يطلع سعيد 😊',
        'عملاء جدد = نمو حقيقي لمتجرك، ما شاء الله 📈',
        'نصيحة: رسالة ترحيب بسيطة تصنع فرق كبير 💌',
        'اللهم اجعل عملاءه كالنجوم في السماء، كثير وثابتين ⭐',
        'تجربة العميل الأولى هي اللي تحدد كل شي! 🎯',
        'سعداء بنمو قاعدة عملائك، واصل على هالمستوى 🏆',
        'عميل جديد = باب رزق جديد، الحمد لله 🚪',
        'اللهم اجعل كل عميل يحب متجرك ومنتجاتك 💜',
        'كل عميل قصة نجاح قادمة، اكتبها صح! 📖',
        'نصيحة: تابع العميل الجديد وتأكد إنه يعرف منتجاتك 📱',
        'ما شاء الله! عملاءك يزيدون، علامة نجاح حقيقية 🌟',
        'اللهم بارك لك في عملائك وارزقك رضاهم ❤️',
        'فكرة: خصم ترحيبي للعميل الجديد يخليه يرجع 🎁',
        'العملاء الجدد بوابة التوسع والنمو، ما شاء الله 🌍',
        'كل عميل جديد يعني كلامك عن متجرك وصل! 📣',
        'اللهم اجعل كل عميل سبب خير وبركة 🤍',
        'ثقة العميل الجديد تبدأ من أول تواصل معه 💬',
        'ربي يحفظ لك عملاءك ويزيدهم يوم بعد يوم 🌺',
        'تذكر: العميل الجديد ممكن يكون أفضل عملائك مستقبلاً 💎',
        'نسأل الله أن يجعل متجرك مقصد كل باحث عن الجودة 🏪',
        'الاهتمام بالعميل الجديد استثمار بيرجع أضعاف 🔄',
        'عميل واحد راضي يجيب لك عشرة عملاء جدد 🌊',
        'اللهم وسّع دائرة عملائه وبارك في تجارته 🤲',
        'أبشر! كل عميل جديد يعني سمعتك توصل أبعد 📡',
        'فكرة: أرسل رسالة شكر شخصية لكل عميل جديد 🙏',
        'ربي يجعل كل عميل يدخل ويطلب ويرجع راضي 😊',
        'نمو العملاء أفضل مؤشر على نجاح تجارتك 📊',
        'اللهم اجعل في كل عميل بركة ورزق 🌾',
        'كل عميل جديد فصل جديد في كتاب نجاحك 📕',
        'متجرك يكبر يوم بعد يوم، ما شاء الله تبارك الله! 🏰',
        'نصيحة ذهبية: اسم العميل + اهتمام = ولاء مدى الحياة 👑',
        'ربي يبارك في تجارتك ويجعل عملاءك خير أمة 🕋',
        'مبروك! شبكة عملائك تتوسع، وهذا أفضل استثمار 🕸️',
        'اللهم اجعل كل تعامل مع عميل في ميزان حسناتك 🤍',
        'نصيحة: أول 24 ساعة بعد التسجيل هي الأهم، استغلها! ⚡',
        'كل عميل جديد بذرة نجاح، ارويها بالاهتمام 🌱',
        'ما شاء الله! الناس تثق في متجرك، وهذا أكبر إنجاز 🏅',
        'اللهم ارزقه عملاء مخلصين يحبون منتجاته ❤️',
        'قاعدة عملائك تنمو = تجارتك تكبر = حلمك يتحقق! 🎬',
        'ربي يزيدك من فضله ويكثّر خيرك وعملاءك 💚',
        'فكرة: اعرف احتياجات عميلك الجديد واقترح له المناسب 🧠',
        'كل عميل يختارك هو تصويت ثقة فيك 🗳️',
        'اللهم اجعل عملاءه كالغيث، كلما نزل بارك فيه 🌧️',
        'أبشر بالخير! عملاء جدد = مستقبل أجمل لمتجرك 🌈',
      ],

      // ═══════════════════════════════════════════════════════════
      // 💬 رسالة من عميل
      // ═══════════════════════════════════════════════════════════
      customer_message: [
        'رسالة العميل أمانة، رد عليه بسرعة واهتمام 📩',
        'نصيحة: أسرع رد = أسعد عميل ⚡',
        'كل رسالة فرصة لكسب ولاء العميل، استغلها! 💬',
        'العميل اللي يتواصل معك = عميل مهتم، لا تخسره 🌟',
        'اللهم يسّر أمورك في الرد وإرضاء العميل 🤲',
        'تذكر: لغة ودية + حل سريع = عميل مدى الحياة 😊',
        'الرد الجميل يحول الاستفسار إلى طلب شراء! 🛒',
        'نصيحة: اقرأ رسالة العميل بعناية قبل الرد 👀',
        'العميل يحتاج يحس إنه مهم، خلّه يحس كذا 👑',
        'سرعة الرد تعكس احترافية متجرك 🏃‍♂️',
        'اللهم ألهمك الرد المناسب اللي يرضي العميل 💫',
        'فكرة: جهّز ردود جاهزة للأسئلة المتكررة، يوفر وقتك 📋',
        'كل رسالة استثمار في علاقتك مع العميل 🌱',
        'الاستماع الجيد للعميل نصف الحل! 👂',
        'ربي يعطيك الصبر والحكمة في التعامل مع العملاء 🤍',
        'تذكر: العميل اللي يشتكي أفضل من اللي يمشي بدون كلام 📢',
        'نصيحة: ابدأ ردك بشكر العميل على تواصله 🙏',
        'لغة إيجابية + حلول عملية = تجربة عميل ممتازة ✨',
        'كل رسالة ترد عليها بإتقان = تقييم إيجابي قادم ⭐',
        'اللهم اجعل كلماتك سبب سعادة للعميل ❤️',
        'العميل اللي يسأل = عميل مهتم بالشراء، ساعده! 🤝',
        'نصيحة: لو ما تعرف الجواب، وعده بالرد وارجع له 📞',
        'رد العميل بسرعة دايماً أفضل من رد مثالي متأخر ⏰',
        'اللهم افتح عليك في الرد بما يرضي العميل 🔓',
        'كل تواصل ناجح يبني جسر ثقة لا ينكسر 🌉',
        'فكرة: أضف لمسة شخصية في ردك، العميل يقدرها 🎨',
        'ابتسامتك تنعكس حتى في رسائلك النصية، خلك مبتسم 😊',
        'اللهم ارزقه حسن التعامل ولين الكلام مع عملائه 🤲',
        'العميل يقدّر الصدق أكثر من الوعود الكبيرة 💯',
        'نصيحة: تابع مع العميل بعد حل مشكلته، هذا يفرق 📱',
        'كل رسالة ترد عليها بإحسان، الله يرزقك بسببها 🌿',
        'ربي يبارك في وقتك ويعينك على خدمة عملائك 💪',
        'تعامل مع كل رسالة وكأنها من أهم عميل عندك 🏅',
        'فكرة: سجّل الأسئلة المتكررة وحضّر إجابات نموذجية 📝',
        'العميل الصبور نعمة، والعميل الغاضب فرصة للتميز! 💎',
        'اللهم اجعل كل كلمة تكتبها سبب رضا وخير 🤍',
        'نصيحة: الرموز التعبيرية تضيف دفء لرسائلك 😊💬',
        'كل رسالة عميل هي فرصة لتعلّم شي جديد عن سوقك 🧠',
        'ربي يرزقك بالرد الذي يفتح قلب العميل 💚',
        'تعامل مع العميل باحترام حتى لو كان غاضباً، هذا يفرق 🌺',
        'اللهم اجعل عملائك يحبونك لحسن خلقك في التعامل 🤍',
        'نصيحة: لا تحذف رسالة العميل أبداً، كلها سجلات مهمة 📚',
        'تواصل العميل معك يعني إنه يهتم بمتجرك، قدّر هذا 💜',
        'كل مشكلة تحلها = قصة نجاح جديدة 🏆',
        'اللهم يسّر أمورك في كل رسالة ترد عليها 🤲',
        'فكرة: ختم رسالتك بسؤال يخلي العميل يكمل التواصل 🔄',
        'سعادة العميل تبدأ من طريقة ردك عليه، اهتم فيها ✨',
        'ربي يعينك على خدمة عملائك بأفضل شكل ممكن 💪',
        'لا تتأخر في الرد، كل دقيقة تمر = فرصة ممكن تروح ⏳',
        'اللهم بارك في تعاملاتك واجعلها خير وبركة 🌈',
      ],

      // ═══════════════════════════════════════════════════════════
      // ⭐ تقييم إيجابي
      // ═══════════════════════════════════════════════════════════
      review_positive: [
        'مبروك التقييم الحلو! 🎉 شغلك يتكلم عنك',
        'ما شاء الله! عميل سعيد = أفضل إعلان مجاني ⭐',
        'تقييم ممتاز! هذا نتيجة اهتمامك بالتفاصيل 💎',
        'اللهم زده من رضا عملائه وبارك في عمله 🤲',
        'كلام العميل الحلو أفضل مكافأة على تعبك 🏆',
        'هذا التقييم دليل على جودة عملك، واصل! 💪',
        'ما في شعور أحلى من تقييم إيجابي، تستاهل! 🥰',
        'نصيحة: شارك التقييم على حساباتك، هذا تسويق قوي 📱',
        'ربي يديم عليك رضا عملائك ويزيدك نجاح 🌟',
        'كل تقييم إيجابي يرفع ترتيب متجرك، أبشر! 📈',
        'شكراً لأنك تقدم خدمة تستحق هالتقييم الجميل 🤝',
        'اللهم اجعل كل عميل يقيمك بأفضل تقييم ⭐⭐⭐⭐⭐',
        'تقييم العميل عنوان على إن اتجاهك صحيح 🧭',
        'ما شاء الله! التقييمات الإيجابية تتوالى، واصل 🚀',
        'كل تقييم 5 نجوم يجيب لك عملاء جدد تلقائياً 🌊',
        'ربي يبارك في شغلك اللي يسعد الناس 🤍',
        'أنت مثال للتاجر اللي يهتم بعملائه، فخورين فيك 👑',
        'نصيحة: اشكر العميل على تقييمه، يحب الاهتمام 🙏',
        'الجودة تتكلم عنك، وهالتقييم أكبر دليل 🔊',
        'ما شاء الله تبارك الله! سمعتك تلمع ✨',
        'اللهم اجعل كل تعامل تقييم إيجابي جديد 💫',
        'التقييمات الحلوة وقود نجاحك، واصل بنفس المستوى 🔥',
        'كل كلمة حلوة من عميل = طاقة إيجابية تدفعك للأمام ⚡',
        'تستاهل كل كلمة حلوة، لأن شغلك فعلاً مميز 💜',
        'ربي يجعل كل يوم فيه تقييم إيجابي جديد 🌈',
        'نصيحة: اجمع التقييمات في صفحة خاصة بموقعك 📋',
        'هذا التقييم يثبت إن منتجاتك فعلاً ممتازة 🏅',
        'ما شاء الله! عملاءك يحبونك وهذا أغلى شي 💚',
        'اللهم لا حسد! متجرك من أفضل المتاجر 🧿',
        'فكرة: اطلب من العميل السعيد إنه يشارك تجربته 📣',
        'كل تقييم إيجابي دعاية لمتجرك ما تنتهي 🎬',
        'نصيحة: خلّ التقييمات تظهر بارزة في صفحة المنتج 🔝',
        'الثقة تُبنى تقييم بعد تقييم، وأنت تبنيها صح! 🏗️',
        'ربي يحفظ لك هالمستوى ويزيدك من فضله 🤲',
        'اللهم اجعل كل عميل مسوّق لمتجرك بدون ما يعرف 😊',
        'تقييم اليوم = ثقة الغد = نجاح المستقبل ⭐',
        'ما شاء الله! أنت تبني سمعة ذهبية، واصل 🥇',
        'كل تقييم إيجابي يفرح قلبنا لأنه يعكس تعبك الحقيقي 🤍',
        'العميل الراضي كنز، وتقييمه شهادة خالدة لمتجرك 💎',
        'نسأل الله يديم عليك النجاح ورضا العملاء دائماً 🌟',
        'فكرة: كافئ العميل اللي يقيمك بخصم على طلبه القادم 🎁',
        'تقييمات مثل هذي تخلي الواحد يشتغل بشغف أكبر! 🔥',
        'ربي يجعل متجرك مرجع للجودة والإتقان 🏪',
        'اللهم اجعل عملاءك أصدقاء ومحبين لمتجرك 💜',
        'التقييم الإيجابي مو صدفة، هو نتيجة جهد مستمر 💪',
        'ما شاء الله! استمر على هالمستوى، العالم يحتاجك 🌍',
        'كلمة "شكراً" من عميل تساوي الدنيا كلها! 🌺',
        'ربي يبارك في كل يد عملت وكل عميل رضي 🤲',
        'أنت لا تبيع منتجات فقط، أنت تبيع تجربة جميلة! ✨',
        'اللهم اجعل كل تقييم بوابة رزق جديدة لمتجرك 🚪',
      ],

      // ═══════════════════════════════════════════════════════════
      // ⚠️ تقييم سلبي
      // ═══════════════════════════════════════════════════════════
      review_negative: [
        'لا تزعل، التقييم السلبي فرصة للتطوير مو نهاية العالم 🌟',
        'كل تاجر كبير مر بتقييمات سلبية وعداها أقوى 🦅',
        'نصيحة ذهبية: رد على التقييم بهدوء واحترافية، الناس تشوف 👀',
        'التقييم السلبي = عميل يقولك وش تحسّن، وهذا كنز! 💎',
        'اللهم ألهمك الصبر وارزقك الحكمة في التعامل 🤲',
        'تذكر: أمازون وأبل عندهم تقييمات سلبية، وما أثرت عليهم 🌍',
        'العبرة مو بالتقييم، العبرة بردك عليه وتحسينك بعده 🔧',
        'خذ نقد العميل كاستشارة مجانية لتطوير متجرك 🧠',
        'الله يعوضك خير، وكل تقييم سلبي فيه درس مفيد 📚',
        'نصيحة: تواصل مع العميل بشكل خاص وحل المشكلة 📱',
        'ردك المحترف على تقييم سلبي يكسبك عملاء أكثر 📈',
        'لا تأخذها بشكل شخصي، ركز على الحل مو المشكلة 🎯',
        'كل نقد بنّاء يقربك خطوة من الكمال، استفد منه 🎓',
        'اللهم اجعل هذا التقييم سبب لتحسين خدماتك 🌿',
        'تذكر: 10 تقييمات إيجابية > تقييم سلبي واحد، ركّز على الإيجابي 😊',
        'ربي يعينك على تحويل هالتجربة لنقطة تحول إيجابية 🔄',
        'العميل الغاضب لو تعاملت معه صح، يصير أوفى عملائك! 🤝',
        'نصيحة: لا تحذف التقييم السلبي، حله علنياً يكسبك احترام 💪',
        'كل مشكلة فيها فرصة مخفية، بس لازم تشوفها 🔍',
        'اللهم اجعل كل نقد دافع للتحسن وسبب للتطور 💫',
        'الاحترافية تُقاس بطريقة تعاملك مع المواقف الصعبة 🏅',
        'خذ دقيقة قبل ما ترد، الرد الهادي أقوى بكثير 🧘',
        'نصيحة: اعرض حل عملي + اعتذار صادق = نتيجة مذهلة ✨',
        'تذكر: العميل ما يقيم "أنت"، هو يقيم "تجربة" يمكن تحسينها 🎨',
        'الصبر عند الصدمة الأولى، والأجر عند الله كبير 🤍',
        'فكرة: استخدم التقييم لتحسين وصف المنتج وتوقعات العميل 📝',
        'كل متجر عظيم بُني على دروس التقييمات، وأنت كذلك 🏰',
        'ربي يصبرك ويعوضك بتقييمات ممتازة تغطي على هذا 🌈',
        'نصيحة: شارك فريقك بالتقييم ليستفيد الجميع منه 👥',
        'التاجر الذكي يشكر العميل اللي ينتقده، لأنه يساعده يتطور 🙏',
        'اللهم حوّل هذا النقد لنقطة قوة في متجرك 🔧',
        'كثير من التقييمات السلبية سببها سوء فهم، وضّح الأمور 💡',
        'نصيحة: أضف سياسة واضحة للإرجاع والاستبدال تحمي الطرفين 📋',
        'كل نقد تتعامل معه باحترافية = عميل جديد يثق فيك 🌱',
        'ربي يجبر خاطرك ويبدلك بعملاء يحبون منتجاتك 💚',
        'تذكر: حتى أفضل مطعم بالعالم عنده تقييم نجمة واحدة 🍽️',
        'العميل الذي يشتكي يعطيك فرصة ثانية، استغلها! 🔑',
        'اللهم علّمنا ما ينفعنا وانفعنا بما علّمتنا 📖',
        'فكرة: حوّل التقييم السلبي لمحتوى تعليمي يفيد عملاءك 🎬',
        'أفضل ردود على التقييمات السلبية: شكر + اعتراف + حل 🎯',
        'الانتقاد يؤلم لكنه يبني، خلّه يخليك أقوى 💪',
        'نصيحة: وثّق التقييمات السلبية وحلولها للرجوع إليها 🗂️',
        'كل محنة في التجارة فيها منحة، إذا عرفت تستفيد 🌟',
        'ربي يلهمك الرد الحكيم والتصرف السليم 🤲',
        'ما ضرّ الأسد نباح الكلاب، لكن الحكمة في الإصلاح 🦁',
        'تقييم سلبي من 100 إيجابي = أنت على الطريق الصحيح! 📊',
        'اللهم اجعل كل تحدي يواجهه سبب لارتقاء متجره 🏔️',
        'نصيحة أخيرة: بعد حل المشكلة، اطلب من العميل تعديل تقييمه 🔄',
        'لا تخاف من التقييم السلبي، خاف من عدم التعلم منه 📚',
        'اللهم ارزقه قلب صبور وعقل حكيم في التعامل مع كل موقف 🤍',
      ],

      // ═══════════════════════════════════════════════════════════
      // 🛒 سلة متروكة
      // ═══════════════════════════════════════════════════════════
      abandoned_cart: [
        'عميل مهتم ما أكمل! فرصة ذهبية لمتابعته 🏃‍♂️',
        'نصيحة: رسالة تذكير بسيطة تحول 20% من السلات لطلبات! 📊',
        'العميل وضع المنتج بالسلة = مهتم، بس محتاج دفعة بسيطة 💬',
        'ربي يكتب لك إتمام هالطلب ورزقك فيه 🤲',
        'سلة متروكة = فلوس على الطاولة، لا تتركها! 💰',
        'فكرة: كوبون خصم صغير يحول السلة المتروكة لطلب 🎫',
        'نصيحة: أرسل تذكير خلال ساعة، هذا أفضل وقت ⏰',
        'اللهم يسّر إتمام هذا الطلب واكتب فيه البركة 💫',
        'تذكر: 70% من السلات تُترك — المتابعة تصنع الفرق 📈',
        'العميل اللي يضيف للسلة عنده نية شراء حقيقية 🛒',
        'نصيحة: "عدنا لك!" أفضل بداية لرسالة تذكير 📩',
        'فكرة: أضف عد تنازلي "العرض ينتهي قريباً" يحفزه 🕐',
        'كل سلة متروكة فرصة لا تتكرر، تابعها! 🎯',
        'ربي يرزقك بإتمام كل سلة وكل طلب 🤍',
        'نصيحة: اسأل العميل: هل واجهت مشكلة في الدفع؟ 💳',
        'أحياناً السبب بسيط مثل مشكلة تقنية أو شحن غالي 🔍',
        'رسالة شخصية باسم العميل أفضل من رسالة عامة 10 مرات 📱',
        'اللهم اجعل كل سلة متروكة تتحول لطلب مكتمل ✅',
        'فكرة: اعرض شحن مجاني كحافز لإتمام الطلب 🚚',
        'تذكر: متوسط قيمة السلة المتروكة عادةً أعلى من المكتملة 💎',
        'نصيحة: 3 رسائل تذكير (1 ساعة، 24 ساعة، 72 ساعة) مثالية 📬',
        'السلة المتروكة تخبرك بمنتجاتك الأكثر جذباً، استفد من البيانات 📊',
        'فكرة: أضف تقييمات العملاء في رسالة التذكير، تزيد الثقة ⭐',
        'كل سلة متروكة قصة غير مكتملة، أكملها! 📖',
        'اللهم يسّر لك استعادة هذا العميل وإتمام طلبه 🤲',
        'نصيحة: تحقق من أن صفحة الدفع سهلة وسلسة 💳',
        'العميل ممكن يكون تردد بسبب عدم وضوح سياسة الإرجاع 📋',
        'فكرة: اعرض منتجات مشابهة في رسالة التذكير كبدائل 🔄',
        'ربي يرجّع هالعميل ويكتب لك رزقه فيه 🌟',
        'نصيحة: لا ترسل تذكير فوري، اعطه ساعة على الأقل ⏳',
        'تذكر: عنوان الرسالة هو اللي يخلي العميل يفتحها أو لا 📧',
        'فكرة: "المنتج اللي عجبك لا زال ينتظرك" عنوان جذاب 🎁',
        'اللهم اجعل هذه السلة المتروكة سبب لتحسين تجربة الشراء ✨',
        'نصيحة: قلل خطوات الشراء، كل خطوة زيادة تخسرك عملاء 📉',
        'السلة المتروكة مو خسارة، هي بيانات مجانية عن سلوك عملائك 🧠',
        'فكرة: "باقي كمية محدودة" تخلق حافز للإتمام بسرعة ⚡',
        'ربي يفتح قلب العميل لإكمال الطلب 💚',
        'نصيحة: تأكد من أن السلة تحفظ تلقائياً عند رجوع العميل 🔒',
        'كل سلة متروكة تعلمك شي عن عميلك، اقرأ الرسالة 📖',
        'فكرة: أضف chat support في صفحة السلة للمساعدة الفورية 💬',
        'اللهم ارزقه رجوع هذا العميل وإتمام الطلب بنجاح 🤲',
        'نصيحة: لا تكثر من رسائل التذكير، 3 كافية كحد أقصى ☝️',
        'تذكر: العميل يحتاج سبب يرجع، وفّر له السبب 🔑',
        'فكرة: صورة المنتج في رسالة التذكير تذكّره ليش اختاره 📸',
        'ربي يكتب لك رزق هذا العميل ويعوضك خير 💫',
        'نصيحة ختامية: حلل أسباب ترك السلات وعالجها من جذورها 🔧',
        'كل سلة تسترجعها = ربح كان راح يضيع! 💰',
        'اللهم يسّر تجارتك وبارك في كل جهد تبذله 🌿',
        'فكرة: اعرض ضمان استرجاع الأموال، يزيد ثقة العميل 🛡️',
        'تذكر: أفضل المتاجر تسترجع 15-30% من السلات المتروكة، استهدف ذلك! 🎯',
      ],

      // ═══════════════════════════════════════════════════════════
      // 📦 شحن وتتبع
      // ═══════════════════════════════════════════════════════════
      shipping: [
        'شحنة في الطريق! 📦 اللهم يسّر وصولها سالمة',
        'نصيحة: تابع الشحنة وأبلغ العميل بكل تحديث 🔔',
        'العميل ينتظر بفارغ الصبر، خلّ التحديثات مستمرة 📱',
        'اللهم يسّر وصول الشحنة بأسرع وقت وبأفضل حال 🤲',
        'التتبع المستمر يبني ثقة العميل في متجرك 🌟',
        'نصيحة: أرسل رسالة "طلبك في الطريق!" فوراً بعد الشحن ✈️',
        'كل شحنة توصل بسلام = عميل سعيد = تقييم إيجابي ⭐',
        'ربي يحفظ الشحنة ويوصلها لصاحبها بأحسن حال 🛡️',
        'تذكر: سرعة الشحن من أهم أسباب تكرار الشراء 🏃',
        'نصيحة: تغليف مميز يصنع انطباع أول لا يُنسى 🎁',
        'العميل يحب يعرف وين طلبه الحين، وفّر له المعلومة 📍',
        'اللهم اجعل كل شحنة تصل سالمة وتفرح قلب العميل ❤️',
        'فكرة: أضف ملاحظة شكر صغيرة داخل الشحنة 📝',
        'تتبع الشحنات أول بأول يمنع المشاكل قبل ما تصير 🔍',
        'نصيحة: لو تأخرت الشحنة، تواصل مع العميل قبل ما يسألك ⚡',
        'ربي يبارك في كل شحنة تخرج من متجرك 🤍',
        'تذكر: التغليف الجيد يحمي المنتج ويحمي سمعتك 📦✨',
        'كل شحنة ناجحة خطوة نحو بناء ولاء العميل 🏗️',
        'نصيحة: قارن بين شركات الشحن واختر الأفضل لعملائك 🚛',
        'اللهم اجعل طريق كل شحنة سالك ومبارك 🛤️',
        'فكرة: صور الشحنة قبل الإرسال كتوثيق احترازي 📸',
        'العميل يثق فيك أكثر لما يشوف تحديثات شحن مستمرة 💪',
        'نصيحة: وفّر أكثر من خيار شحن (سريع/عادي) للعميل 🚚',
        'ربي يسهل وصول كل الطلبات لأصحابها بالسلامة 🤲',
        'تذكر: مشكلة الشحن مسؤولية المتجر حتى لو من شركة النقل 🤝',
        'كل شحنة فيها فرحة عميل ينتظرها بشوق 🎉',
        'نصيحة: رسالة "تم التوصيل" + طلب تقييم = كومبو ذهبي 🥇',
        'اللهم احفظ شحنات متجره من كل أذى وتأخير 🛡️',
        'فكرة: غلاف يحمل شعار متجرك يخلي العميل يتذكرك 🏷️',
        'تتبع الشحنة لحظة بلحظة يمنع القلق عند العميل 😊',
        'ربي يجعل كل توصيلة سبب ابتسامة وسعادة 🌺',
        'نصيحة: لو الشحن دولي، وضّح للعميل المدة المتوقعة مقدماً 🌍',
        'العميل اللي يستلم شحنته بسرعة = عميل يشتري مرة ثانية 🔄',
        'اللهم يسّر أمور الشحن والتوصيل وبارك فيها 💫',
        'فكرة: ستيكر "مع حب من [اسم متجرك]" على العلبة يصنع فرق 💌',
        'كل تحديث شحن ترسله يزيد راحة العميل وثقته 🌿',
        'نصيحة: جهّز الطلبات بسرعة، كل ساعة تفرق عند العميل ⏰',
        'ربي يبارك في كل يد تعبأ وتغلف وترسل بإتقان 🤲',
        'تذكر: رائحة حلوة + تغليف أنيق = تجربة unboxing لا تُنسى 🎬',
        'اللهم اجعل كل شحنة تصل أفضل مما توقع العميل ✨',
        'نصيحة: وثّق وزن الشحنة قبل الإرسال لتجنب أي خلاف 📏',
        'كل شحنة ترسلها هي رسالة حب لعميلك 💜',
        'ربي يسلّم كل الشحنات ويرضي كل العملاء 🤍',
        'نصيحة: قيّم أداء شركة الشحن بانتظام وغيّر لو لازم 📊',
        'اللهم اجعل في كل شحنة بركة ورضا وابتسامة 🌟',
        'فكرة: أضف كرت بسيط "نتمنى إن المنتج يعجبك" يصنع فرق كبير 🎨',
        'تذكر: الشحن مو نهاية البيع، هو بداية العلاقة مع العميل! 🌱',
        'نصيحة: إبلاغ فوري عن أي تأخير أفضل من انتظار شكوى العميل 📣',
        'ربي يبارك في كل خطوة من استلام الطلب حتى توصيله 🛤️',
        'اللهم اجعل كل عميل يستلم طلبه وهو راضي ومبتسم 😊',
      ],

      // ═══════════════════════════════════════════════════════════
      // 📦 منتجات (تحديث / مخزون منخفض)
      // ═══════════════════════════════════════════════════════════
      product: [
        'تنبيه مهم! ⚠️ راقب مخزونك واطلب قبل النفاد',
        'نصيحة: المخزون المنخفض فرصة لعمل حملة "الكمية محدودة" 🔥',
        'اللهم بارك في منتجاتك واكتب لها الرواج 🤲',
        'تذكر: نفاد المنتج = خسارة مبيعات + عميل محبط 😔',
        'نصيحة: اضبط تنبيه تلقائي عند وصول المخزون لحد معين 🔔',
        'المنتجات المطلوبة لازم تكون متوفرة دائماً، هذا سر النجاح 🔑',
        'فكرة: "آخر القطع" تخلق urgency وتزيد المبيعات 🚀',
        'ربي يبارك في منتجاتك ويزيد الطلب عليها 💫',
        'نصيحة: حدّث أوصاف منتجاتك بانتظام، المحتوى الطازج يبيع أكثر 📸',
        'تذكر: المنتج اللي يخلص بسرعة يعني إنه ناجح 📈',
        'اللهم اجعل في كل منتج تبيعه بركة وخير 🌾',
        'فكرة: اطلب من الموردين كميات أكبر للمنتجات الأكثر طلباً 📦',
        'نصيحة: صور احترافية للمنتج تزيد مبيعاتك 50% فعلياً 📷',
        'المخزون الجيد = عميل ما يطلع خالي الوفاض 😊',
        'ربي يكتب لمنتجاتك الرواج والقبول عند الناس 🤍',
        'تذكر: تحديث المنتج (سعر/وصف/صور) يحسّن ظهوره بالبحث 🔍',
        'نصيحة: أضف فيديو قصير للمنتج، يزيد الثقة عند العميل 🎥',
        'اللهم ارزقه منتجات مميزة يحبها العملاء 💚',
        'فكرة: بنادل/حزم (bundles) من المنتجات تزيد متوسط الطلب 🎁',
        'تذكر: المنتج المتاح = فرصة بيع، والمنتج الناقص = فرصة ضائعة ❌',
        'نصيحة: تابع مبيعات كل منتج شهرياً وتوقع الطلب 📊',
        'ربي يبارك في كل منتج في متجرك ويجعل فيه نفع 🌿',
        'اللهم اجعل منتجاتك سبب سعادة ورضا لكل عميل ✨',
        'نصيحة: وصف المنتج بالتفصيل يقلل الإرجاعات 📝',
        'فكرة: أضف قسم "منتجات مشابهة" لزيادة المبيعات 🔄',
        'تذكر: منتج واحد ممتاز أفضل من 10 منتجات عادية 🏆',
        'اللهم ارزقه التوفيق في اختيار المنتجات المناسبة لعملائه 🤲',
        'نصيحة: استمع لاقتراحات العملاء عن منتجات يبغونها 👂',
        'المنتج الجيد يسوّق نفسه، ركّز على الجودة 💎',
        'فكرة: عروض "اشتر 2 واحصل على خصم" تنشط المبيعات 🏷️',
        'ربي يكتب النجاح لكل منتج في متجرك 🌟',
        'نصيحة: المخزون الصفر يجب ما يظهر للعميل، أخفِه! 🚫',
        'تذكر: المنتجات الموسمية تحتاج تخطيط مبكر 🗓️',
        'اللهم اجعل في كل تحديث منتج خير وبركة 🤍',
        'نصيحة: سعّر منتجاتك بذكاء، لا رخيص جداً ولا غالي جداً 💰',
        'كل منتج تضيفه لمتجرك فرصة ربح جديدة 🚪',
        'ربي يبارك في تجارتك ويجعل منتجاتك مصدر نفع للناس 🕋',
        'فكرة: منتج مجاني مع أول طلب يخلي العميل يرجع 🎁',
        'نصيحة: راقب المنافسين وتعلم منهم بدون تقليد 👀',
        'اللهم ألهمه اختيار المنتجات اللي تسعد عملاءه 💫',
        'تذكر: تحديث المخزون بانتظام يمنع الإحراج مع العميل ✅',
        'كل منتج في متجرك قصة نجاح قادمة، اعتني فيه 📖',
        'نصيحة: اختبر منتجاتك بنفسك قبل بيعها، الصدق يبيع 🤝',
        'ربي يرزقك بمنتجات تنال رضا كل عميل 🤲',
        'اللهم اجعل متجرك مرجع للجودة والثقة 🏪',
        'فكرة: أضف ملصق "الأكثر مبيعاً" على المنتجات المميزة 🔥',
        'تذكر: المنتج الممتاز + خدمة ممتازة = تجارة لا تُهزم! 🏆',
        'نصيحة: لا تخاف تجرب منتجات جديدة، التجديد مطلوب 🧪',
        'اللهم اجعل كل منتج سبب رزق وبركة في متجرك 🌾',
        'ربي يكتب لمتجرك النجاح والتميز في كل منتج يعرضه 💜',
      ],
    };

    return messages[category] || messages['order_new'];
  }

  /**
   * ✅ تصنيف الحدث لفئة المقولات المناسبة
   */
  private getEventCategory(triggerEvent?: string): string {
    if (!triggerEvent) return 'order_new';

    // طلبات جديدة / تحديث
    if (triggerEvent === 'order.created' || triggerEvent === 'order.updated' ||
        triggerEvent === 'order.status.updated' || triggerEvent === 'order.payment.updated') {
      return 'order_new';
    }

    // إلغاء / استرجاع
    if (triggerEvent === 'order.cancelled' || triggerEvent === 'order.refunded') {
      return 'order_cancelled';
    }

    // إسناد طلب
    if (triggerEvent === 'order.assigned') {
      return 'order_assigned';
    }

    // عملاء
    if (triggerEvent === 'customer.created' || triggerEvent === 'customer.updated') {
      return 'customer_new';
    }

    // رسالة عميل
    if (triggerEvent === 'customer.message.received') {
      return 'customer_message';
    }

    // تقييم إيجابي
    if (triggerEvent === 'review.added') {
      return 'review_positive';
    }

    // تقييم سلبي
    if (triggerEvent === 'review.negative') {
      return 'review_negative';
    }

    // سلة متروكة
    if (triggerEvent === 'abandoned.cart') {
      return 'abandoned_cart';
    }

    // شحن وتتبع
    if (triggerEvent.startsWith('shipment.') || triggerEvent.startsWith('tracking.')) {
      return 'shipping';
    }

    // منتجات
    if (triggerEvent.startsWith('product.')) {
      return 'product';
    }

    return 'order_new'; // default
  }

  /**
   * استخراج المتغيرات من بيانات الحدث
   */
  // ═══════════════════════════════════════════════════════════
  // ✅ DB Enrichment — جلب بيانات الطلب من DB عند الحاجة
  // ═══════════════════════════════════════════════════════════

  /**
   * هل الحدث مرتبط بطلبات؟
   */
  private isOrderEvent(eventType: string): boolean {
    return eventType.startsWith('order.');
  }

  /**
   * هل البيانات تحتوي على معلومات الطلب الأساسية؟
   * إذا لا → نحتاج enrichment من DB
   */
  private hasOrderData(data: Record<string, unknown>): boolean {
    return !!(
      data.reference_id ||
      data.order_number ||
      (data.customer && typeof data.customer === 'object' && (data.customer as any).first_name)
    );
  }

  /**
   * ✅ جلب بيانات الطلب — Layer 1: من DB، Layer 2: من بيانات communication webhook
   * يُستخدم عند communication webhooks اللي ما تضمّن بيانات الطلب
   */
  private async enrichOrderFromDB(
    data: Record<string, unknown>,
    context: EventContext,
  ): Promise<Record<string, unknown> | null> {
    const entity = data.entity as { id?: number | string; type?: string } | undefined;
    const meta = data.meta as Record<string, unknown> | undefined;
    const entityId = entity?.id || meta?.order_id || data.orderId;

    this.logger.log(`🔧 enrichOrder v3: START | entityId=${entityId || 'NONE'} | storeId=${context.storeId || 'NONE'} | dataKeys=${Object.keys(data).join(',')}`);

    // ═══ LAYER 1: DB Lookup ═══
    if (entityId) {
      try {
        const sallaId = String(entityId);
        const order = await this.orderRepository.findOne({
          where: context.storeId
            ? { sallaOrderId: sallaId, storeId: context.storeId }
            : { sallaOrderId: sallaId, tenantId: context.tenantId },
          relations: ['customer'],
        });

        if (order) {
          this.logger.log(`🔧 enrichOrder: found order ${order.referenceId || order.sallaOrderId} from DB`);
          return {
            ...data,
            id: order.sallaOrderId || order.id,
            reference_id: order.referenceId,
            order_number: order.referenceId,
            total: order.totalAmount,
            currency: order.currency || 'SAR',
            status: { name: order.status },
            payment_method: order.paymentMethod || 'غير محدد',
            payment_status: order.paymentStatus || 'غير محدد',
            payment: {
              method: { name: order.paymentMethod || 'غير محدد' },
              status: order.paymentStatus || 'غير محدد',
            },
            customer: {
              first_name: order.customer?.firstName || order.customer?.fullName || '',
              last_name: order.customer?.lastName || '',
              name: order.customer?.fullName || '',
              mobile: order.customer?.phone || '',
              phone: order.customer?.phone || '',
              email: order.customer?.email || '',
            },
            items: order.items || [],
            shipping: {
              company: { name: (order as any).shippingInfo?.carrierName || 'غير محدد' },
              tracking_number: (order as any).shippingInfo?.trackingNumber || 'لا يوجد تتبع',
            },
            created_at: order.createdAt ? new Date(order.createdAt).toLocaleDateString('ar-SA') : '',
          };
        }

        this.logger.log(`🔧 enrichOrder: order ${sallaId} not in DB — trying Salla API`);
      } catch (e) {
        this.logger.warn(`🔧 enrichOrder DB lookup failed: ${(e as Error).message}`);
      }
    }

    // ═══ استخراج رقم الطلب من نص الرسالة (متاح لكل الطبقات) ═══
    const content = (data.content || '') as string;
    const notifiable = Array.isArray(data.notifiable) ? data.notifiable : [];
    const orderNumMatch = content.match(/(?:طلبك|الطلب|order)\s*(?:رقم|#|number)?\s*(\d{6,})/i);
    const refFromText = orderNumMatch?.[1] || '';

    // ═══ LAYER 2: Salla API — جلب البيانات الكاملة مباشرة من سلة ═══
    if (context.storeId) {
      try {
        const store = await this.storeRepository
          .createQueryBuilder('store')
          .addSelect('store.accessToken')
          .where('store.id = :storeId', { storeId: context.storeId })
          .andWhere('store.deletedAt IS NULL')
          .getOne();

        if (store?.accessToken && store.platform === 'salla') {
          const accessToken = decrypt(store.accessToken);
          if (accessToken) {
            let sallaOrder: any = null;

            // ── طريقة 1: getOrder بالـ entity.id (Internal Salla ID) ──
            if (entityId) {
              try {
                this.logger.log(`🔧 enrichOrder v3: L2-A → getOrder(${entityId})`);
                const resp = await this.sallaApiService.getOrder(accessToken, Number(entityId));
                sallaOrder = resp?.data;
                if (sallaOrder) {
                  this.logger.log(`🔧 enrichOrder v3: ✅ L2-A SUCCESS → ref=${sallaOrder.reference_id}`);
                  this.logger.log(`🔧 enrichOrder v3: RAW → items=${JSON.stringify(sallaOrder.items?.slice?.(0,2) || sallaOrder.items)}, total=${sallaOrder.amounts?.total?.amount}, keys=${Object.keys(sallaOrder).join(',')}`);
                }
              } catch (e: any) {
                this.logger.warn(`🔧 enrichOrder v3: L2-A failed (status=${e?.status || 'unknown'}, ${e?.message || e}) → trying L2-B`);
              }
            }

            // ── طريقة 2: searchOrderByReference بالرقم المرجعي من النص ──
            if (!sallaOrder && refFromText) {
              try {
                this.logger.log(`🔧 enrichOrder v3: L2-B → searchByReference("${refFromText}")`);
                sallaOrder = await this.sallaApiService.searchOrderByReference(accessToken, refFromText);
                if (sallaOrder) {
                  this.logger.log(`🔧 enrichOrder v3: ✅ L2-B SUCCESS → ref=${sallaOrder.reference_id}`);
                }
              } catch (e: any) {
                this.logger.warn(`🔧 enrichOrder v3: L2-B failed: ${e?.message}`);
              }
            }

            // ── تحويل النتيجة ──
            if (sallaOrder) {
              // ✅ Salla GET /orders/{id} لا يرجّع items — نجلبها بشكل منفصل
              let items: any[] = Array.isArray(sallaOrder.items) ? sallaOrder.items : [];
              if (items.length === 0) {
                this.logger.log(`🔧 enrichOrder v3: items not in order response — fetching /orders/${sallaOrder.id}/items`);
                items = await this.sallaApiService.getOrderItems(accessToken, sallaOrder.id);
                this.logger.log(`🔧 enrichOrder v3: fetched ${items.length} items from separate endpoint`);
              }

              // ✅ Salla returns payment_method (string) not payment.method.name
              const paymentMethod = sallaOrder.payment?.method?.name
                || (typeof sallaOrder.payment_method === 'string' ? sallaOrder.payment_method : '')
                || (typeof sallaOrder.payment_method === 'object' ? (sallaOrder.payment_method as any)?.name : '')
                || 'غير محدد';

              const paymentStatus = sallaOrder.payment?.status || sallaOrder.payment_status || 'غير محدد';
              const totalAmount = sallaOrder.amounts?.total?.amount ?? sallaOrder.total ?? 0;
              const currency = sallaOrder.amounts?.total?.currency || sallaOrder.currency || 'SAR';

              this.logger.log(`🔧 enrichOrder v3: ✅ FULL DATA → customer=${sallaOrder.customer?.first_name}, items=${items.length}, total=${totalAmount}, payment=${paymentMethod}`);

              return {
                ...data,
                id: sallaOrder.id,
                reference_id: sallaOrder.reference_id,
                order_number: sallaOrder.reference_id,
                total: totalAmount,
                currency,
                status: sallaOrder.status,
                payment: sallaOrder.payment || { method: { name: paymentMethod }, status: paymentStatus },
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                customer: sallaOrder.customer ? {
                  first_name: sallaOrder.customer.first_name || '',
                  last_name: sallaOrder.customer.last_name || '',
                  name: `${sallaOrder.customer.first_name || ''} ${sallaOrder.customer.last_name || ''}`.trim(),
                  mobile: sallaOrder.customer.mobile || '',
                  phone: sallaOrder.customer.mobile || '',
                  email: sallaOrder.customer.email || '',
                } : undefined,
                items: items.map((it: any) => ({
                  name: it.name || it.product_name || 'منتج',
                  quantity: it.quantity || 1,
                  price: { amount: it.price?.amount || it.price || 0 },
                  sku: it.sku || '',
                })),
                date: sallaOrder.date,
                created_at: sallaOrder.date?.date || '',
              };
            }

            this.logger.log('🔧 enrichOrder v3: LAYER 2 both methods returned nothing');
          } else {
            this.logger.warn(`🔧 enrichOrder v3: LAYER 2 SKIP — decrypt failed`);
          }
        } else {
          this.logger.warn(`🔧 enrichOrder v3: LAYER 2 SKIP — store=${store ? 'found' : 'null'}, hasToken=${!!store?.accessToken}, platform=${store?.platform || 'unknown'}`);
        }
      } catch (e) {
        this.logger.warn(`🔧 enrichOrder v3: LAYER 2 ERROR: ${(e as Error).message}`);
      }
    } else {
      this.logger.warn(`🔧 enrichOrder v3: LAYER 2 SKIP — no storeId`);
    }

    // ═══ LAYER 3: Fallback — بيانات من نص الرسالة فقط ═══
    const nameMatch = content.match(/أهلاً\s+([^،,]+)[،,]/);
    const customerName = nameMatch?.[1]?.trim() || '';
    const customerPhone = notifiable[0] ? String(notifiable[0]).replace(/[^0-9]/g, '') : '';

    if (refFromText || customerName || customerPhone) {
      this.logger.log(`🔧 enrichOrder v3: LAYER 3 (regex fallback) → order=${refFromText}, name=${customerName}`);
      return {
        ...data,
        id: entityId ? String(entityId) : refFromText,
        reference_id: refFromText,
        order_number: refFromText,
        customer: { first_name: customerName, name: customerName, mobile: customerPhone, phone: customerPhone },
      };
    }

    this.logger.log('🔧 enrichOrder v3: ALL LAYERS FAILED — no data available');
    return null;
  }

  private extractVariables(
    data: Record<string, unknown>,
    _context: EventContext,
  ): TemplateVariables {
    const now = new Date();

    const baseUrl = this.configService.get<string>('app.frontendUrl', 'https://rafeq.ai');

    // ✅ رابط الطلب الفعلي من بيانات سلة (urls.admin) أو بناء الرابط
    const urls = (data.urls || {}) as Record<string, unknown>;
    const orderAdminUrl = urls.admin || urls.customer || null;

    // ✅ بناء قائمة المنتجات من items
    const items = Array.isArray(data.items) ? data.items : [];
    let itemsText = '';
    if (items.length > 0) {
      itemsText = items.map((it: any, idx: number) => {
        const name = it.name || it.product_name || 'منتج';
        const qty = it.quantity || 1;
        const price = it.price?.amount || it.price || it.unitPrice || it.total || 0;
        return `${idx + 1}. *${name}*\n   - *الكمية:* ${qty}\n   - *السعر:* ${price} ر.س`;
      }).join('\n');
    }

    // ✅ بيانات الدفع
    const paymentMethod = this.safeGet(data, 'payment.method.name')
      || this.safeGet(data, 'payment_method')
      || 'غير محدد';
    const paymentStatus = this.safeGet(data, 'payment.status')
      || this.safeGet(data, 'payment_status')
      || 'غير محدد';

    // ✅ بيانات الشحن
    const shippingCompany = this.safeGet(data, 'shipping.company.name')
      || this.safeGet(data, 'shipping_company')
      || 'غير محدد';
    const trackingNumber = this.safeGet(data, 'shipping.tracking_number')
      || this.safeGet(data, 'tracking_number')
      || 'لا يوجد تتبع';

    // ✅ تاريخ الطلب
    const orderDate = this.safeGet(data, 'date.date')
      || this.safeGet(data, 'created_at')
      || now.toLocaleDateString('ar-SA');

    // ✅ بريد العميل
    const customerEmail = this.safeGet(data, 'customer.email') || 'غير متوفر';

    return {
      // بيانات الطلب
      '{رقم_الطلب}': this.safeGet(data, 'reference_id') || this.safeGet(data, 'order_number') || this.safeGet(data, 'id') || this.safeGet(data, 'order_id'),
      '{مبلغ_الطلب}': this.formatAmountValue(data.total || this.safeGet(data, 'amounts.total.amount')),
      '{حالة_الطلب}': this.safeGet(data, 'status.name') || this.safeGet(data, 'status'),
      '{طريقة_الدفع}': paymentMethod,
      '{حالة_الدفع}': paymentStatus,
      '{تاريخ_الطلب}': orderDate,
      '{رابط_الطلب}': orderAdminUrl ? String(orderAdminUrl) : `${baseUrl}/dashboard/orders/${this.safeGet(data, 'id') || ''}`,

      // بيانات الشحن
      '{شركة_الشحن}': shippingCompany,
      '{رقم_التتبع}': trackingNumber,

      // بيانات المنتجات
      '{المنتجات}': itemsText || 'لا توجد منتجات',
      '{عدد_المنتجات}': String(items.length),

      // بيانات العميل
      '{اسم_العميل}':
        [this.safeGet(data, 'customer.first_name'), this.safeGet(data, 'customer.last_name')]
          .filter(Boolean)
          .join(' ') || this.safeGet(data, 'customer.name') || '',
      '{هاتف_العميل}': this.safeGet(data, 'customer.mobile') || this.safeGet(data, 'customer.phone'),
      '{بريد_العميل}': customerEmail,

      // بيانات المنتج (للأحداث الفردية)
      '{اسم_المنتج}': this.safeGet(data, 'name') || this.safeGet(data, 'product.name'),
      '{كمية_المنتج}': this.safeGet(data, 'quantity') || this.safeGet(data, 'stock_quantity'),

      // بيانات التقييم
      '{نص_التقييم}': this.safeGet(data, 'content') || this.safeGet(data, 'review.content'),
      '{درجة_التقييم}': this.safeGet(data, 'rating') || this.safeGet(data, 'review.rating'),

      // بيانات عامة
      '{اسم_المتجر}': this.safeGet(data, 'store.name') || this.safeGet(data, 'merchant.name') || '',
      '{التاريخ}': now.toLocaleDateString('ar-SA'),
      '{الوقت}': now.toLocaleTimeString('ar-SA'),
    };
  }

  /**
   * تحديد المستلمين حسب أنواع القاعدة (يدعم أنواع متعددة)
   * ✅ مربوط مع UsersService لجلب بيانات الموظفين الحقيقية
   */
  private async resolveRecipients(
    rule: NotificationRule,
    data: Record<string, unknown>,
  ): Promise<EmployeeInfo[]> {
    const allRecipients: EmployeeInfo[] = [];
    const seenIds = new Set<string>();

    // ✅ معالجة كل نوع مستلم
    for (const type of rule.recipientTypes) {
      const recipients = await this.resolveByType(type, rule, data);
      
      // منع التكرار
      for (const r of recipients) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          allRecipients.push(r);
        }
      }
    }

    return allRecipients;
  }

  /**
   * معالجة نوع مستلم واحد
   */
  private async resolveByType(
    type: string,
    rule: NotificationRule,
    data: Record<string, unknown>,
  ): Promise<EmployeeInfo[]> {
    switch (type) {
      case RecipientType.ALL_EMPLOYEES: {
        // ✅ جلب جميع الموظفين النشطين من UsersService
        const users = await this.usersService.findAll(rule.tenantId);
        return users
          .filter(u => u.status === 'active')
          .map(u => ({
            id: u.id,
            name: `${u.firstName} ${u.lastName}`.trim() || u.email,
            email: u.email || null,
            phone: u.phone || null,
            role: u.role || null,
          }));
      }

      case RecipientType.SPECIFIC_EMPLOYEES: {
        if (!rule.specificEmployeeIds?.length) return [];
        // ✅ جلب موظفين محددين
        const results: EmployeeInfo[] = [];
        for (const empId of rule.specificEmployeeIds) {
          try {
            const user = await this.usersService.findOne(empId, rule.tenantId);
            results.push({
              id: user.id,
              name: `${user.firstName} ${user.lastName}`.trim() || user.email,
              email: user.email || null,
              phone: user.phone || null,
              role: user.role || null,
            });
          } catch {
            this.logger.warn(`Employee not found: ${empId}`);
          }
        }
        return results;
      }

      case RecipientType.BY_ROLE: {
        if (!rule.targetRoles?.length) return [];
        // ✅ جلب موظفين حسب الدور
        const allUsers = await this.usersService.findAll(rule.tenantId);
        return allUsers
          .filter(u => u.status === 'active' && rule.targetRoles!.includes(u.role))
          .map(u => ({
            id: u.id,
            name: `${u.firstName} ${u.lastName}`.trim() || u.email,
            email: u.email || null,
            phone: u.phone || null,
            role: u.role || null,
          }));
      }

      case RecipientType.ASSIGNED_EMPLOYEE: {
        const assignedId = this.safeGet(data, 'assigned_to') || this.safeGet(data, 'employee_id');
        if (!assignedId) return [];
        try {
          const user = await this.usersService.findOne(String(assignedId), rule.tenantId);
          return [{
            id: user.id,
            name: `${user.firstName} ${user.lastName}`.trim() || user.email,
            email: user.email || null,
            phone: user.phone || null,
            role: user.role || null,
          }];
        } catch {
          this.logger.warn(`Assigned employee not found: ${assignedId}`);
          return [];
        }
      }

      case RecipientType.CUSTOM_PHONES:
        if (!rule.customPhones?.length) return [];
        return rule.customPhones.map((phone, idx) => ({
          id: `custom-phone-${idx}-${phone}`,
          name: phone,
          email: null,
          phone: this.normalizePhone(phone),
          role: null,
        }));

      case RecipientType.CUSTOM_EMAILS:
        if (!rule.customEmails?.length) return [];
        return rule.customEmails.map((email, idx) => ({
          id: `custom-email-${idx}-${email}`,
          name: email,
          email: email.toLowerCase().trim(),
          phone: null,
          role: null,
        }));

      default:
        this.logger.warn(`Unknown recipient type: ${type}`);
        return [];
    }
  }

  /**
   * ✅ تنظيف رقم الهاتف — ضمان صيغة دولية
   */
  /**
   * ✅ فحص توافق المستلم مع القناة
   * - whatsapp: يحتاج رقم جوال
   * - email: يحتاج بريد إلكتروني
   * - dashboard: دائماً متاح
   */
  private canSendToChannel(employee: EmployeeInfo, channel: NotificationChannel): boolean {
    switch (channel) {
      case NotificationChannel.WHATSAPP:
        return !!employee.phone && employee.phone.trim().length > 0;
      case NotificationChannel.EMAIL:
        return !!employee.email && employee.email.includes('@');
      case NotificationChannel.DASHBOARD:
        // ✅ Dashboard فقط للموظفين الحقيقيين (ليس custom-phone أو custom-email)
        return !employee.id.startsWith('custom-');
      default:
        return false;
    }
  }

  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-()]/g, '');
    
    // إذا يبدأ بـ 0 وبدون + → إزالة الصفر (التاجر يحدد رمز الدولة من الواجهة)
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    }
    
    // إذا ما يبدأ بـ + أضف +
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * فحص الشروط الإضافية
   */
  private evaluateConditions(
    conditions: Record<string, unknown> | null,
    data: Record<string, unknown>,
  ): boolean {
    if (!conditions || Object.keys(conditions).length === 0) {
      return true; // لا شروط = مطابق دائماً
    }

    const now = new Date();
    const currentHour = now.getHours();

    // شرط الوقت: بعد ساعة معينة
    if (conditions.afterHour !== undefined) {
      if (currentHour < Number(conditions.afterHour)) {
        return false;
      }
    }

    // شرط الوقت: قبل ساعة معينة
    if (conditions.beforeHour !== undefined) {
      if (currentHour >= Number(conditions.beforeHour)) {
        return false;
      }
    }

    // شرط الحد الأدنى لمبلغ الطلب
    if (conditions.minOrderAmount !== undefined) {
      const amount = Number(
        this.safeGet(data, 'total.amount') ||
        this.safeGet(data, 'amounts.total.amount') ||
        0,
      );
      if (amount < Number(conditions.minOrderAmount)) {
        return false;
      }
    }

    // شرط التقييم أقل من قيمة معينة
    if (conditions.ratingBelow !== undefined) {
      const rating = Number(
        this.safeGet(data, 'rating') ||
        this.safeGet(data, 'review.rating') ||
        5,
      );
      if (rating >= Number(conditions.ratingBelow)) {
        return false;
      }
    }

    // شرط حالة الطلب
    if (conditions.orderStatus !== undefined) {
      const status = this.safeGet(data, 'status.name') || this.safeGet(data, 'status');
      if (status !== conditions.orderStatus) {
        return false;
      }
    }

    return true;
  }

  /**
   * بناء رابط مباشر للحدث
   */
  private buildActionUrl(context: EventContext): string | null {
    const { eventType, data } = context;
    const entityId = data.id || data.order_id;

    // ✅ أولاً: استخدام رابط سلة الفعلي إذا كان موجوداً
    const urls = (data.urls || {}) as Record<string, unknown>;
    if (urls.admin) return String(urls.admin);
    if (urls.customer) return String(urls.customer);

    if (!entityId) return null;

    // fallback: رابط لوحة رفيق
    const baseUrl = this.configService.get<string>('app.frontendUrl', 'https://rafeq.ai');

    if (eventType.startsWith('order.')) {
      return `${baseUrl}/dashboard/orders/${entityId}`;
    }
    if (eventType.startsWith('customer.')) {
      return `${baseUrl}/dashboard/customers/${entityId}`;
    }
    if (eventType.startsWith('product.')) {
      return `${baseUrl}/dashboard/products/${entityId}`;
    }
    if (eventType.startsWith('review.')) {
      return `${baseUrl}/dashboard/reviews/${entityId}`;
    }

    return null;
  }

  /**
   * ✅ جلب اسم المتجر من قاعدة البيانات
   */
  private async getStoreName(tenantId: string, storeId?: string): Promise<string | null> {
    try {
      if (storeId) {
        const store = await this.storesService.findById(tenantId, storeId);
        return store?.name || store?.sallaStoreName || null;
      }
      // إذا ما فيه storeId، نجلب أول متجر للـ tenant
      const stores = await this.storesService.findByTenant(tenantId);
      if (stores?.length > 0) {
        return stores[0].name || stores[0].sallaStoreName || null;
      }
      return null;
    } catch {
      this.logger.debug(`Could not fetch store name for tenant ${tenantId}`);
      return null;
    }
  }

  /**
   * القوالب الافتراضية حسب نوع الحدث
   */
  private getDefaultTitle(event: NotificationTriggerEvent): string {
    const titles: Record<string, string> = {
      [NotificationTriggerEvent.ORDER_CREATED]: '🛒 طلب جديد',
      [NotificationTriggerEvent.ORDER_STATUS_UPDATED]: '📦 تحديث حالة طلب',
      [NotificationTriggerEvent.ORDER_CANCELLED]: '❌ إلغاء طلب',
      [NotificationTriggerEvent.ORDER_ASSIGNED]: '📋 إسناد طلب',
      [NotificationTriggerEvent.ORDER_PAYMENT_UPDATED]: '💰 تحديث دفع',
      [NotificationTriggerEvent.CUSTOMER_CREATED]: '👤 عميل جديد',
      [NotificationTriggerEvent.CUSTOMER_MESSAGE_RECEIVED]: '💬 رسالة من عميل',
      [NotificationTriggerEvent.REVIEW_ADDED]: '⭐ تقييم جديد',
      [NotificationTriggerEvent.REVIEW_NEGATIVE]: '⚠️ تقييم سلبي',
      [NotificationTriggerEvent.SHIPMENT_CREATED]: '🚚 شحنة جديدة',
      [NotificationTriggerEvent.ABANDONED_CART]: '🛒 سلة متروكة',
      [NotificationTriggerEvent.PRODUCT_LOW_STOCK]: '📉 مخزون منخفض',
    };

    return titles[event] || '🔔 تنبيه';
  }

  private getDefaultTemplate(event: NotificationTriggerEvent): string {
    const templates: Record<string, string> = {
      [NotificationTriggerEvent.ORDER_CREATED]:
        '📋 تفاصيل الطلب رقم *{رقم_الطلب}*:\n\n*اسم العميل:* {اسم_العميل}\n*رقم الهاتف:* {هاتف_العميل}\n*البريد الإلكتروني:* {بريد_العميل}\n*المبلغ:* {مبلغ_الطلب} ر.س\n*حالة الطلب:* {حالة_الطلب}\n*حالة الدفع:* {حالة_الدفع}\n*طريقة الدفع:* {طريقة_الدفع}\n*تاريخ الطلب:* {تاريخ_الطلب}\n*الشحن:* {شركة_الشحن}، {رقم_التتبع}\n\n🛒 *المنتجات:*\n{المنتجات}',
      [NotificationTriggerEvent.ORDER_ASSIGNED]:
        'مرحباً {اسم_الموظف}، تم إسناد الطلب رقم {رقم_الطلب} لك، الرجاء المتابعة.',
      [NotificationTriggerEvent.ORDER_CANCELLED]:
        'فريق {اسم_المتجر}، تنبيه: تم إلغاء الطلب رقم {رقم_الطلب} من العميل {اسم_العميل}',
      [NotificationTriggerEvent.ORDER_STATUS_UPDATED]:
        'تم تحديث حالة الطلب رقم {رقم_الطلب} إلى: {حالة_الطلب}',
      [NotificationTriggerEvent.CUSTOMER_MESSAGE_RECEIVED]:
        '💬 رسالة جديدة من العميل {اسم_العميل} - الرجاء الرد في أقرب وقت',
      [NotificationTriggerEvent.REVIEW_ADDED]:
        'تقييم جديد ({درجة_التقييم}/5) من العميل {اسم_العميل}: {نص_التقييم}',
      [NotificationTriggerEvent.REVIEW_NEGATIVE]:
        '⚠️ تقييم سلبي ({درجة_التقييم}/5) للطلب {رقم_الطلب}: {نص_التقييم}',
      [NotificationTriggerEvent.ABANDONED_CART]:
        'سلة متروكة من العميل {اسم_العميل} بمبلغ {مبلغ_الطلب} ر.س',
      [NotificationTriggerEvent.PRODUCT_LOW_STOCK]:
        '📉 المنتج "{اسم_المنتج}" وصل للحد الأدنى من المخزون: {كمية_المنتج} وحدة',
    };

    return templates[event] || 'تنبيه: حدث {حالة_الطلب} على الطلب {رقم_الطلب}';
  }

  /**
   * الوصول الآمن لحقل متداخل في كائن
   * مثال: safeGet(data, 'customer.first_name')
   */
  private safeGet(obj: Record<string, unknown>, path: string): string | null {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current == null || typeof current !== 'object') {
        return null;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current != null ? String(current) : null;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * ✅ تنسيق المبلغ — يدعم object { amount } أو رقم أو نص
   */
  private formatAmountValue(amount: unknown): string {
    if (!amount) return '0';
    if (typeof amount === 'string') return amount;
    if (typeof amount === 'number') return amount.toLocaleString('en-US');
    if (typeof amount === 'object' && amount !== null) {
      const obj = amount as Record<string, unknown>;
      const numVal = obj.amount ?? obj.value ?? obj.total ?? obj.grand_total;
      if (numVal !== undefined && numVal !== null) {
        return Number(numVal).toLocaleString('en-US');
      }
    }
    return String(amount);
  }
}
