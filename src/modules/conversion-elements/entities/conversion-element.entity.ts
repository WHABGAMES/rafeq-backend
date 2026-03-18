/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Conversion Element Entity                            ║
 * ║                                                                                ║
 * ║  Core entity for all CRO widgets: Social Proof, Urgency, Upsell,             ║
 * ║  Smart Offers, Spin Wheel, WhatsApp CTA, Lead Forms, etc.                    ║
 * ║                                                                                ║
 * ║  Architecture:                                                                 ║
 * ║  - Each element is modular and self-contained                                 ║
 * ║  - Settings stored as typed JSONB for flexibility                             ║
 * ║  - Multi-tenant: strict store_id + tenant_id isolation                        ║
 * ║  - Platform-agnostic: works across Salla, Zid, Shopify                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

// ─── Element Types ──────────────────────────────────────────────
export enum ElementType {
  // تحسين معدل التحويل
  SOCIAL_PROOF      = 'social_proof',         // تنبيه بعمليات الشراء
  URGENCY_COUNTDOWN = 'urgency_countdown',    // عد تنازلي
  URGENCY_SCARCITY  = 'urgency_scarcity',     // إعلان المنتج (عدد المشاهدين)
  UPSELL            = 'upsell',               // اقتراحات ذكية
  CROSS_SELL        = 'cross_sell',           // منتجات يتم شراؤها معاً
  FREE_SHIPPING_BAR = 'free_shipping_bar',    // شريط الشحن المجاني
  STICKY_ATC        = 'sticky_atc',           // زر أضف للسلة ثابت
  PAGE_VISITORS     = 'page_visitors',        // زوار الصفحة اليوم
  VISITORS_BAR      = 'visitors_bar',         // شريط زوار الموقع
  LIVE_ORDERS       = 'live_orders',          // عدد الطلبات الآن
  // التخفيضات والعروض
  SMART_OFFER       = 'smart_offer',          // تنبيه الخصم
  SPIN_WHEEL        = 'spin_wheel',           // عجلة الحظ
  ANNOUNCEMENT_BAR  = 'announcement_bar',     // شريط القسائم
  COUPON_WIDGET     = 'coupon_widget',        // كوبون خصم
  DISCOUNT_BAR      = 'discount_bar',         // شريط الخصم
  COUPON_ALERT      = 'coupon_alert',         // تنبيه القسائم
  // زيادة التفاعل
  WHATSAPP_CTA      = 'whatsapp_cta',         // تواصل معنا (واتساب)
  WHATSAPP_BAR      = 'whatsapp_bar',         // شريط واتساب
  LEAD_FORM         = 'lead_form',            // طلب عرض سعر
  STORE_STORIES     = 'store_stories',        // قصص المتجر التفاعلية
  MINI_STORIES      = 'mini_stories',         // قصص مصغّرة تفاعلية
  // تحسين خدمة العملاء
  TRUST_BADGES      = 'trust_badges',         // شارات الثقة
  REVIEWS_WIDGET    = 'reviews_widget',       // آراء العملاء
  COOKIE_POLICY     = 'cookie_policy',        // سياسة الكوكيز
  ASK_PRODUCT       = 'ask_product',          // اسألنا عن المنتج
  RATE_US           = 'rate_us',              // قيّمنا
  CUSTOMER_SATISFACTION = 'customer_satisfaction', // رضا العملاء
  // التسويق والمبيعات
  NEWSLETTER        = 'newsletter',           // النشرة البريدية
  MOBILE_SUBSCRIBE  = 'mobile_subscribe',     // اشتراك الجوال
}

// ─── Display Position ───────────────────────────────────────────
export enum ElementPosition {
  TOP_BAR         = 'top_bar',
  BOTTOM_BAR      = 'bottom_bar',
  BOTTOM_RIGHT    = 'bottom_right',
  BOTTOM_LEFT     = 'bottom_left',
  CENTER_MODAL    = 'center_modal',
  SLIDE_IN_RIGHT  = 'slide_in_right',
  SLIDE_IN_LEFT   = 'slide_in_left',
  INLINE          = 'inline',             // داخل المحتوى
  FLOATING        = 'floating',
}

