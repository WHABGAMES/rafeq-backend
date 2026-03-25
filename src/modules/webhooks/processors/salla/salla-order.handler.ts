/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Salla Order Event Handler                            ║
 * ║                                                                                ║
 * ║  FIX #8: استخراج معالجة أحداث الطلبات من SallaWebhookProcessor               ║
 * ║                                                                                ║
 * ║  المسؤولية الوحيدة:                                                            ║
 * ║    • handleOrderCreated                                                        ║
 * ║    • handleOrderUpdated                                                        ║
 * ║    • handleOrderStatusUpdated                                                  ║
 * ║    • handleOrderPaymentUpdated                                                 ║
 * ║    • handleOrderShipped / Delivered / Cancelled / Refunded                    ║
 * ║    • syncOrderToDatabase / syncCustomerToDatabase                              ║
 * ║                                                                                ║
 * ║  📁 src/modules/webhooks/processors/salla/salla-order.handler.ts              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order, OrderStatus } from '@database/entities/order.entity';
import { Customer, CustomerStatus } from '@database/entities/customer.entity';
import { SallaStatusMapper } from './salla-status.mapper';

export interface SallaProcessorContext {
  tenantId?: string;
  storeId?: string;
  webhookEventId: string;
}

@Injectable()
export class SallaOrderHandler {
  private readonly logger = new Logger(SallaOrderHandler.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,

    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,

    private readonly eventEmitter: EventEmitter2,
    private readonly statusMapper: SallaStatusMapper,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Order Event Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  async handleOrderCreated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    const normalizedData = this.normalizeOrderPayload(data);
    this.logger.log('Processing order.created', { orderId: normalizedData.id, storeId: context.storeId });

    let savedCustomer: Customer | null = null;
    const cd = normalizedData.customer as Record<string, unknown> | undefined;
    if (cd?.id) savedCustomer = await this.syncCustomerToDatabase(cd, context);
    const savedOrder = await this.syncOrderToDatabase(normalizedData, context, savedCustomer?.id);

    const paymentObj = normalizedData.payment as Record<string, unknown> | undefined;
    const paymentMethod = String(
      paymentObj?.method || normalizedData.payment_method || '',
    ).toLowerCase().trim();

    const basePayload = {
      tenantId:     context.tenantId,
      storeId:      context.storeId,
      orderId:      normalizedData.id,
      orderNumber:  normalizedData.reference_id || normalizedData.order_number,
      customerName: cd?.first_name || cd?.name,
      customerPhone: cd?.mobile || cd?.phone,
      totalAmount:  normalizedData.total,
      currency:     normalizedData.currency,
      items:        normalizedData.items,
      status:       normalizedData.status,
      paymentMethod,
      raw:          normalizedData,
      dbOrderId:    savedOrder?.id,
      dbCustomerId: savedCustomer?.id,
    };

    this.eventEmitter.emit('order.created', basePayload);

    if (paymentMethod === 'cod' || paymentMethod === 'cash_on_delivery') {
      this.logger.log(`💵 COD order — emitting order.cod.created`, { orderId: normalizedData.id });
      this.eventEmitter.emit('order.cod.created', basePayload);
    } else if (paymentMethod && paymentMethod !== '') {
      this.logger.log(`💳 Online payment (${paymentMethod}) — emitting order.online.created`);
      this.eventEmitter.emit('order.online.created', basePayload);
    }

    const emittedEvents = ['order.created'];
    if (paymentMethod === 'cod' || paymentMethod === 'cash_on_delivery') emittedEvents.push('order.cod.created');
    else if (paymentMethod) emittedEvents.push('order.online.created');

    return {
      handled: true,
      action: 'order_created',
      orderId: normalizedData.id,
      paymentMethod: paymentMethod || 'unknown',
      dbOrderId: savedOrder?.id || 'sync_failed',
      dbCustomerId: savedCustomer?.id || 'no_customer',
      emittedEvents,
    };
  }

  async handleOrderUpdated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    const normalizedData = this.normalizeOrderPayload(data);
    const normalizedOrderId = normalizedData.id ?? data.id;
    this.logger.log('Processing order.updated', { orderId: normalizedOrderId });

    const statusCandidate = normalizedData.status;
    const previousStatus = normalizedData.previous_status;

