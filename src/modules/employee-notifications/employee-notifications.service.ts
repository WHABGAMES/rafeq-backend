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

    @InjectQueue('employee-notifications')
    private readonly notificationQueue: Queue,

    // 👥 لجلب بيانات الموظفين
    private readonly usersService: UsersService,

    // 🏪 لجلب اسم المتجر
    private readonly storesService: StoresService,

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
        const variables = this.extractVariables(data, context);
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

    // ✅ الترتيب: الرسالة → الرابط → فريق رفيق يقولك + عبارة تحفيزية (آخر شي)
    const motivational = this.getMotivationalText(rule.motivationalMessage);
    message = `${message}\n\nفريق رفيق يقولك:\n${motivational}`;

    return { title, message };
  }

  /**
   * ✅ الفقرة التحفيزية: نص التاجر أو نص افتراضي عشوائي من 100+ عبارة
   */
  private getMotivationalText(customMessage: string | null | undefined): string {
    if (customMessage && customMessage.trim()) {
      return customMessage.trim();
    }

    const defaults = [
      // ═══════ أدعية رزق وبركة ═══════
      'اللهم بارك لك في رزقك وزدك من فضلك 🤍',
      'نسأل الله أن يرزقك أضعاف ما تتمنى ❤️',
      'اللهم اجعل هذا الطلب فاتحة خير وبركة عليك 🌟',
      'ربي يبارك لك في تجارتك ويرزقك من حيث لا تحتسب 💫',
      'اللهم وسّع رزقك وبارك في كل طلب يأتيك ✨',
      'نسأل الله لك البركة في المال والعمل والوقت 🤲',
      'اللهم اجعل تجارتك رابحة ورزقك واسع 💚',
      'ربي يفتح عليك أبواب الرزق من كل مكان 🚪✨',
      'اللهم بارك له في ماله وأهله وتجارته 🤍',
      'نسأل الله أن يجعل كل يوم أفضل من اللي قبله 🌙',
      'اللهم ارزقه رزقاً لا ينقطع وبركة لا تنتهي 💎',
      'ربنا يتمم عليك بالخير ويزيدك نجاح 🌺',
      'اللهم اجعل عملك خالصاً لوجهك واكتب لك التوفيق 🤲',
      'نسأل الله يحقق لك كل أحلامك التجارية ⭐',
      'اللهم بارك في رزقه وارزقه حلالاً طيباً 🌿',

      // ═══════ أدعية توفيق ونجاح ═══════
      'الله يوفقك في كل خطوة ويسهل أمورك 🙏',
      'ربي يكتب لك التوفيق والسداد في كل قراراتك 💫',
      'اللهم سدد خطاه ووفقه لما تحب وترضى 🌟',
      'نسأل الله يجعلك من الناجحين في الدنيا والآخرة 🤍',
      'الله يعطيك العافية ويبارك في جهودك 💪',
      'اللهم اكتب له النجاح في تجارته والسعادة في حياته ❤️',
      'ربي يتمم لك على خير ويفرحك بشغلك 🎉',
      'اللهم وفقه وأعنه واجعل عمله في ميزان حسناته 🤲',
      'نسأل الله لك دوام التوفيق والنجاح والبركة 🌈',
      'الله يجعل تعبك في ميزان حسناتك ويجزيك خير 💚',

      // ═══════ عبارات تحفيزية ═══════
      'كل طلب جديد هو خطوة نحو حلمك الكبير 🚀',
      'نجاحك يبدأ من هنا.. واصل وما تكسر 💪',
      'أنت تصنع قصة نجاح كل يوم، استمر! ⭐',
      'كل طلب يقربك من هدفك.. لا تتوقف 🎯',
      'اليوم طلب، وبكرا ألف طلب بإذن الله! 📈',
      'الله يوصلك مليون طلب يا بطل 🏆',
      'نتمنى لك كل خير ويارب يوصلك مليون طلب 🔥',
      'تجارتك ما شاء الله تبارك الله، واصل! 💎',
      'أنت على الطريق الصحيح، الله يبارك لك 🛤️',
      'ما شاء الله عليك، شغلك ملهم واصل! 💪🔥',
      'كل يوم أنت أقرب لحلمك.. لا تستسلم ⚡',
      'نفتخر فيك وبشغلك الرائع، واصل يا بطل! 🌟',
      'العالم يحتاج ناس مثلك، شغلك مميز 🤍',
      'طريق النجاح طويل بس أنت ماشي صح 🏃‍♂️✨',
      'كل إنجاز يبدأ بخطوة، وأنت خطيت! 👣',

      // ═══════ نصائح تجارية قصيرة ═══════
      'نصيحة اليوم: رد على عملائك بسرعة، هذا سر الولاء! ⚡',
      'تذكّر: العميل الراضي يجيب لك 10 عملاء جدد 📣',
      'نصيحة: تابع طلباتك أول بأول، العميل يحب المتابعة 📦',
      'فكرة: اسأل عميلك عن رأيه بعد التوصيل، يحب الاهتمام 💬',
      'تذكّر: الجودة أهم من الكمية، ركز على رضا العميل ⭐',
      'نصيحة: التصوير الجيد للمنتج يزيد مبيعاتك 50%! 📸',
      'فكرة: أضف لمسة شخصية مع كل طلب، العميل يحب التفاصيل 🎁',
      'تذكّر: تغليف مميز = تجربة لا تُنسى = عميل دائم 📦✨',
      'نصيحة: احرص على وصف منتجاتك بدقة، الشفافية مفتاح الثقة 🔑',
      'فكرة: شارك قصص عملائك على حساباتك، هذا تسويق مجاني! 📱',
      'نصيحة: حدّث مخزونك باستمرار وتجنب نفاد المنتجات 📊',
      'تذكّر: خدمة ما بعد البيع أهم من البيع نفسه! 🤝',
      'فكرة: أنشئ برنامج ولاء لعملائك المتكررين 🏅',
      'نصيحة: الشحن السريع من أهم أسباب تكرار الشراء 🚀',
      'فكرة: استثمر في المحتوى التعليمي لمنتجاتك 📚',

      // ═══════ دعم نفسي وتشجيع ═══════
      'تعبك اليوم هو راحتك بكرا، واصل يا بطل 💪',
      'كل تاجر ناجح مر بأيام صعبة، الفرق إنه ما وقف 🦅',
      'الصبر مفتاح الفرج، وأنت على الباب! 🔑',
      'لا تقارن بداياتك بنجاحات غيرك، كل واحد له وقته ⏰',
      'النجاح مو حظ، النجاح شغل وتعب وإصرار 💎',
      'أنت أقوى مما تتخيل، وتجارتك أكبر مما تتوقع 🦁',
      'كل يوم جديد فيه فرصة جديدة، اغتنمها! 🌅',
      'ثق بالله ثم بنفسك، أنت تستاهل النجاح ❤️',
      'التحديات تصنع الأبطال، وأنت واحد منهم! 🏆',
      'لا تخاف من الفشل، خاف من إنك ما تحاول 🚀',
      'اليوم أفضل من أمس وبكرا أفضل من اليوم بإذن الله 📈',
      'حتى لو بطيء، المهم تمشي للأمام وما ترجع! 🐢➡️🐇',
      'كل مشكلة فيها فرصة مخفية، بس لازم تشوفها 👀',
      'أنت مو بس تاجر، أنت تبني حلم كامل! 🏗️',
      'الإصرار هو سلاحك الأقوى، لا تتخلى عنه! ⚔️',

      // ═══════ عبارات شكر وتقدير ═══════
      'شكراً لأنك تثق فينا، نعدك بالأفضل دائماً 🤝',
      'سعداء بخدمتك ونتمنى لك مبيعات خيالية! 🎉',
      'شراكتنا معك هي مصدر فخر لنا، شكراً لثقتك 💜',
      'نقدر تعبك وجهدك ونتمنى نكون عند حسن ظنك 🌟',
      'أنت شريك نجاحنا، وإحنا شركاء نجاحك! 🤝✨',

      // ═══════ بركة وخير ═══════
      'بسم الله ما شاء الله، تجارتك فيها بركة 🕋',
      'ربي يحفظ تجارتك ويحميها من كل شر 🛡️',
      'اللهم اجعل في كل طلب بركة وخير 🌾',
      'ما شاء الله تبارك الله، الله يديم عليك النعمة 🤍',
      'اللهم لا حسد، تجارتك فيها خير كثير! 🧿💚',
      'اللهم زده من فضلك ولا تحرمه من رزقك 🤲',
      'بارك الله في رزقك وجعل البركة في كل شي تسويه 🌿',
      'ربي يجعل كل ريال تكسبه حلال فيه بركة 💰🤍',
      'اللهم اجعل عمله صدقة جارية وتجارة رابحة 📿',
      'نسأل الله أن يبارك في كل لحظة تقضيها في عملك 🕐',

      // ═══════ طموح وأحلام كبيرة ═══════
      'حلمك الكبير يبدأ بطلب واحد، وها أنت بدأت! 🎬',
      'اليوم متجر صغير، وبكرا علامة تجارية عالمية بإذن الله 🌍',
      'كل طلب هو لبنة في بناء إمبراطوريتك التجارية 🏰',
      'أنت اليوم تكتب أول صفحة من قصة نجاح عظيمة 📖',
      'لا تستصغر أي طلب، فالبحر يبدأ بقطرة 🌊',
      'من هنا بدأ كبار التجار، واصل وشف النتيجة! 📊',
      'ربي يوصلك للقمة وتبقى فيها يا بطل 🏔️',
      'النجاح مو صدفة، هو نتيجة شغلك اليومي 🔧',
      'تخيل شكل متجرك بعد سنة من الآن، وحقق الحلم! 💭',
      'الأحلام الكبيرة تحتاج أشخاص أكبر منها، وأنت كذلك 🌟',

      // ═══════ تفاؤل وإيجابية ═══════
      'يوم مبارك وطلبات مباركة بإذن الله ☀️',
      'هذا يومك، واصل واستمتع بكل طلب جديد! 🎊',
      'أبشر بالخير، الله يفتح عليك أبواب ما توقعتها! 🚪',
      'كل صباح فيه فرصة جديدة، واليوم فرصتك! 🌞',
      'الخير جاي والرزق واسع، ثق بالله وتوكل عليه 🤲',
      'ابتسم 😊 لأن تجارتك ماشية صح وبإذن الله تزيد!',
      'اللحظة هذي بداية شي جميل، استعد! 🎁',
      'ربي يجعل كل يوم عندك أجمل من اللي قبله 🌸',
      'تفاءل بالخير تجده، وأنت مليان خير ما شاء الله 🌿',
      'اليوم بداية رحلة جميلة من النجاح والإنجاز ✈️',

      // ═══════ حكم تجارية ملهمة ═══════
      'العميل الأول هو أساس المليون، قدره واحترمه 👑',
      'أفضل استثمار هو في سمعتك، حافظ عليها! 💎',
      'التاجر الذكي يتعلم من كل طلب شي جديد 🧠',
      'سر النجاح: اسمع لعميلك أكثر مما تتكلم 👂',
      'الثقة تُبنى بطلب، والسمعة تُبنى بألف طلب 🏗️',
      'أفضل تسويق هو عميل راضي يتكلم عنك 📢',
      'التميز مو خيار، التميز هو الطريق الوحيد للبقاء 🦅',
      'القيمة اللي تقدمها لعميلك هي اللي ترجع لك أضعاف 🔄',
      'التاجر الناجح يخدم عميله كأنه ضيف عزيز 🫖',
      'الاستمرارية أهم من الكمال، واصل حتى لو مو مثالي 🎯',
    ];

    return defaults[Math.floor(Math.random() * defaults.length)];
  }

  /**
   * استخراج المتغيرات من بيانات الحدث
   */
  private extractVariables(
    data: Record<string, unknown>,
    _context: EventContext,
  ): TemplateVariables {
    const now = new Date();

    const baseUrl = this.configService.get<string>('app.frontendUrl', 'https://rafeq.ai');

    // ✅ رابط الطلب الفعلي من بيانات سلة (urls.admin) أو بناء الرابط
    const urls = (data.urls || {}) as Record<string, unknown>;
    const orderAdminUrl = urls.admin || urls.customer || null;

    return {
      // بيانات الطلب
      '{رقم_الطلب}': this.safeGet(data, 'reference_id') || this.safeGet(data, 'order_number') || this.safeGet(data, 'id') || this.safeGet(data, 'order_id'),
      '{مبلغ_الطلب}': this.formatAmountValue(data.total || this.safeGet(data, 'amounts.total.amount')),
      '{حالة_الطلب}': this.safeGet(data, 'status.name') || this.safeGet(data, 'status'),
      '{طريقة_الدفع}': this.safeGet(data, 'payment_method'),
      '{رابط_الطلب}': orderAdminUrl ? String(orderAdminUrl) : `${baseUrl}/dashboard/orders/${this.safeGet(data, 'id') || ''}`,

      // بيانات العميل
      '{اسم_العميل}':
        [this.safeGet(data, 'customer.first_name'), this.safeGet(data, 'customer.last_name')]
          .filter(Boolean)
          .join(' ') || this.safeGet(data, 'customer.name') || '',
      '{هاتف_العميل}': this.safeGet(data, 'customer.mobile') || this.safeGet(data, 'customer.phone'),

      // بيانات المنتج
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
        return true;
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
        'مرحباً فريق {اسم_المتجر}، تم استلام طلب جديد رقم {رقم_الطلب} من العميل {اسم_العميل} بمبلغ {مبلغ_الطلب} ر.س',
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