// ─── Trigger Type ───────────────────────────────────────────────
export enum TriggerType {
  IMMEDIATE       = 'immediate',           // فوري
  DELAY           = 'delay',               // بعد X ثانية
  SCROLL          = 'scroll',              // عند التمرير %
  EXIT_INTENT     = 'exit_intent',         // عند محاولة الخروج
  ADD_TO_CART     = 'add_to_cart',         // عند الإضافة للسلة
  CART_VALUE      = 'cart_value',          // عند وصول قيمة السلة
  PAGE_VIEW_COUNT = 'page_view_count',     // بعد X صفحات
  INACTIVITY      = 'inactivity',          // بعد عدم تفاعل
}

// ─── Element Status ─────────────────────────────────────────────
export enum ElementStatus {
  DRAFT    = 'draft',
  ACTIVE   = 'active',
  PAUSED   = 'paused',
  ARCHIVED = 'archived',
  SCHEDULED = 'scheduled',
}

// ─── Targeting Types ────────────────────────────────────────────
export interface ElementTargeting {
  // Visitor type
  visitorType?: 'all' | 'new' | 'returning' | 'customer';

  // Page targeting
  pages?: {
    type: 'all' | 'include' | 'exclude';
    urls?: string[];        // URL patterns
    pageTypes?: string[];   // 'product', 'cart', 'home', 'category', 'checkout'
  };

  // Product targeting
  products?: {
    type: 'all' | 'specific' | 'category';
    ids?: string[];
    categories?: string[];
    tags?: string[];
    priceRange?: { min?: number; max?: number };
  };

  // Cart targeting
  cart?: {
    minValue?: number;
    maxValue?: number;
    minItems?: number;
    maxItems?: number;
    containsProducts?: string[];
  };

  // Geo targeting
  geo?: {
    countries?: string[];
    cities?: string[];
  };

  // Traffic source
  source?: {
    type: 'all' | 'include' | 'exclude';
    sources?: string[];     // 'google', 'facebook', 'instagram', 'direct', 'email'
    utmCampaign?: string[];
    utmMedium?: string[];
  };

  // Device targeting
  device?: {
    type: 'all' | 'mobile' | 'desktop' | 'tablet';
  };

  // Schedule
  schedule?: {
    startDate?: string;     // ISO date
    endDate?: string;
    daysOfWeek?: number[];  // 0-6
    startTime?: string;     // HH:mm
    endTime?: string;
  };
}

// ─── Behavior / Display Rules ───────────────────────────────────
export interface ElementBehavior {
  trigger: TriggerType;
  triggerValue?: number;           // delay seconds, scroll %, cart value, etc.

  // Display frequency
  frequency?: {
    type: 'always' | 'once' | 'once_per_session' | 'every_x_hours' | 'every_x_days';
    value?: number;
  };

  // Close behavior
  closeOnClick?: boolean;
  closeAfterSeconds?: number;
  closeOnOverlayClick?: boolean;

  // Animation
  enterAnimation?: 'fade' | 'slide_up' | 'slide_down' | 'slide_left' | 'slide_right' | 'zoom' | 'bounce';
  exitAnimation?: 'fade' | 'slide_down' | 'slide_up' | 'zoom_out';
  animationDuration?: number;       // ms

  // Priority (higher = shown first when multiple elements qualify)
  priority?: number;
}

// ─── Content Settings (per element type) ────────────────────────
export interface ElementContent {
  // Common
  title?: string;
  subtitle?: string;
  description?: string;
  bodyText?: string;
  imageUrl?: string;
  iconType?: string;

  // Button
  button?: {
    text: string;
    url?: string;
    action?: 'link' | 'close' | 'add_to_cart' | 'whatsapp' | 'custom';
    bgColor?: string;
    textColor?: string;
    hoverBgColor?: string;
    hoverTextColor?: string;
    fontSize?: number;
    borderRadius?: number;
  };

  // Secondary button
  secondaryButton?: {
    text: string;
    url?: string;
    action?: string;
    bgColor?: string;
    textColor?: string;
  };

  // Type-specific content
  socialProof?: {
    messageTemplate: string;       // "{name} اشترى {product} منذ {time}"
    showRealData: boolean;
    fakePurchaseInterval?: number; // seconds between fake notifications
    displayDuration?: number;      // seconds to show each notification
    maxPerSession?: number;
  };

  urgency?: {
    endDate?: string;              // ISO date
    countdownFormat: 'days_hours_minutes' | 'hours_minutes_seconds';
    expiredMessage?: string;
    showDays?: boolean;
  };

