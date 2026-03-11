/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║      RAFIQ PLATFORM - Subscription Webhook Event Listener                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { SubscriptionManagementService } from '../services/subscription-management.service';

interface WebhookPayload {
  tenantId?: string;
  storeId?: string;
  merchant?: number;
  raw?: Record<string, unknown>;
}

@Injectable()
export class SubscriptionWebhookListener {
  private readonly logger = new Logger(SubscriptionWebhookListener.name);

  constructor(
    private readonly subscriptionService: SubscriptionManagementService,
  ) {}

  // ─── سلة: تثبيت التطبيق → تفعيل basic ──────────────────────────────────

  @OnEvent('app.installed')
  async handleAppInstalled(payload: WebhookPayload): Promise<void> {
    if (!payload.tenantId) return;
    this.logger.log(`🎉 app.installed → basic for ${payload.tenantId}`);
    await this.safeHandle(() =>
      this.subscriptionService.handleWebhookSubscription({
        tenantId: payload.tenantId!, storeId: payload.storeId || '',
        platform: 'salla', event: 'subscribe', planSlug: 'basic',
      }),
    );
  }

  // ─── سلة: إلغاء تثبيت → إلغاء الاشتراك ──────────────────────────────

  @OnEvent('app.uninstalled')
  async handleAppUninstalled(payload: WebhookPayload): Promise<void> {
    if (!payload.tenantId) return;
    this.logger.log(`⚠️ app.uninstalled → deactivate ${payload.tenantId}`);
    await this.safeHandle(() =>
      this.subscriptionService.handleWebhookSubscription({
        tenantId: payload.tenantId!, storeId: payload.storeId || '',
        platform: 'salla', event: 'unsubscribe', planSlug: '',
      }),
    );
  }

  // ─── سلة: أحداث الاشتراك ──────────────────────────────────────────────

  @OnEvent('app.subscription.created')
  async onSallaSubCreated(p: WebhookPayload) { await this.processSalla(p, 'subscribe'); }

  @OnEvent('app.subscription.renewed')
  async onSallaSubRenewed(p: WebhookPayload) { await this.processSalla(p, 'renew'); }

  @OnEvent('app.subscription.upgraded')
  async onSallaSubUpgraded(p: WebhookPayload) { await this.processSalla(p, 'upgrade'); }

  @OnEvent('app.subscription.cancelled')
  async onSallaSubCancelled(p: WebhookPayload): Promise<void> {
    if (!p.tenantId) return;
    await this.safeHandle(() =>
      this.subscriptionService.handleWebhookSubscription({
        tenantId: p.tenantId!, storeId: p.storeId || '',
        platform: 'salla', event: 'unsubscribe', planSlug: '',
      }),
    );
  }

  // ─── زد: أحداث الاشتراك ──────────────────────────────────────────────

  @OnEvent('zid.subscription.created')
  async onZidSubCreated(p: WebhookPayload) { await this.processZid(p, 'subscribe'); }

  @OnEvent('zid.subscription.renewed')
  async onZidSubRenewed(p: WebhookPayload) { await this.processZid(p, 'renew'); }

  @OnEvent('zid.subscription.upgraded')
  async onZidSubUpgraded(p: WebhookPayload) { await this.processZid(p, 'upgrade'); }

  @OnEvent('zid.subscription.cancelled')
  async onZidSubCancelled(p: WebhookPayload): Promise<void> {
    if (!p.tenantId) return;
    await this.safeHandle(() =>
      this.subscriptionService.handleWebhookSubscription({
        tenantId: p.tenantId!, storeId: p.storeId || '',
        platform: 'zid', event: 'unsubscribe', planSlug: '',
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async processSalla(p: WebhookPayload, event: 'subscribe' | 'upgrade' | 'renew') {
    if (!p.tenantId) return;
    const planSlug = this.extractPlanSlug(p.raw || {});
    this.logger.log(`📥 salla.${event}: ${p.tenantId} plan=${planSlug}`);
    await this.safeHandle(() =>
      this.subscriptionService.handleWebhookSubscription({
        tenantId: p.tenantId!, storeId: p.storeId || '',
        platform: 'salla', event, planSlug,
        externalSubscriptionId: String(p.raw?.subscription_id || p.raw?.id || ''),
        endDate: String(p.raw?.end_date || p.raw?.ends_at || ''),
      }),
    );
  }

  private async processZid(p: WebhookPayload, event: 'subscribe' | 'upgrade' | 'renew') {
    if (!p.tenantId) return;
    const planSlug = this.extractPlanSlug(p.raw || {});
    await this.safeHandle(() =>
      this.subscriptionService.handleWebhookSubscription({
        tenantId: p.tenantId!, storeId: p.storeId || '',
        platform: 'zid', event, planSlug,
        externalSubscriptionId: String(p.raw?.subscription_id || p.raw?.id || ''),
        endDate: String(p.raw?.end_date || p.raw?.ends_at || ''),
      }),
    );
  }

  private extractPlanSlug(raw: Record<string, unknown>): string {
    const plan = raw.plan as Record<string, unknown> | undefined;
    if (plan) return String(plan.slug || plan.name || 'basic');
    const pkg = raw.package as Record<string, unknown> | undefined;
    if (pkg) return String(pkg.slug || pkg.name || 'basic');
    return String(raw.plan_slug || raw.package_slug || raw.plan_name || 'basic');
  }

  private async safeHandle(fn: () => Promise<void>): Promise<void> {
    try { await fn(); }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      this.logger.error(`❌ Webhook subscription handler failed: ${msg}`);
    }
  }
}
