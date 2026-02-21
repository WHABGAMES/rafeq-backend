import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotificationService } from '../services/notification.service';
import { TriggerEvent } from '../entities/message-template.entity';

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
      { recipientEmail: payload.email },
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
      { recipientUserId: payload.userId },
    );
  }

  // ─── CRON: Daily subscription expiry check ─────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringSubscriptions() {
    this.logger.log('[CRON] Checking subscriptions expiring in 3 days...');

    const expiringSubs = await this.dataSource.query(`
      SELECT 
        s.tenant_id, s.end_date,
        u.id as user_id, u.email, u.phone,
        sp.name as plan_name
      FROM subscriptions s
      JOIN subscription_plans sp ON sp.id = s.plan_id
      JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'owner'
      WHERE 
        s.status = 'active'
        AND s.end_date BETWEEN NOW() AND NOW() + INTERVAL '3 days'
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
        { recipientUserId: sub.user_id },
      );
    }
  }
}
