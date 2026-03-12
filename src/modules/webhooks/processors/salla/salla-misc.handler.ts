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
import { SallaOrderHandler, SallaProcessorContext } from './salla-order.handler';

@Injectable()
export class SallaMiscHandler {
  private readonly logger = new Logger(SallaMiscHandler.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly orderHandler: SallaOrderHandler,
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
}
