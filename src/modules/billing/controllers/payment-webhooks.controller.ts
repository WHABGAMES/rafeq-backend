/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Payment Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  📌 استقبال webhooks من بوابات الدفع                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';

@ApiTags('Billing - Webhooks')
@Controller({
  path: 'billing/webhooks',
  version: '1',
})
export class WebhooksController {
  /**
   * Stripe Webhook
   */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // لا يظهر في Swagger
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') _signature: string,
  ) {
    // TODO: التحقق من signature
    const event = req.body as Record<string, unknown>;

    switch (event?.type) {
      case 'checkout.session.completed':
        // معالجة نجاح الدفع
        break;
      case 'invoice.payment_succeeded':
        // تجديد الاشتراك
        break;
      case 'invoice.payment_failed':
        // فشل التجديد
        break;
      case 'customer.subscription.deleted':
        // إلغاء الاشتراك
        break;
    }

    return { received: true };
  }

  /**
   * Moyasar Webhook
   */
  @Post('moyasar')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleMoyasarWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers('x-moyasar-signature') _signature: string,
  ) {
    // TODO: التحقق من signature
    const type = payload?.type;

    switch (type) {
      case 'payment_paid':
        // معالجة نجاح الدفع
        break;
      case 'payment_failed':
        // فشل الدفع
        break;
    }

    return { received: true };
  }
}
