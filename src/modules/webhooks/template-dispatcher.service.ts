/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Template Dispatcher Service                      ║
 * ║                                                                                ║
 * ║  📌 يستمع لأحداث الـ webhooks ويرسل رسائل واتساب تلقائية                      ║
 * ║                                                                                ║
 * ║  ✅ v3: تسجيل مفصّل + جلب رقم العميل من قاعدة البيانات                        ║
 * ║                                                                                ║
 * ║  المسار:                                                                       ║
 * ║  Webhook → Processor → EventEmitter → هذا الـ Service                          ║
 * ║  → يبحث عن قالب مفعّل بنفس triggerEvent                                       ║
 * ║  → يستبدل المتغيرات → يرسل عبر واتساب                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageTemplate, Order, Customer } from '@database/entities';
import { Channel, ChannelType, ChannelStatus } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';

@Injectable()
export class TemplateDispatcherService {
  private readonly logger = new Logger(TemplateDispatcherService.name);

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepository: Repository<MessageTemplate>,

    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,

    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,

    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,

    private readonly channelsService: ChannelsService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Event Listeners
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnEvent('order.created')
  async onOrderCreated(payload: Record<string, unknown>) {
    await this.dispatch('order.created', payload);
  }

  @OnEvent('order.status.updated')
  async onOrderStatusUpdated(payload: Record<string, unknown>) {
    await this.dispatch('order.status.updated', payload);
  }

  @OnEvent('order.payment.updated')
  async onOrderPaymentUpdated(payload: Record<string, unknown>) {
    await this.dispatch('order.payment.updated', payload);
  }

  @OnEvent('order.shipped')
  async onOrderShipped(payload: Record<string, unknown>) {
    await this.dispatch('order.shipped', payload);
  }

  @OnEvent('order.delivered')
  async onOrderDelivered(payload: Record<string, unknown>) {
    await this.dispatch('order.delivered', payload);
  }

  @OnEvent('order.cancelled')
  async onOrderCancelled(payload: Record<string, unknown>) {
    await this.dispatch('order.cancelled', payload);
  }

  @OnEvent('customer.created')
  async onCustomerCreated(payload: Record<string, unknown>) {
    await this.dispatch('customer.created', payload);
  }

  @OnEvent('cart.abandoned')
  async onCartAbandoned(payload: Record<string, unknown>) {
    await this.dispatch('abandoned.cart', payload);
  }

  @OnEvent('shipment.created')
  async onShipmentCreated(payload: Record<string, unknown>) {
    await this.dispatch('shipment.created', payload);
  }

  @OnEvent('tracking.refreshed')
  async onTrackingRefreshed(payload: Record<string, unknown>) {
    await this.dispatch('tracking.refreshed', payload);
  }

  @OnEvent('review.added')
  async onReviewAdded(payload: Record<string, unknown>) {
    await this.dispatch('review.added', payload);
  }

  @OnEvent('product.available')
  async onProductAvailable(payload: Record<string, unknown>) {
    await this.dispatch('product.available', payload);
  }

  // ✅ v3: أحداث إضافية
  @OnEvent('product.quantity.low')
  async onProductQuantityLow(payload: Record<string, unknown>) {
    await this.dispatch('product.quantity.low', payload);
  }

  @OnEvent('order.refunded')
  async onOrderRefunded(payload: Record<string, unknown>) {
    await this.dispatch('order.refunded', payload);
  }

  @OnEvent('product.created')
  async onProductCreated(payload: Record<string, unknown>) {
    await this.dispatch('product.created', payload);
  }

  @OnEvent('customer.otp.request')
  async onCustomerOtpRequest(payload: Record<string, unknown>) {
    await this.dispatch('customer.otp.request', payload);
  }

