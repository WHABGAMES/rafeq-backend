/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Payment Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  🔧 FIX C-05: Full signature verification for Stripe + Moyasar                ║
 * ║  📌 استقبال webhooks من بوابات الدفع مع التحقق من التوقيع                      ║
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

// ═══════════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stripe Webhook Event shape
 * @see https://stripe.com/docs/api/events/object
 */
interface StripeEventData {
  object: Record<string, unknown>;
  previous_attributes?: Record<string, unknown>;
}

interface StripeWebhookEvent {
  id: string;
  type: string;
  data: StripeEventData;
  created: number;
  livemode: boolean;
  api_version: string;
}

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

    const disabledProviders = [
      !this.stripeWebhookSecret ? 'Stripe' : null,
      !this.moyasarSecretKey ? 'Moyasar' : null,
    ].filter((provider): provider is string => provider !== null);

    if (disabledProviders.length > 0) {
      // Missing credentials mean the optional provider is intentionally
      // disabled. The endpoint still fails closed if it is called.
      this.logger.log(`Payment webhooks disabled until configured: ${disabledProviders.join(', ')}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 FIX C-05: Stripe Webhook with signature verification
  // Uses Stripe's standard HMAC-SHA256 signature scheme
  // ═══════════════════════════════════════════════════════════════════════════════

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

    // Verify raw body is available (needed for HMAC)
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('🚨 Stripe webhook: No raw body available');
      throw new BadRequestException('Raw body required for signature verification');
    }

    // Verify the cryptographic signature
    const event = this.verifyStripeSignature(rawBody, signature);
    if (!event) {
      this.logger.error('🚨 Stripe webhook: Invalid signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    this.logger.log(`✅ Stripe webhook verified: ${event.type}`);

    // Route to handler — event.data.object is the Stripe resource
    const eventObject = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed':
        this.logger.log(`Processing checkout.session.completed — session: ${String(eventObject.id || 'unknown')}`);
        // TODO: Activate subscription, update billing records
        break;

      case 'invoice.payment_succeeded':
        this.logger.log(`Processing invoice.payment_succeeded — invoice: ${String(eventObject.id || 'unknown')}`);
        // TODO: Extend subscription period
        break;

      case 'invoice.payment_failed':
        this.logger.log(`Processing invoice.payment_failed — invoice: ${String(eventObject.id || 'unknown')}`);
        // TODO: Notify user, mark subscription at risk
        break;

      case 'customer.subscription.deleted':
        this.logger.log(`Processing customer.subscription.deleted — sub: ${String(eventObject.id || 'unknown')}`);
        // TODO: Downgrade to free plan, notify user
        break;

      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }

    return { received: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 FIX C-05: Moyasar Webhook with signature verification
  // Uses Moyasar's HMAC-SHA256 signature scheme
  // ═══════════════════════════════════════════════════════════════════════════════

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

    // Verify Moyasar HMAC signature
    if (!this.verifyMoyasarSignature(rawBody, signature)) {
      this.logger.error('🚨 Moyasar webhook: Invalid signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    const paymentType = String(payload.type || 'unknown');
    this.logger.log(`✅ Moyasar webhook verified: ${paymentType}`);

    switch (paymentType) {
      case 'payment_paid':
        this.logger.log(`Processing Moyasar payment_paid — id: ${String(payload.id || 'unknown')}`);
        // TODO: Activate subscription
        break;

      case 'payment_failed':
        this.logger.log(`Processing Moyasar payment_failed — id: ${String(payload.id || 'unknown')}`);
        // TODO: Notify user of failed payment
        break;

      default:
        this.logger.debug(`Unhandled Moyasar event: ${paymentType}`);
    }

    return { received: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Signature Verification — Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Verify Stripe webhook signature using their standard scheme:
   * signature header format: t=timestamp,v1=hash
   *
   * @see https://stripe.com/docs/webhooks/signatures
   */
  private verifyStripeSignature(
    rawBody: Buffer,
    signatureHeader: string,
  ): StripeWebhookEvent | null {
    try {
      const elements = signatureHeader.split(',');
      const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
      const signature = elements.find(e => e.startsWith('v1='))?.slice(3);

      if (!timestamp || !signature) {
        this.logger.warn('Invalid Stripe signature format');
        return null;
      }

      // Check timestamp tolerance (5 minutes — prevents replay attacks)
      const TOLERANCE_SECONDS = 300;
      const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
      if (Math.abs(timestampAge) > TOLERANCE_SECONDS) {
        this.logger.warn(`Stripe webhook timestamp too old: ${timestampAge}s`);
        return null;
      }

      // Compute expected signature: HMAC-SHA256(timestamp.body, secret)
      const signedPayload = `${timestamp}.${rawBody.toString()}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.stripeWebhookSecret)
        .update(signedPayload)
        .digest('hex');

      // Length check required before timingSafeEqual (throws on length mismatch)
      if (signature.length !== expectedSignature.length) return null;

      // Timing-safe comparison (prevents timing attacks)
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      if (!isValid) return null;

      return JSON.parse(rawBody.toString()) as StripeWebhookEvent;
    } catch (error) {
      this.logger.error('Stripe signature verification error:', error);
      return null;
    }
  }

  /**
   * Verify Moyasar webhook signature (HMAC-SHA256)
   *
   * @see https://docs.moyasar.com/webhooks
   */
  private verifyMoyasarSignature(rawBody: Buffer, signature: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.moyasarSecretKey)
        .update(rawBody)
        .digest('hex');

      // Length check required before timingSafeEqual (throws on length mismatch)
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
}