  scarcity?: {
    currentStock?: number;
    showExact?: boolean;           // "بقي 3" vs "بقي أقل من 5"
    threshold?: number;            // show only when stock < threshold
    warningColor?: string;
  };

  upsell?: {
    strategy: 'manual' | 'ai' | 'bestsellers' | 'related';
    productIds?: string[];
    maxProducts?: number;
    discountPercent?: number;
    discountCode?: string;
  };

  spinWheel?: {
    segments: Array<{
      label: string;
      discount?: number;
      discountType?: 'percent' | 'fixed';
      couponCode?: string;
      probability: number;        // 0-100
      color?: string;
    }>;
    collectEmail?: boolean;
    collectPhone?: boolean;
  };

  leadForm?: {
    fields: Array<{
      name: string;
      type: 'text' | 'email' | 'phone' | 'select' | 'textarea';
      label: string;
      placeholder?: string;
      required?: boolean;
      options?: string[];          // for select
    }>;
    submitText?: string;
    successMessage?: string;
  };

  freeShipping?: {
    threshold: number;
    currency?: string;
    progressBarColor?: string;
    completedMessage?: string;
  };

  whatsapp?: {
    phone: string;
    prefilledMessage?: string;
    agentName?: string;
    agentAvatar?: string;
    onlineMessage?: string;
    offlineMessage?: string;
  };

  announcement?: {
    text: string;
    linkText?: string;
    linkUrl?: string;
    dismissible?: boolean;
    scrolling?: boolean;
  };
}

// ─── Design / Style Settings ────────────────────────────────────
export interface ElementDesign {
  // Colors
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
  borderColor?: string;
  overlayColor?: string;         // for modals
  overlayOpacity?: number;

  // Typography
  titleFontSize?: number;
  bodyFontSize?: number;
  fontFamily?: string;
  fontWeight?: number;

  // Spacing
  padding?: string;              // CSS value
  margin?: string;
  borderRadius?: number;
  maxWidth?: number;

  // Shadow
  boxShadow?: string;

  // Custom CSS
  customCSS?: string;

  // RTL
  direction?: 'rtl' | 'ltr' | 'auto';

  // Z-index
  zIndex?: number;
}

// ═══════════════════════════════════════════════════════════════════
// ENTITY
// ═══════════════════════════════════════════════════════════════════

@Entity('conversion_elements')
@Index(['storeId', 'status'])
@Index(['storeId', 'type'])
@Index(['tenantId'])
@Index(['status', 'type'])
export class ConversionElement extends BaseEntity {

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // ─── Element Identity ─────────────────────────────────────────
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: ElementType,
    comment: 'نوع العنصر',
  })
  type: ElementType;

  @Column({
    type: 'enum',
    enum: ElementStatus,
    default: ElementStatus.DRAFT,
  })
  status: ElementStatus;

  // ─── Position & Display ───────────────────────────────────────
  @Column({
    type: 'enum',
    enum: ElementPosition,
    default: ElementPosition.BOTTOM_RIGHT,
  })
  position: ElementPosition;

  // ─── JSONB Settings ───────────────────────────────────────────
  @Column({ type: 'jsonb', default: {} })
  content: ElementContent;

  @Column({ type: 'jsonb', default: {} })
  design: ElementDesign;

  @Column({ type: 'jsonb', default: {} })
  behavior: ElementBehavior;

  @Column({ type: 'jsonb', default: {} })
  targeting: ElementTargeting;

  // ─── A/B Testing ──────────────────────────────────────────────
  @Column({ name: 'ab_test_id', type: 'uuid', nullable: true })
  abTestId?: string;

  @Column({ name: 'variant_label', type: 'varchar', length: 10, nullable: true })
  variantLabel?: string;          // 'A' | 'B'

  // ─── Cached Counters (materialized for fast reads) ────────────
  @Column({ name: 'total_views', type: 'integer', default: 0 })
  totalViews: number;

  @Column({ name: 'total_clicks', type: 'integer', default: 0 })
  totalClicks: number;

  @Column({ name: 'total_conversions', type: 'integer', default: 0 })
  totalConversions: number;

  @Column({ name: 'total_revenue', type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalRevenue: number;

  // ─── Scheduling ───────────────────────────────────────────────
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt?: Date;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt?: Date;

  // ─── Platform (which store platform injected this) ────────────
  @Column({ name: 'platform', type: 'varchar', length: 20, nullable: true })
  platform?: string;              // 'salla' | 'zid' | 'shopify'
}
