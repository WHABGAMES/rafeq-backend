/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Salla Status Mapper                                  ║
 * ║                                                                                ║
 * ║  FIX #8: استخراج منطق تحويل حالات سلة من SallaWebhookProcessor               ║
 * ║                                                                                ║
 * ║  المهمة الوحيدة لهذا الملف:                                                    ║
 * ║    تحويل حالة سلة (string | object | undefined) → OrderStatus + triggerEvent  ║
 * ║                                                                                ║
 * ║  📁 src/modules/webhooks/processors/salla/salla-status.mapper.ts              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@database/entities/order.entity';

// ─── Arabic Unicode Cleaner ─────────────────────────────────────────────────────
// سلة تُضيف أحياناً أحرف Unicode مخفية في نصوص الحالة
// هذه الأحرف تجعل "بإنتظار الدفع".includes("دفع") = false
function cleanForMatch(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // تشكيل
    .replace(/[\u0300-\u036F\uFE20-\uFE2F]/g, '')                     // combining marks
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')  // invisible chars
    .replace(/\u0640/g, '')                                             // tatweel
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SallaStatusObject {
  id?: number;
  name?: string;
  slug?: string;
  customized?: { id?: number; name?: string; slug?: string };
  original?: { id?: number; name?: string; slug?: string };
  parent?: { id?: number; name?: string; slug?: string };
}

export interface StatusResolution {
  templateSlug: string;
  specificEvent: string | null;
  mappedStatus: OrderStatus;
}

@Injectable()
export class SallaStatusMapper {
  private readonly logger = new Logger(SallaStatusMapper.name);

  /**
   * تجميع كل الإشارات الممكنة من كائن الحالة
   */
  collectStatusSignals(sallaStatus: unknown): string[] {
    const signals = new Set<string>();

    const addSignal = (value: unknown): void => {
      if (value === undefined || value === null) return;
      const raw = String(value).toLowerCase().trim();
      if (!raw) return;
      signals.add(raw);
      signals.add(raw.replace(/[\s-]+/g, '_'));
      signals.add(cleanForMatch(raw));
    };

    if (typeof sallaStatus === 'string' || typeof sallaStatus === 'number') {
      addSignal(sallaStatus);
    }

    if (typeof sallaStatus === 'object' && sallaStatus !== null) {
      const obj = sallaStatus as SallaStatusObject;
      addSignal(obj.slug);
      addSignal(obj.name);
      addSignal(obj.customized?.slug);
      addSignal(obj.customized?.name);
      addSignal(obj.original?.slug);
      addSignal(obj.original?.name);
      addSignal(obj.parent?.slug);
      addSignal(obj.parent?.name);
    }

    addSignal(this.extractStatusString(sallaStatus));
    addSignal(this.extractCustomizedStatus(sallaStatus));

    return Array.from(signals).filter(Boolean);
  }

  buildStatusSignature(sallaStatus: unknown): string {
    const signals = this.collectStatusSignals(sallaStatus);
    if (!signals.length) return '';
    return signals.sort().join('|');
  }

  hasUnderReviewSignal(statusValue: unknown): boolean {
    const signals = this.collectStatusSignals(statusValue);
    const joined = signals.join(' ');
    return (
      signals.some(s => s.includes('under_review') || s.includes('awaiting_review') || s.includes('review')) ||
      /\u0645\u0631\u0627\u062c\u0639/.test(joined)
    );
  }

  hasProcessingSignal(statusValue: unknown): boolean {
    if (this.hasUnderReviewSignal(statusValue)) return false;
    const signals = this.collectStatusSignals(statusValue);
    const joined = signals.join(' ');
    return (
      signals.some(s => s.includes('in_progress') || s.includes('processing')) ||
      /\u062a\u0646\u0641\u064a\u0630/.test(joined) ||
      /\u0645\u0639\u0627\u0644\u062c/.test(joined)
    );
  }

  hasPendingPaymentSignal(payload: Record<string, unknown>, statusValue: unknown): boolean {
    const signals = this.collectStatusSignals(statusValue);
    const joined = signals.join(' ');
    const hasStatusSignal =
      signals.some(s =>
        s.includes('pending_payment') ||
        s.includes('payment_pending') ||
        s.includes('awaiting_payment') ||
        s.includes('payment_due'),
      ) ||
      (/\u062f\u0641\u0639/.test(joined) && !/\u0645\u062f\u0641\u0648\u0639/.test(joined));

    if (hasStatusSignal) return true;

    const isPendingPayment = payload.is_pending_payment;
    if (typeof isPendingPayment === 'boolean' && isPendingPayment) return true;
    if (typeof isPendingPayment === 'number' && isPendingPayment > 0) return true;
    if (
      typeof isPendingPayment === 'string' &&
      ['1', 'true', 'yes'].includes(isPendingPayment.toLowerCase().trim())
    ) return true;

    const pendingEndsAt = payload.pending_payment_ends_at;
    if (typeof pendingEndsAt === 'number' && pendingEndsAt > 0) return true;
    if (typeof pendingEndsAt === 'string' && pendingEndsAt.trim() !== '' && pendingEndsAt !== '0') return true;

    const paymentObj = payload.payment as Record<string, unknown> | undefined;
    const paymentStatus = String(paymentObj?.status || payload.payment_status || '').toLowerCase().trim();
    if (['pending', 'unpaid', 'awaiting_payment', 'payment_pending', 'pending_payment'].includes(paymentStatus)) return true;

    return false;
  }

  resolveSpecificStatusEvent(
    statusValue: unknown,
    mappedStatus: OrderStatus,
    payload?: Record<string, unknown>,
  ): StatusResolution {
    const templateSlug = this.extractCustomizedStatus(statusValue);
    let resolvedStatus = mappedStatus;
    let specificEvent = this.mapStatusToSpecificEvent(templateSlug, resolvedStatus);

    if (payload && this.hasPendingPaymentSignal(payload, statusValue) && (!specificEvent || specificEvent === 'order.created')) {
      resolvedStatus = OrderStatus.PENDING_PAYMENT;
      specificEvent = 'order.status.pending_payment';
    }

    if (this.hasUnderReviewSignal(statusValue) && (!specificEvent || specificEvent === 'order.created')) {
      resolvedStatus = OrderStatus.UNDER_REVIEW;
      specificEvent = 'order.status.under_review';
    }

    if (this.hasProcessingSignal(statusValue) && (!specificEvent || specificEvent === 'order.created')) {
      resolvedStatus = OrderStatus.PROCESSING;
      specificEvent = 'order.status.processing';
    }

    return { templateSlug, specificEvent, mappedStatus: resolvedStatus };
  }

  extractAmount(value: unknown): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      const numVal = obj.amount ?? obj.value ?? obj.total ?? obj.grand_total ?? obj.price;
      if (numVal !== undefined && numVal !== null) {
        const num = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
        return isNaN(num) ? 0 : num;
      }
    }
    return 0;
  }

  extractStatusString(sallaStatus: unknown): string | undefined {
    if (!sallaStatus) return undefined;
    if (typeof sallaStatus === 'string') return sallaStatus;
    if (typeof sallaStatus === 'number') return String(sallaStatus);
    if (typeof sallaStatus === 'object') {
      const obj = sallaStatus as SallaStatusObject;
      return obj.slug || obj.name || obj.customized?.slug || obj.customized?.name;
    }
    return undefined;
  }

  extractCustomizedStatus(sallaStatus: unknown): string {
    if (!sallaStatus) return '';
    if (typeof sallaStatus === 'string') return sallaStatus.toLowerCase().trim();
    if (typeof sallaStatus === 'number') return String(sallaStatus);
    if (typeof sallaStatus === 'object') {
      const obj = sallaStatus as SallaStatusObject;
      const slug = obj.customized?.slug || obj.slug || obj.original?.slug || obj.parent?.slug;
      if (slug) return slug.toLowerCase().trim();
      const name = obj.customized?.name || obj.name || obj.original?.name;
      if (name) {
        const cleaned = cleanForMatch(name.toLowerCase().trim());
        return cleaned.replace(/\s+/g, '_');
      }
    }
    return '';
  }

  /**
   * ╔══════════════════════════════════════════════════════════════════════════════╗
   * ║  mapSallaOrderStatus — النواة الأساسية                                       ║
   * ║                                                                              ║
   * ║  يحوّل حالة سلة (أي شكل) → OrderStatus الداخلي                             ║
   * ║  يعالج: string / number / object / Arabic text                              ║
   * ╚══════════════════════════════════════════════════════════════════════════════╝
   */
  mapSallaOrderStatus(sallaStatus: unknown): OrderStatus {
    if (!sallaStatus) return OrderStatus.CREATED;

    const statusStr = this.extractStatusString(sallaStatus);
    if (!statusStr) {
      this.logger.warn(`mapSallaOrderStatus: cannot extract string from`, { sallaStatus: JSON.stringify(sallaStatus).substring(0, 100) });
      return OrderStatus.CREATED;
    }

    const cleaned = cleanForMatch(statusStr.toLowerCase().trim());
    const slug = cleaned.replace(/[\s-]+/g, '_');

    // ─── Map الكامل: slug → OrderStatus ────────────────────────────────────
    const STATUS_MAP: Record<string, OrderStatus> = {
      // Created
      'created':                OrderStatus.CREATED,
      'new':                    OrderStatus.CREATED,
      'confirmed':              OrderStatus.CREATED,

      // Processing
      'in_progress':            OrderStatus.PROCESSING,
      'processing':             OrderStatus.PROCESSING,
      'inprogress':             OrderStatus.PROCESSING,

      // Under Review
      'under_review':           OrderStatus.UNDER_REVIEW,
      'awaiting_review':        OrderStatus.UNDER_REVIEW,
      'reviewing':              OrderStatus.UNDER_REVIEW,

      // Ready to Ship
      'ready_to_ship':          OrderStatus.READY_TO_SHIP,
      'readytoship':            OrderStatus.READY_TO_SHIP,
      'ready_for_shipping':     OrderStatus.READY_TO_SHIP,
      'ready_for_pickup':       OrderStatus.READY_TO_SHIP,

      // In Transit
      'in_transit':             OrderStatus.SHIPPED,  // No IN_TRANSIT in enum — map to SHIPPED
      'intransit':              OrderStatus.SHIPPED,
      'out_for_delivery':       OrderStatus.SHIPPED,
      'outfordelivery':         OrderStatus.SHIPPED,

      // Shipped
      'shipped':                OrderStatus.SHIPPED,
      'dispatched':             OrderStatus.SHIPPED,

      // Delivered
      'delivered':              OrderStatus.DELIVERED,
      'completed':              OrderStatus.COMPLETED,
      'fulfilled':              OrderStatus.COMPLETED,
      'done':                   OrderStatus.COMPLETED,

      // Cancelled
      'cancelled':              OrderStatus.CANCELLED,
      'canceled':               OrderStatus.CANCELLED,
      'voided':                 OrderStatus.CANCELLED,

      // Refunded
      'refunded':               OrderStatus.REFUNDED,
      'returned':               OrderStatus.REFUNDED,

      // Restoring
      'restoring':              OrderStatus.RESTORING,
      'under_return':           OrderStatus.RESTORING,
      'return_in_progress':     OrderStatus.RESTORING,

      // Pending Payment
      'pending_payment':        OrderStatus.PENDING_PAYMENT,
      'awaiting_payment':       OrderStatus.PENDING_PAYMENT,
      'payment_pending':        OrderStatus.PENDING_PAYMENT,
      'payment_required':       OrderStatus.PENDING_PAYMENT,
      'pending':                OrderStatus.PENDING_PAYMENT,

      // On Hold
      'on_hold':                OrderStatus.ON_HOLD,
      'onhold':                 OrderStatus.ON_HOLD,
      'hold':                   OrderStatus.ON_HOLD,

      // Paid
      'paid':                   OrderStatus.PAID,
      'payment_confirmed':      OrderStatus.PAID,
      'payment_received':       OrderStatus.PAID,
    };

    // ─── المطابقة المباشرة ──────────────────────────────────────────────────
    if (STATUS_MAP[slug]) return STATUS_MAP[slug];
    if (STATUS_MAP[cleaned]) return STATUS_MAP[cleaned];

    // ─── المطابقة الجزئية ───────────────────────────────────────────────────
    for (const [key, status] of Object.entries(STATUS_MAP)) {
      if (slug.includes(key) || key.includes(slug)) return status;
    }

    // ─── Arabic text matching ────────────────────────────────────────────────
    const ARABIC_MAP: Array<{ patterns: string[]; status: OrderStatus }> = [
      { patterns: ['قيد التنفيذ', 'جاري التنفيذ', 'قيد المعالجة'],        status: OrderStatus.PROCESSING },
      { patterns: ['تم الشحن', 'شُحن'],                                    status: OrderStatus.SHIPPED },
      { patterns: ['تم التوصيل', 'وصل الطلب'],                             status: OrderStatus.DELIVERED },
      { patterns: ['تم الإلغاء', 'ملغي'],                                  status: OrderStatus.CANCELLED },
      { patterns: ['بانتظار الدفع', 'في انتظار الدفع'],                    status: OrderStatus.PENDING_PAYMENT },
      { patterns: ['جاهز للشحن'],                                           status: OrderStatus.READY_TO_SHIP },
      { patterns: ['جاري التوصيل', 'قيد التوصيل'],                         status: OrderStatus.SHIPPED },
      { patterns: ['بانتظار المراجعة', 'قيد المراجعة'],                    status: OrderStatus.UNDER_REVIEW },
      { patterns: ['قيد الاسترجاع', 'تم الاسترجاع'],                       status: OrderStatus.RESTORING },
      { patterns: ['تم التنفيذ', 'مكتمل'],                                  status: OrderStatus.COMPLETED },
    ];

    const cleanedArabic = cleanForMatch(statusStr);
    for (const { patterns, status } of ARABIC_MAP) {
      if (patterns.some(p => cleanedArabic.includes(cleanForMatch(p)))) {
        return status;
      }
    }

    this.logger.warn(`mapSallaOrderStatus: unknown status "${statusStr}" → defaulting to CREATED`);
    return OrderStatus.CREATED;
  }

  /**
   * تحويل slug + OrderStatus → triggerEvent
   * القاعدة: event واحد لكل حالة — لا aliases
   */
  mapStatusToSpecificEvent(_statusSlug: string, dbStatus: OrderStatus): string | null {
    // ─── Map مُوحَّد: DB status → triggerEvent ─────────────────────────────
    const DB_STATUS_TO_EVENT: Record<OrderStatus, string> = {
      [OrderStatus.CREATED]:          'order.created',
      [OrderStatus.PROCESSING]:       'order.status.processing',
      [OrderStatus.UNDER_REVIEW]:     'order.status.under_review',
      [OrderStatus.READY_TO_SHIP]:    'order.status.ready_to_ship',
      [OrderStatus.SHIPPED]:          'order.shipped',
      [OrderStatus.DELIVERED]:        'order.delivered',
      [OrderStatus.COMPLETED]:        'order.status.completed',
      [OrderStatus.CANCELLED]:        'order.cancelled',
      [OrderStatus.REFUNDED]:         'order.refunded',
      [OrderStatus.RESTORING]:        'order.status.restoring',
      [OrderStatus.PENDING_PAYMENT]:  'order.status.pending_payment',
      [OrderStatus.ON_HOLD]:          'order.status.on_hold',
      [OrderStatus.PAID]:             'order.status.paid',
      [OrderStatus.FAILED]:           'order.cancelled',  // FAILED = treated as cancelled for notifications
    };

    return DB_STATUS_TO_EVENT[dbStatus] ?? null;
  }
}
