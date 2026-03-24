/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Salla Misc Event Handler                             ║
 * ║                                                                                ║
 * ║  FIX #8: استخراج أحداث العملاء والشحن والمنتجات من SallaWebhookProcessor     ║
 * ║                                                                                ║
 * ║  يُعالج: customer / cart / shipment / product / review / app / invoice        ║
 * ║                                                                                ║
 * ║  📁 src/modules/webhooks/processors/salla/salla-misc.handler.ts               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SallaOrderHandler, SallaProcessorContext } from './salla-order.handler';
import { Tenant, TenantStatus, SubscriptionPlan } from '@database/entities/tenant.entity';

@Injectable()
export class SallaMiscHandler {
  private readonly logger = new Logger(SallaMiscHandler.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly orderHandler: SallaOrderHandler,

    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  // ─── Customer Events ─────────────────────────────────────────────────────────

  async handleCustomerCreated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.created', { customerId: data.id });
    const saved = await this.orderHandler.syncCustomerToDatabase(data, context);
    this.eventEmitter.emit('customer.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      mobile: data.mobile,
      raw: data,
      dbCustomerId: saved?.id,
    });
    return { handled: true, action: 'customer_created', customerId: data.id, dbCustomerId: saved?.id };
  }

  async handleCustomerUpdated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.updated', { customerId: data.id });
    await this.orderHandler.syncCustomerToDatabase(data, context);
    this.eventEmitter.emit('customer.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      raw: data,
    });
    return { handled: true, action: 'customer_updated', customerId: data.id };
  }

  async handleCustomerOtpRequest(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.otp.request', { customerId: data.id });
    this.eventEmitter.emit('customer.otp.request', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      raw: data,
    });
    return { handled: true, action: 'customer_otp_request', customerId: data.id };
  }

  // ─── Cart Events ─────────────────────────────────────────────────────────────

  async handleAbandonedCart(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing abandoned.cart', { cartId: data.id });
    const cd = data.customer as Record<string, unknown> | undefined;
    if (cd?.id) await this.orderHandler.syncCustomerToDatabase(cd, context);
    this.eventEmitter.emit('cart.abandoned', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      cartId: data.id,
      customerName: cd?.first_name,
      customerPhone: cd?.mobile,
      customerEmail: cd?.email,
      cartTotal: data.total,
      items: data.items,
      raw: data,
    });
    return { handled: true, action: 'abandoned_cart', cartId: data.id };
  }

  // ─── Shipment Events ─────────────────────────────────────────────────────────

  async handleShipmentCreated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing shipment.created', { shipmentId: data.id });
    this.eventEmitter.emit('shipment.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      shipmentId: data.id,
      orderId: data.order_id,
      trackingNumber: data.tracking_number,
      shippingCompany: data.shipping_company,
      raw: data,
    });
    return { handled: true, action: 'shipment_created', shipmentId: data.id };
  }

  async handleTrackingRefreshed(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing tracking.refreshed', { orderId: data.id });
    this.eventEmitter.emit('tracking.refreshed', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      shipmentId: data.id,
      trackingStatus: data.status,
      raw: data,
    });
    return { handled: true, action: 'tracking_refreshed', shipmentId: data.id };
  }

  // ─── Product Events ──────────────────────────────────────────────────────────

  async handleProductAvailable(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.available', { productId: data.id });
    this.eventEmitter.emit('product.available', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName: data.name,
      quantity: data.quantity,
      raw: data,
    });
    return { handled: true, action: 'product_available', productId: data.id };
  }

  async handleProductQuantityLow(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.quantity.low', { productId: data.id });
    this.eventEmitter.emit('product.quantity.low', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName: data.name,
      currentQuantity: data.quantity,
      raw: data,
    });
    return { handled: true, action: 'product_quantity_low', productId: data.id };
  }

  async handleProductCreated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.created', { productId: data.id });
    this.eventEmitter.emit('product.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      raw: data,
    });
    return { handled: true, action: 'product_created', productId: data.id };
  }

  // ─── Review / Invoice / App Events ──────────────────────────────────────────

  async handleReviewAdded(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing review.added', { reviewId: data.id });
    this.eventEmitter.emit('review.added', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      reviewId: data.id,
      productId: data.product_id,
      rating: data.rating,
      content: data.content,
      customerName: data.customer_name,
      raw: data,
    });
    return { handled: true, action: 'review_added', reviewId: data.id, rating: data.rating };
  }

  async handleInvoiceCreated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing invoice.created', { invoiceId: data.id });
    this.eventEmitter.emit('invoice.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      invoiceId: data.id,
      raw: data,
    });
    return { handled: true, action: 'invoice_created', invoiceId: data.id };
  }

  async handleAppInstalled(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('🎉 Processing app.installed', { merchant: data.merchant });
    this.eventEmitter.emit('app.installed', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      merchant: data.merchant,
      raw: data,
    });
    return { handled: true, action: 'app_installed', merchant: data.merchant };
  }

  async handleAppUninstalled(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.logger.log('⚠️ Processing app.uninstalled', { merchant: data.merchant });
    this.eventEmitter.emit('app.uninstalled', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      merchant: data.merchant,
      raw: data,
    });
    return { handled: true, action: 'app_uninstalled', merchant: data.merchant };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ✅ Subscription Events — ربط باقة التاجر تلقائياً
  // ═══════════════════════════════════════════════════════════════════════════

  async handleSubscriptionEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    const planName = (data.plan_name as string) || (data.plan_type as string) || '';
    const startDate = data.start_date as string | undefined;
    const endDate = data.end_date as string | undefined;

    this.logger.log(`📦 Processing ${eventType}`, {
      tenantId: context.tenantId,
      planName,
      startDate,
      endDate,
    });

    if (!context.tenantId) {
      this.logger.warn(`⚠️ ${eventType}: no tenantId — cannot update subscription`);
      return { handled: false, reason: 'no_tenant_id', eventType };
    }

    try {
      let plan = this.mapSallaPlanToSubscription(planName);
      const endsAt = endDate ? new Date(endDate) : undefined;
      const isTrial = eventType.includes('trial');
      const isCancelled = eventType.includes('cancelled') || eventType.includes('expired');

      // ✅ FIX: تجريبي دائماً يحصل على أساسي كحد أدنى
      // سلة أحياناً ما ترسل plan_name مع app.trial.started
      if (isTrial && !isCancelled && plan === SubscriptionPlan.FREE) {
        plan = SubscriptionPlan.BASIC;
        this.logger.log(`📦 Trial with empty plan — defaulting to BASIC`);
      }

      if (isCancelled) {
        // إلغاء أو انتهاء الاشتراك → نرجع لـ FREE
        await this.tenantRepo.update(context.tenantId, {
          subscriptionPlan: SubscriptionPlan.FREE,
          status: TenantStatus.INACTIVE,
        });
        this.logger.log(`📦 Subscription cancelled/expired → FREE`, { tenantId: context.tenantId });
      } else if (isTrial) {
        // فترة تجريبية
        await this.tenantRepo.update(context.tenantId, {
          subscriptionPlan: plan,
          status: TenantStatus.TRIAL,
          trialEndsAt: endsAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });
        this.logger.log(`📦 Trial started → ${plan}`, { tenantId: context.tenantId, endsAt });
      } else {
        // اشتراك مدفوع
        await this.tenantRepo.update(context.tenantId, {
          subscriptionPlan: plan,
          status: TenantStatus.ACTIVE,
          subscriptionEndsAt: endsAt || undefined,
        });
        this.logger.log(`📦 Subscription active → ${plan}`, { tenantId: context.tenantId, endsAt });
      }

      this.eventEmitter.emit('subscription.updated', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        eventType,
        plan,
        planName,
        isTrial,
        isCancelled,
        endsAt,
      });

      return { handled: true, action: `subscription_${eventType}`, plan, planName };
    } catch (error: any) {
      this.logger.error(`❌ Failed to update subscription: ${error.message}`, {
        tenantId: context.tenantId,
        eventType,
      });
      return { handled: false, error: error.message, eventType };
    }
  }

  /**
   * تحويل اسم الباقة من سلة لـ SubscriptionPlan
   * سلة ترسل أسماء مثل: "أساسي", "Basic", "Pro", "Enterprise"
   */
  private mapSallaPlanToSubscription(planName: string): SubscriptionPlan {
    const lower = (planName || '').toLowerCase().trim();

    if (lower.includes('enterprise') || lower.includes('متقدم')) {
      return SubscriptionPlan.ENTERPRISE;
    }
    if (lower.includes('pro') || lower.includes('احترافي') || lower.includes('محترف')) {
      return SubscriptionPlan.PRO;
    }
    if (lower.includes('basic') || lower.includes('أساسي') || lower.includes('اساسي')) {
      return SubscriptionPlan.BASIC;
    }

    // أي باقة غير معروفة → BASIC (أفضل من FREE للتاجر اللي دفع)
    if (lower && lower !== 'free') {
      this.logger.warn(`⚠️ Unknown plan name "${planName}" — defaulting to BASIC`);
      return SubscriptionPlan.BASIC;
    }

    return SubscriptionPlan.FREE;
  }
}