  @OnEvent('invoice.created')
  async onInvoiceCreated(payload: Record<string, unknown>) {
    await this.dispatch('invoice.created', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Main Dispatch Logic
  // ═══════════════════════════════════════════════════════════════════════════════

  private async dispatch(triggerEvent: string, payload: Record<string, unknown>): Promise<void> {
    const tenantId = payload.tenantId as string | undefined;
    const storeId = payload.storeId as string | undefined;
    const raw = (payload.raw || payload) as Record<string, unknown>;

    if (!tenantId) {
      this.logger.warn(`⚠️ No tenantId for event ${triggerEvent} - skipping`);
      return;
    }

    try {
      this.logger.log(`📨 Dispatching templates for: ${triggerEvent}`, { tenantId, storeId });

      // 1️⃣ البحث عن القوالب المفعّلة بنفس triggerEvent
      const templates = await this.templateRepository.find({
        where: [
          { tenantId, triggerEvent, status: 'approved' },
          { tenantId, triggerEvent, status: 'active' },
        ],
      });

      // ✅ LOG level بدل DEBUG - لازم يظهر في الـ production logs
      this.logger.log(`📋 Templates found: ${templates.length} for trigger: ${triggerEvent}`, {
        tenantId,
        triggerEvent,
        templateNames: templates.map(t => t.name),
      });

      if (templates.length === 0) {
        this.logger.warn(`⚠️ No active templates found for trigger: ${triggerEvent} (tenantId: ${tenantId})`);
        return;
      }

      // 2️⃣ البحث عن قناة واتساب متصلة
      const channel = await this.findActiveWhatsAppChannel(storeId);
      if (!channel) {
        this.logger.warn(`⚠️ No active WhatsApp channel for store ${storeId}`);
        return;
      }
      this.logger.log(`📱 WhatsApp channel found: ${channel.id} (type: ${channel.type})`);

      // 3️⃣ استخراج رقم هاتف العميل
      let customerPhone = this.extractCustomerPhone(raw);

      // ✅ v3: إذا ما لقينا الرقم من بيانات الـ webhook → نبحث في قاعدة البيانات
      if (!customerPhone) {
        this.logger.log(`🔍 Phone not in webhook data, looking up from database...`);
        customerPhone = await this.lookupCustomerPhone(raw, storeId);
      }

      if (!customerPhone) {
        this.logger.warn(`⚠️ No customer phone found for event ${triggerEvent}`, {
          rawKeys: Object.keys(raw),
          hasCustomer: !!raw.customer,
          orderId: raw.id || raw.orderId,
        });
        return;
      }

      this.logger.log(`📞 Customer phone: ${customerPhone}`);

      // 4️⃣ إرسال الرسائل
      for (const template of templates) {
        await this.sendTemplate(template, channel, customerPhone, raw);
      }

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Template dispatch failed for ${triggerEvent}: ${msg}`, {
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * إرسال قالب واحد
   */
  private async sendTemplate(
    template: MessageTemplate,
    channel: Channel,
    customerPhone: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const message = this.replaceVariables(template.body, data);

      this.logger.log(`📤 Sending "${template.name}" to ${customerPhone}`, {
        channelId: channel.id,
        templateId: template.id,
        messagePreview: message.substring(0, 80) + '...',
      });

      const result = await this.channelsService.sendWhatsAppMessage(
        channel.id,
        customerPhone,
        message,
      );

      this.logger.log(`✅ Message sent: "${template.name}" → ${customerPhone}`, {
        messageId: result?.messageId || 'N/A',
      });

      // تحديث إحصائيات الاستخدام
      await this.incrementUsage(template.id);

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Failed to send "${template.name}" → ${customerPhone}: ${msg}`, {
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Phone Lookup Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * استخراج رقم هاتف العميل من بيانات الـ webhook
   */
  private extractCustomerPhone(data: Record<string, unknown>): string | null {
    // 1. من كائن customer (top-level)
    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer) {
      const mobile = customer.mobile || customer.phone || customer.mobile_code;
      if (mobile) {
        this.logger.log(`📞 Phone found in webhook customer object: ${mobile}`);
        return this.normalizePhone(String(mobile));
      }
    }

    // ✅ v4: من كائن order.customer (سلة ترسل order.status.updated بهالشكل)
    const orderObj = data.order as Record<string, unknown> | undefined;
    if (orderObj) {
      const orderCustomer = orderObj.customer as Record<string, unknown> | undefined;
      if (orderCustomer) {
        const mobile = orderCustomer.mobile || orderCustomer.phone || orderCustomer.mobile_code;
        if (mobile) {
          this.logger.log(`📞 Phone found in order.customer: ${mobile}`);
          return this.normalizePhone(String(mobile));
        }
      }
      // ✅ v4: من order.shipping_address
      const orderShipping = orderObj.shipping_address as Record<string, unknown> | undefined;
      if (orderShipping?.phone) {
        this.logger.log(`📞 Phone found in order.shipping_address: ${orderShipping.phone}`);
        return this.normalizePhone(String(orderShipping.phone));
      }
    }

    // 2. من الحقول المباشرة
    const directPhone = data.customerPhone || data.mobile || data.phone;
    if (directPhone) {
      this.logger.log(`📞 Phone found in direct field: ${directPhone}`);
      return this.normalizePhone(String(directPhone));
    }

    // 3. من عنوان الشحن (top-level)
    const shipping = data.shipping_address as Record<string, unknown> | undefined;
    if (shipping?.phone) {
      this.logger.log(`📞 Phone found in shipping_address: ${shipping.phone}`);
      return this.normalizePhone(String(shipping.phone));
    }

    // 4. من receiver
    const receiver = data.receiver as Record<string, unknown> | undefined;
    if (receiver?.phone || receiver?.mobile) {
      const p = receiver.phone || receiver.mobile;
      this.logger.log(`📞 Phone found in receiver: ${p}`);
      return this.normalizePhone(String(p));
    }

    this.logger.log(`📞 No phone in webhook data (keys: ${Object.keys(data).join(', ')})`);
    return null;
  }

  /**
   * ✅ v3: جلب رقم العميل من قاعدة البيانات
   * يبحث عن الطلب بـ sallaOrderId ثم يجلب رقم العميل من جدول customers
   */
  private async lookupCustomerPhone(
    data: Record<string, unknown>,
    storeId?: string,
  ): Promise<string | null> {
    if (!storeId) return null;

    try {
      // ✅ v4: البحث في data.id أو داخل data.order.id (سلة ترسل بيانات مختلفة حسب الحدث)
      const orderObj = data.order as Record<string, unknown> | undefined;
      const orderId = data.id || data.orderId || data.order_id || orderObj?.id || orderObj?.order_id;
      if (!orderId) {
        this.logger.log(`🔍 No order ID in data to lookup phone`);
        return null;
      }

      const sallaOrderId = String(orderId);
      this.logger.log(`🔍 Looking up order with sallaOrderId: ${sallaOrderId}, storeId: ${storeId}`);

      // البحث عن الطلب بـ sallaOrderId
      const order = await this.orderRepository.findOne({
        where: { storeId, sallaOrderId },
        relations: ['customer'],
      });

      if (!order) {
        this.logger.log(`🔍 Order not found in DB for sallaOrderId: ${sallaOrderId}`);

        // محاولة بديلة: البحث بالـ reference_id
        const refId = data.reference_id || data.referenceId;
        if (refId) {
          const orderByRef = await this.orderRepository.findOne({
            where: { storeId, referenceId: String(refId) } as any,
            relations: ['customer'],
          });
          if (orderByRef?.customer?.phone) {
            this.logger.log(`📞 Phone found via reference_id: ${orderByRef.customer.phone}`);
            return this.normalizePhone(orderByRef.customer.phone);
          }
        }

        return null;
      }

      // جلب الرقم من العميل
      if (order.customer?.phone) {
        this.logger.log(`📞 Phone found from DB customer: ${order.customer.phone}`);
        return this.normalizePhone(order.customer.phone);
      }

      // إذا ما لقينا العميل بالعلاقة → نبحث مباشرة
      if (order.customerId) {
        const customer = await this.customerRepository.findOne({
          where: { id: order.customerId },
          select: ['id', 'phone'],
        });
        if (customer?.phone) {
          this.logger.log(`📞 Phone found from customer lookup: ${customer.phone}`);
          return this.normalizePhone(customer.phone);
        }
      }

      // ✅ v4: محاولة أخيرة - البحث في metadata.sallaData عن رقم العميل
      const sallaData = (order.metadata as any)?.sallaData as Record<string, unknown> | undefined;
      if (sallaData) {
        const sallaCustomer = sallaData.customer as Record<string, unknown> | undefined;
        const sallaPhone = sallaCustomer?.mobile || sallaCustomer?.phone || sallaData.customer_phone;
        if (sallaPhone) {
          this.logger.log(`📞 Phone found from order sallaData: ${sallaPhone}`);
          return this.normalizePhone(String(sallaPhone));
        }
        // من shipping_address في sallaData
        const sallaShipping = sallaData.shipping_address as Record<string, unknown> | undefined;
        if (sallaShipping?.phone) {
          this.logger.log(`📞 Phone found from sallaData shipping: ${sallaShipping.phone}`);
          return this.normalizePhone(String(sallaShipping.phone));
        }
      }

      this.logger.warn(`⚠️ Order found but no customer phone (orderId: ${order.id})`);
      return null;

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Error looking up customer phone: ${msg}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Channel & Phone Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * البحث عن قناة واتساب متصلة
   */
  private async findActiveWhatsAppChannel(storeId?: string): Promise<Channel | null> {
    if (!storeId) return null;

    const channel = await this.channelRepository.findOne({
      where: [
        { storeId, type: ChannelType.WHATSAPP_QR, status: ChannelStatus.CONNECTED },
        { storeId, type: ChannelType.WHATSAPP_OFFICIAL, status: ChannelStatus.CONNECTED },
      ],
    });

    return channel || null;
  }

  /**
   * تنظيف رقم الهاتف
   */
  private normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)\+]/g, '');

    // رقم سعودي يبدأ بـ 05
    if (cleaned.startsWith('05') && cleaned.length === 10) {
      cleaned = '966' + cleaned.substring(1);
    }
    // رقم بدون كود الدولة
    else if (cleaned.startsWith('5') && cleaned.length === 9) {
      cleaned = '966' + cleaned;
    }

    return cleaned;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Template Processing
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * استبدال المتغيرات في نص القالب
   */
  private replaceVariables(body: string, data: Record<string, unknown>): string {
    let message = body;

    const customer = (data.customer || {}) as Record<string, unknown>;
    const urls = (data.urls || {}) as Record<string, unknown>;

    const variables: Record<string, string> = {
      customer_name: String(customer.first_name || customer.name || data.customerName || 'عميلنا الكريم'),
      customer_first_name: String(customer.first_name || data.customerName || 'عميلنا'),
      customer_phone: String(customer.mobile || customer.phone || ''),
      customer_email: String(customer.email || ''),
      order_id: String(data.reference_id || data.order_number || data.id || data.orderId || ''),
      order_total: this.formatAmount(data.total),
      order_status: String(data.status || data.newStatus || ''),
      order_date: new Date().toLocaleDateString('ar-SA'),
      order_tracking: String(urls.tracking || data.tracking_url || ''),
      tracking_number: String(data.tracking_number || data.trackingNumber || ''),
      shipping_company: String(data.shipping_company || data.shippingCompany || ''),
      store_name: String(data.store_name || 'متجرنا'),
      store_url: String(data.store_url || ''),
      cart_total: this.formatAmount(data.total || data.cartTotal),
      cart_link: String(data.cart_url || data.checkout_url || ''),
      product_name: String(data.name || data.productName || ''),
      product_price: this.formatAmount(data.price),
      payment_link: String(data.payment_url || data.checkout_url || ''),
    };

    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }

    // تنظيف المتغيرات غير المستبدلة
    message = message.replace(/\{\{[^}]+\}\}/g, '');

    return message.trim();
  }

  private formatAmount(amount: unknown): string {
    if (!amount) return '0';
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (isNaN(num)) return String(amount);
    return num.toLocaleString('ar-SA');
  }

  /**
   * تحديث عداد الاستخدام
   */
  private async incrementUsage(templateId: string): Promise<void> {
    try {
      await this.templateRepository
        .createQueryBuilder()
        .update(MessageTemplate)
        .set({
          stats: () =>
            `jsonb_set(COALESCE(stats, '{"usageCount":0}'::jsonb), '{usageCount}', (COALESCE((stats->>'usageCount')::int, 0) + 1)::text::jsonb)`,
        })
        .where('id = :id', { id: templateId })
        .execute();
    } catch {
      this.logger.warn(`Failed to increment usage for template ${templateId}`);
    }
  }
}
