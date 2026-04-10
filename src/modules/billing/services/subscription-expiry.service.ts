/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Subscription Expiry Service                         ║
 * ║                                                                                ║
 * ║  📌 مسؤول عن:                                                                  ║
 * ║  - فحص الاشتراكات المنتهية يومياً (Cron)                                       ║
 * ║  - إيقاف جميع المميزات عند انتهاء الاشتراك                                     ║
 * ║  - تحديث حالة التاجر إلى suspended                                             ║
 * ║  - إرسال إشعار انتهاء الاشتراك                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  Subscription,
  SubscriptionStatus,
} from '@database/entities/subscription.entity';

@Injectable()
export class SubscriptionExpiryService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionExpiryService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 🚀 يعمل تلقائياً عند تشغيل السيرفر
   * يفحص ويعالج كل الاشتراكات المنتهية فوراً بدون انتظار الكرون
   */
  async onModuleInit(): Promise<void> {
    // تأخير 10 ثواني لضمان جاهزية قاعدة البيانات
    setTimeout(() => {
      this.handleExpiredSubscriptions().catch(err => {
        this.logger.error(`❌ فشل فحص الاشتراكات عند بدء التشغيل: ${err}`);
      });
    }, 10000);
  }

  /**
   * ⏰ فحص الاشتراكات المنتهية - يعمل كل ساعة
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredSubscriptions(): Promise<void> {
    this.logger.log('🔍 بدء فحص الاشتراكات المنتهية...');

    const now = new Date();

    // 1. جلب الاشتراكات النشطة التي انتهت فترتها
    const expiredSubs = await this.subscriptionRepo
      .createQueryBuilder('s')
      .where('s.status IN (:...statuses)', {
        statuses: ['active', 'trialing', 'past_due'],
      })
      .andWhere('s.currentPeriodEnd < :now', { now })
      .andWhere('(s.autoRenew = false OR s.autoRenew IS NULL)')
      .getMany();

    // 2. أيضاً جلب الاشتراكات التي لها ends_at وانتهت
    const endedSubs = await this.subscriptionRepo
      .createQueryBuilder('s')
      .where('s.status IN (:...statuses)', {
        statuses: ['active', 'trialing', 'cancelling'],
      })
      .andWhere('s.endsAt IS NOT NULL AND s.endsAt < :now', { now })
      .getMany();

    // 3. جلب التاجرين الذين انتهى اشتراكهم عبر subscription_ends_at في tenants
    const expiredTenants = await this.dataSource.query(
      `SELECT t.id FROM tenants t
       WHERE t.subscription_ends_at IS NOT NULL 
       AND t.subscription_ends_at < $1 
       AND t.status != 'suspended'
       AND t.subscription_plan != 'free'
       AND t.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM subscriptions s 
         WHERE s.tenant_id = t.id 
         AND s.status IN ('active', 'trialing') 
         AND (s.auto_renew = true OR s.current_period_end > $1)
       )`,
      [now.toISOString()],
    );

    // 4. جلب تجار الباقة المجانية (غير تجريبي) الذين لديهم ميزات مفعلة يجب إيقافها
    const freeTenants = await this.dataSource.query(
      `SELECT t.id FROM tenants t
       WHERE (t.subscription_plan = 'free' OR t.subscription_plan IS NULL)
       AND t.status != 'trial'
       AND t.status != 'suspended'
       AND t.deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM otp_configs o WHERE o.tenant_id = t.id AND o.is_active = true)
         OR EXISTS (SELECT 1 FROM short_links s WHERE s.tenant_id = t.id AND s.is_active = true)
         OR EXISTS (SELECT 1 FROM message_templates m WHERE m.tenant_id = t.id AND m.status = 'active')
         OR EXISTS (SELECT 1 FROM automations a WHERE a.tenant_id = t.id AND a.status = 'active')
         OR EXISTS (SELECT 1 FROM campaigns c WHERE c.tenant_id = t.id AND c.status IN ('active', 'scheduled'))
       )`,
    );

    // دمج كل tenant IDs المنتهية
    const allExpiredTenantIds = new Set<string>();

    for (const sub of [...expiredSubs, ...endedSubs]) {
      allExpiredTenantIds.add(sub.tenantId);
    }
    for (const row of expiredTenants) {
      allExpiredTenantIds.add(row.id);
    }
    for (const row of freeTenants) {
      allExpiredTenantIds.add(row.id);
    }

    if (allExpiredTenantIds.size === 0) {
      this.logger.log('✅ لا توجد اشتراكات منتهية');
      return;
    }

    this.logger.log(`⚠️ تم اكتشاف ${allExpiredTenantIds.size} اشتراك منتهي`);

    for (const tenantId of allExpiredTenantIds) {
      try {
        await this.expireTenantSubscription(tenantId);
      } catch (error) {
        this.logger.error(
          `❌ فشل معالجة انتهاء اشتراك التاجر ${tenantId}: ${error}`,
        );
      }
    }

    this.logger.log(
      `✅ تم معالجة ${allExpiredTenantIds.size} اشتراك منتهي`,
    );
  }

  /**
   * 🔒 إيقاف جميع مميزات التاجر عند انتهاء الاشتراك
   */
  async expireTenantSubscription(tenantId: string): Promise<void> {
    // حماية من المعالجة المزدوجة
    const tenant = await this.dataSource.query(
      `SELECT status FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!tenant?.[0] || tenant[0].status === 'suspended') {
      this.logger.log(`⏭️ التاجر ${tenantId} موقوف مسبقاً — تخطي`);
      return;
    }

    this.logger.log(`🔒 إيقاف مميزات التاجر: ${tenantId}`);

    // 1. تحديث حالة الاشتراك → expired (أساسي — يجب أن ينجح)
    await this.subscriptionRepo
      .createQueryBuilder()
      .update(Subscription)
      .set({
        status: SubscriptionStatus.EXPIRED,
        endsAt: new Date(),
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status IN (:...s)', {
        s: ['active', 'trialing', 'past_due', 'cancelling'],
      })
      .execute();

    // 2. تحديث حالة التاجر → suspended + باقة free (أساسي)
    await this.dataSource.query(
      `UPDATE tenants 
       SET status = 'suspended', 
           subscription_plan = 'free', 
           monthly_message_limit = 0,
           updated_at = NOW() 
       WHERE id = $1`,
      [tenantId],
    );

    // 3–12: إيقاف كل ميزة بشكل مستقل — فشل أي واحدة لا يوقف البقية
    // ⚠️ القنوات (WhatsApp) لا تُفصل — الاتصال يبقى لكن الإرسال محظور عبر subscription guard
    const deactivations: { name: string; sql: string }[] = [
      {
        name: 'القوالب',
        sql: `UPDATE message_templates SET status = 'disabled', updated_at = NOW() WHERE tenant_id = $1 AND status IN ('active', 'approved', 'draft')`,
      },
      {
        name: 'الأتمتة',
        sql: `UPDATE automations SET status = 'inactive', updated_at = NOW() WHERE tenant_id = $1 AND status = 'active'`,
      },
      {
        name: 'الحملات',
        sql: `UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE tenant_id = $1 AND status IN ('active', 'scheduled')`,
      },
      {
        name: 'الإرسال المجدول',
        sql: `UPDATE scheduled_template_sends SET status = 'cancelled', updated_at = NOW() WHERE tenant_id = $1 AND status = 'pending'`,
      },
      {
        name: 'روابط OTP',
        sql: `UPDATE otp_configs SET is_active = false, updated_at = NOW() WHERE tenant_id = $1 AND is_active = true`,
      },
      {
        name: 'الروابط المختصرة',
        sql: `UPDATE short_links SET is_active = false, updated_at = NOW() WHERE tenant_id = $1 AND is_active = true`,
      },
      {
        name: 'ويدجت الدردشة',
        sql: `UPDATE widget_settings SET is_enabled = false, updated_at = NOW() WHERE tenant_id = $1 AND is_enabled = true`,
      },
      {
        name: 'قاعدة المعرفة AI',
        sql: `UPDATE knowledge_base SET is_active = false, updated_at = NOW() WHERE tenant_id = $1 AND is_active = true`,
      },
      {
        name: 'إشعارات الموظفين',
        sql: `UPDATE notification_rules SET "isActive" = false WHERE "tenantId" = $1 AND "isActive" = true`,
      },
      {
        name: 'عناصر التحويل',
        sql: `UPDATE conversion_elements SET status = 'paused', updated_at = NOW() WHERE tenant_id = $1 AND status = 'active'`,
      },
    ];

    for (const task of deactivations) {
      try {
        await this.dataSource.query(task.sql, [tenantId]);
      } catch (error) {
        // فشل إيقاف ميزة واحدة لا يوقف باقي العملية
        this.logger.warn(`⚠️ فشل إيقاف ${task.name} للتاجر ${tenantId}: ${error instanceof Error ? error.message : error}`);
      }
    }

    // 13. إرسال event لإشعار الأنظمة الأخرى
    this.eventEmitter.emit('subscription.expired', {
      tenantId,
      expiredAt: new Date(),
      reason: 'subscription_period_ended',
    });

    this.logger.log(
      `✅ تم إيقاف جميع مميزات التاجر ${tenantId} بسبب انتهاء الاشتراك`,
    );
  }

  /**
   * 📊 فحص حالة اشتراك تاجر معين
   * يُستخدم عند تسجيل الدخول لعرض رسالة الانتهاء
   */
  async checkTenantSubscriptionStatus(tenantId: string): Promise<{
    isExpired: boolean;
    isSuspended: boolean;
    isExpiringSoon: boolean;
    daysRemaining: number | null;
    expiredAt: Date | null;
    message: string | null;
    disabledFeatures: string[];
  }> {
    // فحص حالة التاجر
    const tenant = await this.dataSource.query(
      `SELECT id, status, subscription_plan, subscription_ends_at 
       FROM tenants WHERE id = $1`,
      [tenantId],
    );

    if (!tenant || tenant.length === 0) {
      return {
        isExpired: false,
        isSuspended: false,
        isExpiringSoon: false,
        daysRemaining: null,
        expiredAt: null,
        message: null,
        disabledFeatures: [],
      };
    }

    const t = tenant[0];
    const isSuspended = t.status === 'suspended';
    const isFreePlan =
      t.subscription_plan === 'free' || !t.subscription_plan;
    const isTrial = t.status === 'trial';
    const subscriptionEndsAt = t.subscription_ends_at
      ? new Date(t.subscription_ends_at)
      : null;
    const now = new Date();

    // بدون اشتراك = free plan وليس تجريبي
    const hasNoSubscription = isFreePlan && !isTrial;

    const isExpired =
      isSuspended ||
      hasNoSubscription ||
      (subscriptionEndsAt !== null && subscriptionEndsAt < now && !isFreePlan);

    // حساب الأيام المتبقية
    let daysRemaining: number | null = null;
    if (subscriptionEndsAt && !isFreePlan) {
      daysRemaining = Math.ceil((subscriptionEndsAt.getTime() - now.getTime()) / 86400000);
    }

    // تحذير: باقي 3 أيام أو أقل على انتهاء الاشتراك
    const isExpiringSoon = !isExpired && !isSuspended && daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 3;

    if (!isExpired && !isSuspended && !isExpiringSoon) {
      return {
        isExpired: false,
        isSuspended: false,
        isExpiringSoon: false,
        daysRemaining,
        expiredAt: null,
        message: null,
        disabledFeatures: [],
      };
    }

    // حالة: اشتراك على وشك الانتهاء
    if (isExpiringSoon) {
      const dayWord = daysRemaining === 0 ? 'اليوم' :
        daysRemaining === 1 ? 'غداً' :
        `خلال ${daysRemaining} أيام`;
      return {
        isExpired: false,
        isSuspended: false,
        isExpiringSoon: true,
        daysRemaining,
        expiredAt: subscriptionEndsAt,
        message: `⚠️ ينتهي اشتراكك ${dayWord}. يرجى التجديد لتجنب إيقاف الخدمات.`,
        disabledFeatures: [],
      };
    }

    // جلب المميزات المعطلة
    const disabledFeatures: string[] = [];

    // helper: safe count query — returns 0 if table/column doesn't exist
    const safeCount = async (sql: string): Promise<number> => {
      try {
        const r = await this.dataSource.query(sql, [tenantId]);
        return parseInt(r[0]?.count) || 0;
      } catch {
        return 0;
      }
    };

    const [
      automationsCount, campaignsCount, otpCount,
      linksCount, widgetsCount, kbCount, rulesCount, templatesCount,
    ] = await Promise.all([
      safeCount(`SELECT COUNT(*) as count FROM automations WHERE tenant_id = $1 AND status = 'inactive'`),
      safeCount(`SELECT COUNT(*) as count FROM campaigns WHERE tenant_id = $1 AND status = 'paused'`),
      safeCount(`SELECT COUNT(*) as count FROM otp_configs WHERE tenant_id = $1 AND is_active = false`),
      safeCount(`SELECT COUNT(*) as count FROM short_links WHERE tenant_id = $1 AND is_active = false`),
      safeCount(`SELECT COUNT(*) as count FROM widget_settings WHERE tenant_id = $1 AND is_enabled = false`),
      safeCount(`SELECT COUNT(*) as count FROM knowledge_base WHERE tenant_id = $1 AND is_active = false`),
      safeCount(`SELECT COUNT(*) as count FROM notification_rules WHERE "tenantId" = $1 AND "isActive" = false`),
      safeCount(`SELECT COUNT(*) as count FROM message_templates WHERE tenant_id = $1 AND status = 'disabled'`),
    ]);

    if (automationsCount > 0) disabledFeatures.push(`${automationsCount} أتمتة معطلة`);
    if (campaignsCount > 0) disabledFeatures.push(`${campaignsCount} حملة متوقفة`);
    if (otpCount > 0) disabledFeatures.push(`${otpCount} رابط OTP معطل`);
    if (linksCount > 0) disabledFeatures.push(`${linksCount} رابط مختصر معطل`);
    if (widgetsCount > 0) disabledFeatures.push('ويدجت الدردشة معطل');
    if (kbCount > 0) disabledFeatures.push('قاعدة المعرفة AI معطلة');
    if (rulesCount > 0) disabledFeatures.push(`${rulesCount} قاعدة إشعارات معطلة`);
    if (templatesCount > 0) disabledFeatures.push(`${templatesCount} قالب رسائل معطل`);

    return {
      isExpired: true,
      isSuspended,
      isExpiringSoon: false,
      daysRemaining,
      expiredAt: subscriptionEndsAt,
      message: hasNoSubscription
        ? 'لا يوجد اشتراك نشط. يرجى الاشتراك في إحدى الباقات لتفعيل جميع الخدمات.'
        : 'انتهى اشتراكك في رفيق. تم إيقاف جميع المميزات تلقائياً. يرجى تجديد اشتراكك لاستعادة جميع الخدمات.',
      disabledFeatures,
    };
  }
}