    if (statusCandidate !== undefined && statusCandidate !== null) {
      const statusSignature = this.statusMapper.buildStatusSignature(statusCandidate);
      const mappedStatus = this.statusMapper.mapSallaOrderStatus(statusCandidate);
      const resolved = this.statusMapper.resolveSpecificStatusEvent(statusCandidate, mappedStatus, normalizedData);
      const { templateSlug: _templateSlug, specificEvent, mappedStatus: resolvedStatus } = resolved;

      const criticalFallbackEvents = new Set([
        'order.status.pending_payment',
        'order.status.under_review',
        'order.status.processing',
      ]);

      const hasPreviousStatus = previousStatus !== undefined && previousStatus !== null;
      let hasRealStatusTransition = false;
      let existingStatusSignature = '';

      if (context.storeId && normalizedOrderId !== undefined) {
        try {
          const existingOrder = await this.orderRepository.findOne({
            where: { storeId: context.storeId, sallaOrderId: String(normalizedOrderId) },
          });
          existingStatusSignature = String((existingOrder?.metadata as any)?.sallaData?.lastStatusSignature || '');
          hasRealStatusTransition =
            !existingOrder ||
            existingOrder.status !== resolvedStatus ||
            (!!statusSignature && statusSignature !== existingStatusSignature);
        } catch {
          hasRealStatusTransition = true;
        }
      }

      const shouldForwardToStatusHandler =
        hasPreviousStatus ||
        hasRealStatusTransition ||
        (!!specificEvent && criticalFallbackEvents.has(specificEvent)) ||
        (!context.storeId && !!specificEvent && specificEvent !== 'order.created');

      if (shouldForwardToStatusHandler) {
        return this.handleOrderStatusUpdated(
          { ...normalizedData, id: normalizedOrderId, status: statusCandidate, ...(hasPreviousStatus ? { previous_status: previousStatus } : {}) },
          context,
        );
      }
    }

    let savedCustomer: Customer | null = null;
    const customerData = normalizedData.customer as Record<string, unknown> | undefined;
    if (customerData?.id) savedCustomer = await this.syncCustomerToDatabase(customerData, context);
    const savedOrder = await this.syncOrderToDatabase(normalizedData, context, savedCustomer?.id);

