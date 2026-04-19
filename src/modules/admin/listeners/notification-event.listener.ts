import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotificationService } from '../services/notification.service';
import { TriggerEvent, MessageLanguage } from '../entities/message-template.entity';

// ─── Event Payloads ───────────────────────────────────────────────────────────

export interface UserCreatedPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  tempPassword?: string;
  tenantId: string;
}

export interface SubscriptionExpiringPayload {
  tenantId: string;
  userId: string;
  email: string;
  phone?: string;
  planName: string;
  expiryDate: string;
}

export interface AccountSuspendedPayload {
  userId: string;
  email: string;
  phone?: string;
  reason?: string;
  tenantId?: string;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

@Injectable()
export class NotificationEventListener {
  private readonly logger = new Logger(NotificationEventListener.name);

  constructor(
    private readonly notificationService: NotificationService,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent('user.created')
  async handleUserCreated(payload: UserCreatedPayload) {
    this.logger.log(`[user.created] Sending welcome message to ${payload.email}`);

    if (!payload.phone) return;

    await this.notificationService.sendByTriggerEvent(
      TriggerEvent.NEW_MERCHANT_REGISTERED,
      payload.phone,
      {
        merchant_name: payload.firstName,
        email: payload.email,
        temporary_password: payload.tempPassword || '(check email)',
        login_url: process.env.FRONTEND_URL || 'https://app.rafeq.ai/auth/login',
      },
      {
        recipientUserId: payload.userId,
        recipientEmail: payload.email,
        tenantId: payload.tenantId,
      },
    );
  }

  @OnEvent('account.suspended')
  async handleAccountSuspended(payload: AccountSuspendedPayload) {
    this.logger.log(`[account.suspended] Notifying ${payload.email}`);

    if (!payload.phone) return;

    await this.notificationService.sendByTriggerEvent(
      TriggerEvent.ACCOUNT_SUSPENDED,
      payload.phone,
      {
        merchant_name: payload.email.split('@')[0],
        email: payload.email,
      },
      { recipientEmail: payload.email, tenantId: payload.tenantId },
    );
  }

  @OnEvent('subscription.expiring')
  async handleSubscriptionExpiring(payload: SubscriptionExpiringPayload) {
    this.logger.log(`[subscription.expiring] Tenant ${payload.tenantId}`);

    if (!payload.phone) return;

    await this.notificationService.sendByTriggerEvent(
      TriggerEvent.SUBSCRIPTION_EXPIRING,
      payload.phone,
      {
        merchant_name: payload.email.split('@')[0],
        email: payload.email,
        plan_name: payload.planName,
        expiry_date: payload.expiryDate,
      },
      {
        recipientUserId: payload.userId,
        recipientEmail: payload.email,
        tenantId: payload.tenantId,
      },
    );
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(payload: {
    tenantId: string;
    userId: string;
    email: string;
    phone?: string;
    amount: string;
    planName: string;
  }) {
    if (!payload.phone) return;

    await this.notificationService.sendByTriggerEvent(
      TriggerEvent.PAYMENT_RECEIVED,
      payload.phone,
      {
        merchant_name: payload.email.split('@')[0],
        email: payload.email,
        payment_amount: payload.amount,
        plan_name: payload.planName,
      },
      { recipientUserId: payload.userId, tenantId: payload.tenantId },
    );
  }

  // ─── CRON: Daily subscription expiry check ─────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringSubscriptions() {
    this.logger.log('[CRON] Checking subscriptions expiring in 3 days...');

    const expiringSubs = await this.dataSource.query(`
      SELECT 
        s.tenant_id, s.current_period_end AS end_date,
        u.id as user_id, u.email, u.phone,
        sp.name as plan_name
      FROM subscriptions s
      JOIN subscription_plans sp ON sp.id = s.plan_id
      JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'owner'
      WHERE 
        s.status = 'active'
        AND s.current_period_end BETWEEN NOW() AND NOW() + INTERVAL '3 days'
    `);

    this.logger.log(`Found ${expiringSubs.length} expiring subscriptions`);

    for (const sub of expiringSubs) {
      if (!sub.phone) continue;

      await this.notificationService.sendByTriggerEvent(
        TriggerEvent.SUBSCRIPTION_EXPIRING,
        sub.phone,
        {
          merchant_name: sub.email.split('@')[0],
          email: sub.email,
          plan_name: sub.plan_name,
          expiry_date: new Date(sub.end_date).toLocaleDateString('ar-SA'),
        },
        { recipientUserId: sub.user_id, tenantId: sub.tenant_id },
      );
    }
  }

  // ─── WhatsApp Disconnect notifications ────────────────────────────────────
  // Triggered by Baileys when:
  //   • whatsapp.logged_out: user unlinked from their phone
  //   • whatsapp.session_replaced: another device took over the session
  //
  // Flow: channelId → store → tenant → OWNER user → user.phone
  // We use the merchant's personal phone (not the disconnected channel itself)
  // because the channel session is already gone.

  @OnEvent('whatsapp.logged_out', { async: true })
  async handleWhatsappLoggedOut(payload: { channelId: string }) {
    await this.notifyMerchantOfDisconnect(
      payload.channelId,
      'تم تسجيل الخروج من الجوال',
    );
  }

  @OnEvent('whatsapp.session_replaced', { async: true })
  async handleWhatsappSessionReplaced(payload: { channelId: string; message?: string }) {
    await this.notifyMerchantOfDisconnect(
      payload.channelId,
      'تم استبدال الجلسة بجهاز آخر',
    );
  }

  /**
   * Looks up the channel owner and sends a WhatsApp disconnect notification
   * to their personal phone (from users.phone).
   *
   * Defensive behaviour:
   *   • If channel not found → log + return (channel may have been deleted)
   *   • If tenant has no OWNER user → log + return
   *   • If owner has no phone → log + return (can't notify)
   *   • Any error → log + return (never propagate; must not break Baileys flow)
   */
  private async notifyMerchantOfDisconnect(
    channelId: string,
    reasonLabelAr: string,
  ): Promise<void> {
    try {
      // Look up channel → store → tenant owner in ONE query for efficiency
      const rows: Array<{
        channel_name: string;
        tenant_id: string;
        user_id: string;
        email: string;
        phone: string | null;
        first_name: string;
      }> = await this.dataSource.query(
        `SELECT
           ch.name                AS channel_name,
           s.tenant_id            AS tenant_id,
           u.id                   AS user_id,
           u.email                AS email,
           u.phone                AS phone,
           u.first_name           AS first_name
         FROM channels ch
         JOIN stores  s ON s.id = ch.store_id
         JOIN users   u ON u.tenant_id = s.tenant_id AND u.role = 'owner'
         WHERE ch.id = $1::uuid
         LIMIT 1`,
        [channelId],
      );

      if (rows.length === 0) {
        this.logger.warn(
          `[whatsapp.disconnect] No channel/owner found for channelId=${channelId} — skipping notification`,
        );
        return;
      }

      const row = rows[0];

      if (!row.phone) {
        this.logger.warn(
          `[whatsapp.disconnect] Owner of channel ${channelId} (tenant=${row.tenant_id}) has no phone — skipping notification`,
        );
        return;
      }

      // Default to Arabic — primary market (Saudi). Admin can create EN template
      // and manually toggle it per-merchant if needed (via merchant's profile in future).
      const lang = MessageLanguage.AR;
      const reasonLabel = reasonLabelAr;

      this.logger.log(
        `[whatsapp.disconnect] Notifying owner of channel ${channelId} (tenant=${row.tenant_id})`,
      );

      await this.notificationService.sendByTriggerEvent(
        TriggerEvent.WHATSAPP_DISCONNECTED,
        row.phone,
        {
          merchant_name: row.first_name || row.email.split('@')[0],
          email: row.email,
          channel_name: row.channel_name,
          reason_label: reasonLabel,
        },
        {
          recipientUserId: row.user_id,
          recipientEmail: row.email,
          tenantId: row.tenant_id,
          language: lang,
        },
      );
    } catch (err) {
      // NEVER propagate — Baileys flow must not break from a notification failure
      this.logger.error(
        `[whatsapp.disconnect] Failed to notify owner of channel ${channelId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
