/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              Audit Event Listener — Event-Driven Audit Logging               ║
 * ║                                                                               ║
 * ║  يستمع لأحداث النظام ويسجّلها في audit_logs تلقائياً                           ║
 * ║  بدون أي circular dependencies — كل service يطلق event والـ listener يسجّل   ║
 * ║  Fire-and-forget — لا يبلوك أي عملية                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditService } from '../services/audit.service';
import { AuditAction } from '../entities/audit-log.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Event Payload Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuditLoginFailedEvent {
  email: string;
  reason: 'wrong_password' | 'user_not_found' | 'account_locked' | 'account_inactive' | 'no_password' | 'oauth_failed';
  ipAddress: string;
  userAgent: string;
  attemptsRemaining?: number;
}

export interface AuditWhatsAppEvent {
  channelId: string;
  tenantId?: string;
  to: string;
  messageType: 'text' | 'image' | 'document';
  messageId?: string;
  error?: string;
  durationMs?: number;
}

export interface AuditWebhookEvent {
  platform: 'salla' | 'zid';
  event: string;
  merchantId?: string | number;
  storeId?: string;
  tenantId?: string;
  deliveryId?: string;
  durationMs?: number;
  error?: string;
  signatureValid?: boolean;
}

export interface AuditWhatsAppSessionEvent {
  channelId: string;
  tenantId?: string;
  phoneNumber?: string;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Listener
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AuditEventListener {
  private readonly logger = new Logger('AuditEvents');

  // ── System Actor UUIDs (valid UUIDs for non-user actors) ──
  private static readonly ACTOR_ANONYMOUS = '00000000-0000-0000-0000-000000000000';
  private static readonly ACTOR_SYSTEM    = '00000000-0000-0000-0000-000000000001';
  private static readonly ACTOR_WEBHOOK   = '00000000-0000-0000-0000-000000000002';

  constructor(private readonly auditService: AuditService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // 🔐 Security Events
  // ─────────────────────────────────────────────────────────────────────────

  @OnEvent('audit.login.failed', { async: true })
  async onLoginFailed(data: AuditLoginFailedEvent): Promise<void> {
    try {
      const action = data.reason === 'account_locked'
        ? AuditAction.SECURITY_ACCOUNT_LOCKED
        : AuditAction.SECURITY_LOGIN_FAILED;

      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_ANONYMOUS,
        actorEmail: data.email,
        actorRole: 'anonymous',
        tenantId: undefined,
        action,
        targetType: 'security',
        metadata: {
          reason: data.reason,
          attemptsRemaining: data.attemptsRemaining,
        },
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log login failure: ${e?.message}`);
    }
  }

  @OnEvent('audit.password.reset_requested', { async: true })
  async onPasswordResetRequested(data: { email: string; ipAddress: string; userAgent: string }): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_ANONYMOUS,
        actorEmail: data.email,
        actorRole: 'anonymous',
        tenantId: undefined,
        action: AuditAction.SECURITY_PASSWORD_RESET_REQUESTED,
        targetType: 'security',
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log password reset request: ${e?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 💬 WhatsApp Message Events
  // ─────────────────────────────────────────────────────────────────────────

  @OnEvent('audit.whatsapp.sent', { async: true })
  async onWhatsAppSent(data: AuditWhatsAppEvent): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_SYSTEM,
        actorEmail: 'system',
        actorRole: 'system',
        tenantId: data.tenantId || undefined,
        action: AuditAction.WHATSAPP_MESSAGE_SENT,
        targetType: 'whatsapp',
        targetId: data.messageId,
        metadata: {
          channelId: data.channelId,
          to: this.maskPhone(data.to),
          messageType: data.messageType,
          durationMs: data.durationMs,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log WhatsApp send: ${e?.message}`);
    }
  }

  @OnEvent('audit.whatsapp.failed', { async: true })
  async onWhatsAppFailed(data: AuditWhatsAppEvent): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_SYSTEM,
        actorEmail: 'system',
        actorRole: 'system',
        tenantId: data.tenantId || undefined,
        action: AuditAction.WHATSAPP_MESSAGE_FAILED,
        targetType: 'whatsapp',
        metadata: {
          channelId: data.channelId,
          to: this.maskPhone(data.to),
          messageType: data.messageType,
          error: data.error?.slice(0, 200),
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log WhatsApp failure: ${e?.message}`);
    }
  }

  @OnEvent('audit.whatsapp.session_connected', { async: true })
  async onWhatsAppConnected(data: AuditWhatsAppSessionEvent): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_SYSTEM,
        actorEmail: 'system',
        actorRole: 'system',
        tenantId: data.tenantId || undefined,
        action: AuditAction.WHATSAPP_SESSION_CONNECTED,
        targetType: 'whatsapp',
        targetId: data.channelId,
        metadata: {
          phoneNumber: data.phoneNumber ? this.maskPhone(data.phoneNumber) : undefined,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log WhatsApp connect: ${e?.message}`);
    }
  }

  @OnEvent('audit.whatsapp.session_disconnected', { async: true })
  async onWhatsAppDisconnected(data: AuditWhatsAppSessionEvent): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_SYSTEM,
        actorEmail: 'system',
        actorRole: 'system',
        tenantId: data.tenantId || undefined,
        action: AuditAction.WHATSAPP_SESSION_DISCONNECTED,
        targetType: 'whatsapp',
        targetId: data.channelId,
        metadata: { reason: data.reason },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log WhatsApp disconnect: ${e?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🔔 Webhook Events
  // ─────────────────────────────────────────────────────────────────────────

  @OnEvent('audit.webhook.received', { async: true })
  async onWebhookReceived(data: AuditWebhookEvent): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_WEBHOOK,
        actorEmail: `${data.platform}@webhook`,
        actorRole: 'webhook',
        tenantId: data.tenantId || undefined,
        storeName: data.storeId,
        action: AuditAction.WEBHOOK_RECEIVED,
        targetType: 'webhook',
        targetId: data.deliveryId,
        metadata: {
          platform: data.platform,
          event: data.event,
          merchantId: data.merchantId,
          durationMs: data.durationMs,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log webhook: ${e?.message}`);
    }
  }

  @OnEvent('audit.webhook.failed', { async: true })
  async onWebhookFailed(data: AuditWebhookEvent): Promise<void> {
    try {
      await this.auditService.logTenant({
        actorId: AuditEventListener.ACTOR_WEBHOOK,
        actorEmail: `${data.platform}@webhook`,
        actorRole: 'webhook',
        tenantId: data.tenantId || undefined,
        action: data.signatureValid === false
          ? AuditAction.WEBHOOK_SIGNATURE_INVALID
          : AuditAction.WEBHOOK_FAILED,
        targetType: 'webhook',
        targetId: data.deliveryId,
        metadata: {
          platform: data.platform,
          event: data.event,
          merchantId: data.merchantId,
          error: data.error?.slice(0, 200),
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log webhook failure: ${e?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 6) return '***';
    return '***' + phone.slice(-4);
  }
}
