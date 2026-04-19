/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  AdminAlertsListener                                                     ║
 * ║                                                                          ║
 * ║  Captures platform events and dispatches them to subscribed admin        ║
 * ║  recipients via AdminAlertsService.                                      ║
 * ║                                                                          ║
 * ║  Events handled:                                                         ║
 * ║   • user.created              — new merchant registered                  ║
 * ║   • auth.login.new_device     — login from unseen IP/device              ║
 * ║   • auth.login.failed         — brute-force attempt (3+ failures)        ║
 * ║   • store.connected           — Salla/Zid/Shopify connected              ║
 * ║   • subscription.created      — upgrade from free plan                   ║
 * ║   • subscription.cancelled    — cancellation                             ║
 * ║                                                                          ║
 * ║  Design notes:                                                           ║
 * ║   • All handlers use { async: true } — non-blocking wrt event source     ║
 * ║   • All handlers catch their own errors (never propagate)                ║
 * ║   • Rate limiting for auth.login.failed: only send after 3+ attempts     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdminAlertsService } from '../services/admin-alerts.service';

// ─── Event payload shapes (loose typing for robustness) ────────────────────

interface UserCreatedPayload {
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  tenantId?: string;
  [key: string]: unknown;
}

interface LoginNewDevicePayload {
  userId?: string;
  email?: string;
  firstName?: string;
  ipAddress?: string;
  userAgent?: string;
  tenantId?: string;
  [key: string]: unknown;
}

interface LoginFailedPayload {
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  attempts?: number;
  [key: string]: unknown;
}

interface StoreConnectedPayload {
  platform?: string;      // 'salla' | 'zid' | 'shopify'
  storeName?: string;
  storeId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

interface SubscriptionEventPayload {
  tenantId?: string;
  userId?: string;
  email?: string;
  planName?: string;
  plan?: string;
  amount?: string | number;
  reason?: string;
  [key: string]: unknown;
}

@Injectable()
export class AdminAlertsListener {
  private readonly logger = new Logger(AdminAlertsListener.name);

  constructor(private readonly alertsService: AdminAlertsService) {}

  // ─── user.created ────────────────────────────────────────────────────────
  @OnEvent('user.created', { async: true })
  async onUserCreated(payload: UserCreatedPayload): Promise<void> {
    try {
      await this.alertsService.dispatchEvent('user.created', payload);
    } catch (err) {
      this.logger.error(
        `onUserCreated dispatch failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── auth.login.new_device ───────────────────────────────────────────────
  @OnEvent('auth.login.new_device', { async: true })
  async onLoginNewDevice(payload: LoginNewDevicePayload): Promise<void> {
    try {
      await this.alertsService.dispatchEvent('auth.login.new_device', payload);
    } catch (err) {
      this.logger.error(
        `onLoginNewDevice dispatch failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── auth.login.multiple_failures (dedicated event from auth.service) ────
  // The auth service emits this AFTER the 3-attempts threshold is reached,
  // so no filtering needed here.
  @OnEvent('auth.login.multiple_failures', { async: true })
  async onLoginMultipleFailures(payload: LoginFailedPayload): Promise<void> {
    try {
      await this.alertsService.dispatchEvent('auth.login.multiple_failures', payload);
    } catch (err) {
      this.logger.error(
        `onLoginMultipleFailures dispatch failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── store.connected ─────────────────────────────────────────────────────
  @OnEvent('store.connected', { async: true })
  async onStoreConnected(payload: StoreConnectedPayload): Promise<void> {
    try {
      await this.alertsService.dispatchEvent('store.connected', payload);
    } catch (err) {
      this.logger.error(
        `onStoreConnected dispatch failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── subscription.created ────────────────────────────────────────────────
  @OnEvent('subscription.created', { async: true })
  async onSubscriptionCreated(payload: SubscriptionEventPayload): Promise<void> {
    try {
      await this.alertsService.dispatchEvent('subscription.created', payload);
    } catch (err) {
      this.logger.error(
        `onSubscriptionCreated dispatch failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── subscription.cancelled ──────────────────────────────────────────────
  @OnEvent('subscription.cancelled', { async: true })
  async onSubscriptionCancelled(payload: SubscriptionEventPayload): Promise<void> {
    try {
      await this.alertsService.dispatchEvent('subscription.cancelled', payload);
    } catch (err) {
      this.logger.error(
        `onSubscriptionCancelled dispatch failed: ${(err as Error).message}`,
      );
    }
  }
}
