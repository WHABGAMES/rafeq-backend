/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Payment Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  🔧 FIX C-05: Full signature verification for Stripe + Moyasar                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';

@ApiTags('Billing - Webhooks')
@Controller({
  path: 'billing/webhooks',
  version: '1',
})
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly stripeWebhookSecret: string;
  private readonly moyasarSecretKey: string;

  constructor(private readonly configService: ConfigService) {
    this.stripeWebhookSecret = this.configService.get<string>('billing.stripe.webhookSecret', '');
    this.moyasarSecretKey = this.configService.get<string>('billing.moyasar.secretKey', '');

    if (!this.stripeWebhookSecret) {
      this.logger.warn('⚠️ STRIPE_WEBHOOK_SECRET not configured — Stripe webhooks will be rejected');
    }
    if (!this.moyasarSecretKey) {
      this.logger.warn('⚠️ MOYASAR_SECRET_KEY not configured — Moyasar webhooks will be rejected');
    }
  }

  /**
   * 🔧 FIX C-05: Stripe Webhook with signature verification
   * Uses Stripe's standard HMAC-SHA256 signature scheme
   */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    // Verify signature is present
    if (!signature) {
      this.logger.error('🚨 Stripe webhook: Missing signature header');
      throw new ForbiddenException('Missing stripe-signature header');
    }

    // Verify webhook secret is configured
    if (!this.stripeWebhookSecret) {
      this.logger.error('🚨 Stripe webhook: STRIPE_WEBHOOK_SECRET not configured');
      throw new BadRequestException('Webhook verification not configured');
    }

    // Verify the signature
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('🚨 Stripe webhook: No raw body available');
      throw new BadRequestException('Raw body required for signature verification');
    }

    const event = this.verifyStripeSignature(rawBody, signature);
    if (!event) {
      this.logger.error('🚨 Stripe webhook: Invalid signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    this.logger.log(`✅ Stripe webhook verified: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data?.object);
        break;
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data?.object);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data?.object);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data?.object);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * 🔧 FIX C-05: Moyasar Webhook with signature verification
   * Uses Moyasar's HMAC-SHA256 signature scheme
   */
  @Post('moyasar')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleMoyasarWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-moyasar-signature') signature: string,
  ) {
    if (!signature) {
      this.logger.error('🚨 Moyasar webhook: Missing signature header');
      throw new ForbiddenException('Missing x-moyasar-signature header');
    }

    if (!this.moyasarSecretKey) {
      this.logger.error('🚨 Moyasar webhook: Secret key not configured');
      throw new BadRequestException('Webhook verification not configured');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw body required for signature verification');
    }

    // Verify Moyasar signature
    if (!this.verifyMoyasarSignature(rawBody, signature)) {
      this.logger.error('🚨 Moyasar webhook: Invalid signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString());
    this.logger.log(`✅ Moyasar webhook verified: ${payload?.type}`);

    switch (payload?.type) {
      case 'payment_paid':
        await this.handleMoyasarPaymentPaid(payload);
        break;
      case 'payment_failed':
        await this.handleMoyasarPaymentFailed(payload);
        break;
      default:
        this.logger.debug(`Unhandled Moyasar event: ${payload?.type}`);
    }

    return { received: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Signature Verification
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Verify Stripe webhook signature using their standard scheme:
   * signature header format: t=timestamp,v1=hash
   */
  private verifyStripeSignature(
    rawBody: Buffer,
    signatureHeader: string,
  ): Record<string, unknown> | null {
    try {
      const elements = signatureHeader.split(',');
      const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
      const signature = elements.find(e => e.startsWith('v1='))?.slice(3);

      if (!timestamp || !signature) {
        this.logger.warn('Invalid Stripe signature format');
        return null;
      }

      // Check timestamp tolerance (5 minutes)
      const TOLERANCE_SECONDS = 300;
      const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
      if (Math.abs(timestampAge) > TOLERANCE_SECONDS) {
        this.logger.warn(`Stripe webhook timestamp too old: ${timestampAge}s`);
        return null;
      }

      // Compute expected signature
      const signedPayload = `${timestamp}.${rawBody.toString()}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.stripeWebhookSecret)
        .update(signedPayload)
        .digest('hex');

      // Timing-safe comparison
      if (signature.length !== expectedSignature.length) return null;
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      if (!isValid) return null;

      return JSON.parse(rawBody.toString());
    } catch (error) {
      this.logger.error('Stripe signature verification error:', error);
      return null;
    }
  }

  /**
   * Verify Moyasar webhook signature (HMAC-SHA256)
   */
  private verifyMoyasarSignature(rawBody: Buffer, signature: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.moyasarSecretKey)
        .update(rawBody)
        .digest('hex');

      if (signature.length !== expectedSignature.length) return false;

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error('Moyasar signature verification error:', error);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 Event Handlers (implement your business logic here)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
    this.logger.log('Processing checkout.session.completed');
    // TODO: Activate subscription, update billing records
  }

  private async handleInvoicePaymentSucceeded(invoice: Record<string, unknown>): Promise<void> {
    this.logger.log('Processing invoice.payment_succeeded');
    // TODO: Extend subscription period
  }

  private async handleInvoicePaymentFailed(invoice: Record<string, unknown>): Promise<void> {
    this.logger.log('Processing invoice.payment_failed');
    // TODO: Notify user, mark subscription at risk
  }

  private async handleSubscriptionDeleted(subscription: Record<string, unknown>): Promise<void> {
    this.logger.log('Processing customer.subscription.deleted');
    // TODO: Downgrade to free plan, notify user
  }

  private async handleMoyasarPaymentPaid(payload: Record<string, unknown>): Promise<void> {
    this.logger.log('Processing Moyasar payment_paid');
    // TODO: Activate subscription
  }

  private async handleMoyasarPaymentFailed(payload: Record<string, unknown>): Promise<void> {
    this.logger.log('Processing Moyasar payment_failed');
    // TODO: Notify user of failed payment
  }
}