    this.eventEmitter.emit('order.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: normalizedOrderId,
      raw: normalizedData,
    });

    return {
      handled: true,
      action: 'order_updated',
      orderId: normalizedOrderId,
      routedToStatusHandler: false,
      dbOrderId: savedOrder?.id || 'sync_failed',
    };
  }

  async handleOrderStatusUpdated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    const normalizedData = this.normalizeOrderPayload(data);
    const orderId = normalizedData.id ?? data.id;

    const sallaStatus = normalizedData.status;
    const mappedStatus = this.statusMapper.mapSallaOrderStatus(sallaStatus);
    const resolved = this.statusMapper.resolveSpecificStatusEvent(sallaStatus, mappedStatus, normalizedData);
    const { specificEvent } = resolved;

    this.logger.log(`Processing order.status.updated → ${mappedStatus} (event: ${specificEvent || 'none'})`, {
      orderId,
      storeId: context.storeId,
    });

    // بناء payload للعميل
    const customerData = normalizedData.customer as Record<string, unknown> | undefined;
    if (customerData?.id) await this.syncCustomerToDatabase(customerData, context);

    const savedOrder = await this.updateOrderStatusInDatabase(normalizedData, context, mappedStatus);

    const basePayload = {
      tenantId:      context.tenantId,
      storeId:       context.storeId,
      orderId,
      status:        mappedStatus,
      previousStatus: normalizedData.previous_status,
      raw:           normalizedData,
      dbOrderId:     savedOrder?.id,
      customer:      customerData,
    };

    // إطلاق الحدث العام دائماً
    this.eventEmitter.emit('order.status.updated', basePayload);

    // إطلاق الحدث المحدد
    if (specificEvent && specificEvent !== 'order.created') {
      this.logger.log(`🎯 Emitting specific event: ${specificEvent}`, { orderId });
      this.eventEmitter.emit(specificEvent, basePayload);
    }

    return {
      handled: true,
      action: 'order_status_updated',
      orderId,
      mappedStatus,
      specificEvent: specificEvent || 'none',
      dbOrderId: savedOrder?.id || 'sync_failed',
    };
  }

  async handleOrderPaymentUpdated(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    this.eventEmitter.emit('order.payment.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      raw: data,
    });
    return { handled: true, action: 'order_payment_updated' };
  }

  async handleOrderShipped(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.SHIPPED);
    this.eventEmitter.emit('order.shipped', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, raw: data });
    return { handled: true, action: 'order_shipped' };
  }

  async handleOrderDelivered(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.DELIVERED);
    this.eventEmitter.emit('order.delivered', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, raw: data });
    return { handled: true, action: 'order_delivered' };
  }

  async handleOrderCancelled(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.CANCELLED);
    this.eventEmitter.emit('order.cancelled', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, raw: data });
    return { handled: true, action: 'order_cancelled' };
  }

  async handleOrderRefunded(
    data: Record<string, unknown>,
    context: SallaProcessorContext,
  ): Promise<Record<string, unknown>> {
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.REFUNDED);
    this.eventEmitter.emit('order.refunded', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, raw: data });
    return { handled: true, action: 'order_refunded' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Database Sync
  // ═══════════════════════════════════════════════════════════════════════════════

  async syncCustomerToDatabase(
    customerData: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
  ): Promise<Customer | null> {
    if (!context.storeId || !customerData?.id) {
      this.logger.warn('⚠️ Cannot sync customer: missing storeId or id');
      return null;
    }

    const sallaCustomerId = String(customerData.id);

    try {
      let customer = await this.customerRepository.findOne({
        where: { storeId: context.storeId, sallaCustomerId },
      });

      const firstName = (customerData.first_name as string) || (customerData.name as string) || undefined;
      const lastName  = (customerData.last_name as string) || undefined;
      const fullName  = firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined;
      const email     = (customerData.email as string) || undefined;
      const phone     = this.buildFullPhoneFromCustomer(customerData);

      if (customer) {
        if (firstName) customer.firstName = firstName;
        if (lastName)  customer.lastName  = lastName;
        if (fullName)  customer.fullName  = fullName;
        if (phone)     customer.phone     = phone;
        if (email)     customer.email     = email;
        customer.metadata = { ...(customer.metadata || {}), sallaData: customerData } as any;
        customer = await this.customerRepository.save(customer);
        this.logger.log(`🔄 Customer updated: ${sallaCustomerId} (${fullName || 'N/A'})`);
      } else {
        customer = this.customerRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          sallaCustomerId,
          firstName, lastName, fullName, phone, email,
          status: CustomerStatus.ACTIVE,
          metadata: { sallaData: customerData } as any,
        });
        customer = await this.customerRepository.save(customer);
        this.logger.log(`✅ Customer saved: ${sallaCustomerId} (${fullName || 'N/A'})`);
      }

      return customer;
    } catch (error: unknown) {
      this.logger.error(`❌ Customer sync failed ${sallaCustomerId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  async syncOrderToDatabase(
    orderData: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
    customerId?: string,
  ): Promise<Order | null> {
    if (!context.storeId || !orderData?.id) {
      this.logger.warn('⚠️ Cannot sync order: missing storeId or id');
      return null;
    }

    const sallaOrderId = String(orderData.id);

    try {
      let order = await this.orderRepository.findOne({
        where: { storeId: context.storeId, sallaOrderId },
      });

      const status = this.statusMapper.mapSallaOrderStatus(orderData.status);
      const statusSignature = this.statusMapper.buildStatusSignature(orderData.status);

      const items = Array.isArray(orderData.items)
        ? (orderData.items as Array<Record<string, unknown>>).map(item => ({
            productId: String(item.product_id || item.id || ''),
            name: String(item.name || ''),
            sku: (item.sku as string) || undefined,
            quantity: Number(item.quantity || 1),
            unitPrice: this.statusMapper.extractAmount(item.price || item.unit_price),
            totalPrice: this.statusMapper.extractAmount(item.total),
          }))
        : [];

      if (order) {
        order.status = status;
        if (customerId) order.customerId = customerId;
        order.referenceId = (orderData.reference_id as string) || (orderData.order_number as string) || order.referenceId;
        if (orderData.total) order.totalAmount = this.statusMapper.extractAmount(orderData.total);
        if (items.length > 0) order.items = items as any;
        const existingSallaData = (order.metadata?.sallaData as Record<string, unknown>) || {};
        const mergedSallaData = { ...existingSallaData, ...orderData };
        if (statusSignature) (mergedSallaData as any).lastStatusSignature = statusSignature;
        order.metadata = { ...(order.metadata || {}), sallaData: mergedSallaData } as any;
        order = await this.orderRepository.save(order);
        this.logger.log(`🔄 Order updated: ${sallaOrderId} → ${status}`);
      } else {
        const initialSallaData: Record<string, unknown> = { ...orderData };
        if (statusSignature) initialSallaData.lastStatusSignature = statusSignature;
        order = this.orderRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          customerId: customerId || undefined,
          sallaOrderId,
          referenceId: (orderData.reference_id as string) || (orderData.order_number as string) || undefined,
          status,
          currency: (orderData.currency as string) || 'SAR',
          totalAmount: this.statusMapper.extractAmount(orderData.total),
          subtotal: this.statusMapper.extractAmount(orderData.sub_total || orderData.total),
          items: items as any,
          metadata: { sallaData: initialSallaData } as any,
        });
        order = await this.orderRepository.save(order);
        this.logger.log(`✅ Order saved: ${sallaOrderId} (${order.totalAmount} ${order.currency})`);
      }

      return order;
    } catch (error: unknown) {
      this.logger.error(`❌ Order sync failed ${sallaOrderId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  async updateOrderStatusInDatabase(
    orderData: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
    newStatus: OrderStatus,
    extraUpdates?: Partial<Order>,
  ): Promise<Order | null> {
    if (!context.storeId || !orderData?.id) return null;

    const sallaOrderId = String(orderData.id);
    const statusSignature = this.statusMapper.buildStatusSignature(orderData.status);

    try {
      const order = await this.orderRepository.findOne({
        where: { storeId: context.storeId, sallaOrderId },
      });

      if (!order) {
        this.logger.warn(`⚠️ Order ${sallaOrderId} not in DB — creating`);
        return this.syncOrderToDatabase({ ...orderData, status: orderData.status ?? newStatus }, context);
      }

      order.status = newStatus;
      if (extraUpdates) Object.assign(order, extraUpdates);

      const existingSallaData = (order.metadata?.sallaData as Record<string, unknown>) || {};
      const mergedSallaData = { ...existingSallaData, lastWebhookData: orderData };
      if (statusSignature) (mergedSallaData as any).lastStatusSignature = statusSignature;
      order.metadata = { ...(order.metadata || {}), sallaData: mergedSallaData } as any;

      const saved = await this.orderRepository.save(order);
      this.logger.log(`🔄 Order ${sallaOrderId} → ${newStatus}`);
      return saved;
    } catch (error: unknown) {
      this.logger.error(`❌ Order status update failed ${sallaOrderId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  normalizeOrderPayload(data: Record<string, unknown>): Record<string, unknown> {
    // Some webhooks send order data under data.order, others at top-level
    const orderData = (data.order as Record<string, unknown>) || {};
    return { ...orderData, ...data };
  }

  private buildFullPhoneFromCustomer(customerData: Record<string, unknown>): string | undefined {
    const mobile     = customerData.mobile      as string | undefined;
    const mobileCode = customerData.mobile_code as string | undefined;
    const phone      = customerData.phone       as string | undefined;

    let result: string | undefined;

    if (mobileCode && mobile) {
      const code = String(mobileCode).replace(/[^0-9]/g, '');
      const num  = String(mobile).replace(/[^0-9]/g, '').replace(/^0+/, '');
      if (code && num) result = code + num;
    }

    if (!result && phone) {
      result = String(phone).replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
    }

    if (!result && mobile) {
      let n = String(mobile).replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
      if (n.startsWith('05') && n.length === 10) n = '966' + n.slice(1);
      else if (n.startsWith('5') && n.length === 9) n = '966' + n;
      result = n;
    }

    // ✅ FIX: تجاهل الأرقام القصيرة جداً (رمز دولة فقط بدون رقم فعلي)
    if (result) {
      const digits = result.replace(/[^0-9]/g, '');
      if (digits.length < 7) return undefined;
    }

    return result;
  }
}
