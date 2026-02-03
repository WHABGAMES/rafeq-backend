/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates Controller                             ║
 * ║                                                                                ║
 * ║  📌 إدارة قوالب الرسائل (WhatsApp Templates, Quick Replies, etc.)              ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /templates              → قائمة القوالب                                ║
 * ║  POST   /templates              → إنشاء قالب جديد                              ║
 * ║  GET    /templates/:id          → تفاصيل قالب                                  ║
 * ║  PUT    /templates/:id          → تحديث قالب                                   ║
 * ║  DELETE /templates/:id          → حذف قالب                                     ║
 * ║  PATCH  /templates/:id/toggle   → تفعيل/تعطيل قالب                             ║
 * ║  GET    /templates/categories   → الفئات المتاحة                               ║
 * ║  POST   /templates/:id/duplicate → نسخ قالب                                    ║
 * ║  POST   /templates/whatsapp/submit → إرسال للموافقة من واتساب                  ║
 * ║  GET    /templates/whatsapp/status → حالة الموافقة                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateFiltersDto,
  SubmitWhatsAppTemplateDto,
} from './dto';

/**
 * Template Types
 */
export enum TemplateType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  INTERACTIVE = 'interactive',
  CAROUSEL = 'carousel',
}

export enum TemplateCategory {
  // WhatsApp Categories
  MARKETING = 'marketing',
  UTILITY = 'utility',
  AUTHENTICATION = 'authentication',
  // Custom Categories
  ORDER_CONFIRMATION = 'order_confirmation',
  SHIPPING_UPDATE = 'shipping_update',
  ABANDONED_CART = 'abandoned_cart',
  REVIEW_REQUEST = 'review_request',
  WELCOME = 'welcome',
  SUPPORT = 'support',
  PROMOTION = 'promotion',
  COD_CONFIRMATION = 'cod_confirmation',
  PAYMENT_REMINDER = 'payment_reminder',
  PRODUCT_RESTOCK = 'product_restock',
}

export enum TemplateStatus {
  DRAFT = 'draft',
  PENDING = 'pending',     // Pending WhatsApp approval
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

@ApiTags('Templates - قوالب الرسائل')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'templates',
  version: '1',
})
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /templates - قائمة القوالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'قائمة القوالب',
    description: 'جلب جميع قوالب الرسائل مع الفلترة والتصفح',
  })
  @ApiQuery({ name: 'type', required: false, enum: TemplateType })
  @ApiQuery({ name: 'category', required: false, enum: TemplateCategory })
  @ApiQuery({ name: 'status', required: false, enum: TemplateStatus })
  @ApiQuery({ name: 'channel', required: false, description: 'whatsapp, sms, email' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'قائمة القوالب' })
  async findAll(
    @CurrentUser() user: any,
    @Query('type') type?: TemplateType,
    @Query('category') category?: TemplateCategory,
    @Query('status') status?: TemplateStatus,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId; // TODO: من JWT
    
    const filters: TemplateFiltersDto = {
      type,
      category,
      status,
      channel,
      search,
    };

    return this.templatesService.findAll(tenantId, filters, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /templates/categories - الفئات المتاحة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('categories')
  @ApiOperation({
    summary: 'الفئات المتاحة',
    description: 'جلب جميع فئات القوالب مع الوصف',
  })
  getCategories() {
    return {
      categories: [
        {
          id: 'marketing',
          name: 'تسويقية',
          nameEn: 'Marketing',
          description: 'حملات ترويجية وعروض',
          icon: '📢',
          whatsappCategory: 'MARKETING',
        },
        {
          id: 'utility',
          name: 'خدمية',
          nameEn: 'Utility',
          description: 'إشعارات الطلبات والتحديثات',
          icon: '🔔',
          whatsappCategory: 'UTILITY',
        },
        {
          id: 'authentication',
          name: 'مصادقة',
          nameEn: 'Authentication',
          description: 'رموز OTP والتحقق',
          icon: '🔐',
          whatsappCategory: 'AUTHENTICATION',
        },
        {
          id: 'order_confirmation',
          name: 'تأكيد الطلب',
          nameEn: 'Order Confirmation',
          description: 'رسائل تأكيد الطلبات الجديدة',
          icon: '✅',
          whatsappCategory: 'UTILITY',
        },
        {
          id: 'shipping_update',
          name: 'تحديث الشحن',
          nameEn: 'Shipping Update',
          description: 'إشعارات حالة الشحن والتتبع',
          icon: '🚚',
          whatsappCategory: 'UTILITY',
        },
        {
          id: 'abandoned_cart',
          name: 'سلة متروكة',
          nameEn: 'Abandoned Cart',
          description: 'استرداد السلات المتروكة',
          icon: '🛒',
          whatsappCategory: 'MARKETING',
        },
        {
          id: 'review_request',
          name: 'طلب تقييم',
          nameEn: 'Review Request',
          description: 'طلب تقييم المنتج أو الخدمة',
          icon: '⭐',
          whatsappCategory: 'MARKETING',
        },
        {
          id: 'welcome',
          name: 'ترحيب',
          nameEn: 'Welcome',
          description: 'رسائل الترحيب بالعملاء الجدد',
          icon: '👋',
          whatsappCategory: 'MARKETING',
        },
        {
          id: 'support',
          name: 'دعم فني',
          nameEn: 'Support',
          description: 'رسائل الدعم الفني',
          icon: '💬',
          whatsappCategory: 'UTILITY',
        },
        {
          id: 'cod_confirmation',
          name: 'تأكيد الدفع عند الاستلام',
          nameEn: 'COD Confirmation',
          description: 'تأكيد طلبات الدفع عند الاستلام',
          icon: '💵',
          whatsappCategory: 'UTILITY',
        },
        {
          id: 'payment_reminder',
          name: 'تذكير بالدفع',
          nameEn: 'Payment Reminder',
          description: 'تذكير بالمدفوعات المستحقة',
          icon: '💳',
          whatsappCategory: 'UTILITY',
        },
        {
          id: 'product_restock',
          name: 'توفر المنتج',
          nameEn: 'Product Restock',
          description: 'إشعار بتوفر منتج',
          icon: '📦',
          whatsappCategory: 'MARKETING',
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /templates/variables - المتغيرات المتاحة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('variables')
  @ApiOperation({
    summary: 'المتغيرات المتاحة',
    description: 'قائمة المتغيرات التي يمكن استخدامها في القوالب',
  })
  getVariables() {
    return {
      variables: [
        // Customer Variables
        { key: '{{customer_name}}', label: 'اسم العميل', category: 'customer' },
        { key: '{{customer_first_name}}', label: 'الاسم الأول', category: 'customer' },
        { key: '{{customer_phone}}', label: 'رقم الجوال', category: 'customer' },
        { key: '{{customer_email}}', label: 'البريد الإلكتروني', category: 'customer' },
        
        // Order Variables
        { key: '{{order_id}}', label: 'رقم الطلب', category: 'order' },
        { key: '{{order_total}}', label: 'إجمالي الطلب', category: 'order' },
        { key: '{{order_status}}', label: 'حالة الطلب', category: 'order' },
        { key: '{{order_date}}', label: 'تاريخ الطلب', category: 'order' },
        { key: '{{order_items}}', label: 'منتجات الطلب', category: 'order' },
        { key: '{{order_tracking}}', label: 'رابط التتبع', category: 'order' },
        { key: '{{shipping_company}}', label: 'شركة الشحن', category: 'order' },
        { key: '{{delivery_date}}', label: 'تاريخ التوصيل المتوقع', category: 'order' },
        
        // Cart Variables
        { key: '{{cart_items}}', label: 'منتجات السلة', category: 'cart' },
        { key: '{{cart_total}}', label: 'إجمالي السلة', category: 'cart' },
        { key: '{{cart_link}}', label: 'رابط السلة', category: 'cart' },
        { key: '{{cart_item_count}}', label: 'عدد المنتجات', category: 'cart' },
        
        // Store Variables
        { key: '{{store_name}}', label: 'اسم المتجر', category: 'store' },
        { key: '{{store_phone}}', label: 'رقم المتجر', category: 'store' },
        { key: '{{store_url}}', label: 'رابط المتجر', category: 'store' },
        
        // Promotion Variables
        { key: '{{coupon_code}}', label: 'كود الخصم', category: 'promotion' },
        { key: '{{discount_percent}}', label: 'نسبة الخصم', category: 'promotion' },
        { key: '{{offer_expiry}}', label: 'تاريخ انتهاء العرض', category: 'promotion' },
        
        // Product Variables
        { key: '{{product_name}}', label: 'اسم المنتج', category: 'product' },
        { key: '{{product_price}}', label: 'سعر المنتج', category: 'product' },
        { key: '{{product_link}}', label: 'رابط المنتج', category: 'product' },
        { key: '{{product_image}}', label: 'صورة المنتج', category: 'product' },
        
        // OTP Variables
        { key: '{{otp_code}}', label: 'رمز التحقق', category: 'auth' },
        { key: '{{otp_expiry}}', label: 'صلاحية الرمز', category: 'auth' },

        // Shipping Variables
        { key: '{{tracking_number}}', label: 'رقم التتبع', category: 'order' },

        // Payment Variables
        { key: '{{payment_link}}', label: 'رابط الدفع', category: 'order' },

        // Product Extended Variables
        { key: '{{product_url}}', label: 'رابط المنتج', category: 'product' },
        { key: '{{product_quantity}}', label: 'الكمية المتبقية', category: 'product' },

        // Digital Product Variables
        { key: '{{download_link}}', label: 'رابط التحميل', category: 'product' },

        // Invoice Variables
        { key: '{{invoice_link}}', label: 'رابط الفاتورة', category: 'order' },

        // Promotion Extended Variables
        { key: '{{offer_end_date}}', label: 'تاريخ انتهاء العرض', category: 'promotion' },

        // Loyalty & Referral Variables
        { key: '{{loyalty_points}}', label: 'نقاط الولاء', category: 'customer' },
        { key: '{{referral_link}}', label: 'رابط الإحالة', category: 'customer' },
        { key: '{{referral_reward}}', label: 'مكافأة الإحالة', category: 'promotion' },

        // Store Extended Variables
        { key: '{{working_hours}}', label: 'ساعات العمل', category: 'store' },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /templates/presets - القوالب الجاهزة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('presets')
  @ApiOperation({
    summary: 'القوالب الجاهزة',
    description: 'قوالب معدة مسبقاً يمكن استخدامها مباشرة',
  })
  getPresets() {
    return {
      presets: [
        // ═══════════════════════════════════════════════════════════════
        // 📦 إشعارات الطلبات (Order Notifications)
        // ═══════════════════════════════════════════════════════════════
        {
          id: 'order_new',
          name: 'طلب جديد',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.created',
          content: 'مرحباً {{customer_name}} 👋\n\nتم استلام طلبك رقم #{{order_id}} بنجاح ✅\n\nإجمالي الطلب: {{order_total}} ريال\n\nشكراً لتسوقك من {{store_name}} 🛍️',
          buttons: [
            { type: 'url', text: 'تتبع الطلب', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'order_cod_confirmation',
          name: 'تأكيد الدفع عند الاستلام',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.created',
          content: 'مرحباً {{customer_name}} 👋\n\nلديك طلب جديد رقم #{{order_id}} بقيمة {{order_total}} ريال\n\nطريقة الدفع: الدفع عند الاستلام 💵\n\nهل تؤكد طلبك؟',
          buttons: [
            { type: 'quick_reply', text: 'نعم، أؤكد ✅' },
            { type: 'quick_reply', text: 'إلغاء الطلب ❌' },
          ],
        },
        {
          id: 'order_payment_confirmed',
          name: 'تأكيد الدفع',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.payment.updated',
          content: 'مرحباً {{customer_name}} 💳\n\nتم تأكيد الدفع لطلبك رقم #{{order_id}} بنجاح ✅\n\nالمبلغ المدفوع: {{order_total}} ريال\n\nجاري تجهيز طلبك الآن 📦',
          buttons: [
            { type: 'url', text: 'تفاصيل الطلب', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'order_processing',
          name: 'طلب قيد التنفيذ',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.status.updated',
          content: 'مرحباً {{customer_name}} ⚙️\n\nطلبك رقم #{{order_id}} قيد التجهيز الآن\n\nفريقنا يعمل على تجهيز طلبك بأسرع وقت ممكن ⏳\n\nسنُبلغك فور شحن الطلب 📦',
          buttons: [],
        },
        {
          id: 'order_completed',
          name: 'طلب تم التنفيذ',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.status.updated',
          content: 'مرحباً {{customer_name}} ✅\n\nتم تنفيذ طلبك رقم #{{order_id}} بنجاح!\n\nسيتم تسليمه لشركة الشحن قريباً 🚚\n\nشكراً لثقتك في {{store_name}} 💙',
          buttons: [
            { type: 'url', text: 'تتبع الطلب', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'order_awaiting_payment',
          name: 'طلب بانتظار الدفع',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.created',
          content: 'مرحباً {{customer_name}} ⏰\n\nطلبك رقم #{{order_id}} بانتظار إتمام الدفع\n\nالمبلغ المطلوب: {{order_total}} ريال\n\nأكمل الدفع الآن لتأكيد طلبك 💳',
          buttons: [
            { type: 'url', text: 'أكمل الدفع', url: '{{payment_link}}' },
          ],
        },
        {
          id: 'order_awaiting_review',
          name: 'طلب بانتظار المراجعة',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.status.updated',
          content: 'مرحباً {{customer_name}} 📋\n\nطلبك رقم #{{order_id}} قيد المراجعة من فريقنا\n\nسيتم تأكيد الطلب وإشعارك في أقرب وقت ⏳\n\nشكراً لصبرك 🙏',
          buttons: [],
        },
        {
          id: 'order_cancelled',
          name: 'طلب ملغي',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.cancelled',
          content: 'مرحباً {{customer_name}} ❌\n\nتم إلغاء طلبك رقم #{{order_id}}\n\nإذا كان الإلغاء بالخطأ أو تحتاج مساعدة، لا تتردد بالتواصل معنا 📞\n\nفريق {{store_name}} في خدمتك دائماً 💙',
          buttons: [
            { type: 'url', text: 'تواصل معنا', url: '{{store_url}}/contact' },
          ],
        },
        {
          id: 'order_refunded',
          name: 'طلب مسترجع',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.refunded',
          content: 'مرحباً {{customer_name}} 💰\n\nتم قبول طلب استرجاع الطلب رقم #{{order_id}}\n\nسيتم إعادة المبلغ {{order_total}} ريال خلال 5-14 يوم عمل\n\nنأسف لأي إزعاج ونتمنى رؤيتك مجدداً 🙏',
          buttons: [
            { type: 'url', text: 'تسوق مجدداً', url: '{{store_url}}' },
          ],
        },
        {
          id: 'order_return_processing',
          name: 'طلب قيد الاسترجاع',
          language: 'ar',
          category: 'order_notifications',
          triggerEvent: 'order.status.updated',
          content: 'مرحباً {{customer_name}} 🔄\n\nطلب الاسترجاع للطلب رقم #{{order_id}} قيد المعالجة\n\nسنقوم بمراجعته وإشعارك بالنتيجة خلال 2-3 أيام عمل ⏳',
          buttons: [],
        },

        // ═══════════════════════════════════════════════════════════════
        // 🚚 إشعارات الشحن (Shipping Notifications)
        // ═══════════════════════════════════════════════════════════════
        {
          id: 'shipping_created',
          name: 'إنشاء بوليصة الشحن',
          language: 'ar',
          category: 'shipping_notifications',
          triggerEvent: 'shipment.created',
          content: 'مرحباً {{customer_name}} 📋\n\nتم إصدار بوليصة شحن لطلبك رقم #{{order_id}}\n\nرقم التتبع: {{tracking_number}}\nشركة الشحن: {{shipping_company}}\n\nسنُبلغك فور تحرك الشحنة 🚚',
          buttons: [
            { type: 'url', text: 'تتبع الشحنة', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'shipping_shipped',
          name: 'تم الشحن',
          language: 'ar',
          category: 'shipping_notifications',
          triggerEvent: 'order.shipped',
          content: 'مرحباً {{customer_name}} 📦\n\nتم شحن طلبك رقم #{{order_id}} 🎉\n\nشركة الشحن: {{shipping_company}}\nرقم التتبع: {{tracking_number}}\nالتوصيل المتوقع: {{delivery_date}}\n\nتتبع شحنتك من الرابط أدناه 👇',
          buttons: [
            { type: 'url', text: 'تتبع الشحنة', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'shipping_out_for_delivery',
          name: 'جاري التوصيل',
          language: 'ar',
          category: 'shipping_notifications',
          triggerEvent: 'tracking.refreshed',
          content: 'مرحباً {{customer_name}} 🚚💨\n\nطلبك رقم #{{order_id}} في الطريق إليك الآن!\n\nالمندوب سيصلك اليوم، يرجى التأكد من توفرك لاستلام الطلب 📱\n\nفي حال عدم التواجد، يرجى التواصل مع شركة الشحن',
          buttons: [
            { type: 'url', text: 'تتبع المندوب', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'shipping_delivered',
          name: 'تم التوصيل',
          language: 'ar',
          category: 'shipping_notifications',
          triggerEvent: 'order.delivered',
          content: 'مرحباً {{customer_name}} 🎉\n\nتم توصيل طلبك رقم #{{order_id}} بنجاح ✅\n\nنتمنى أن تنال المنتجات إعجابك!\n\nشاركنا رأيك وقيّم تجربتك ⭐',
          buttons: [
            { type: 'url', text: 'قيّم تجربتك', url: '{{store_url}}/reviews' },
          ],
        },

        // ═══════════════════════════════════════════════════════════════
        // 🛒 استرداد المبيعات (Sales Recovery)
        // ═══════════════════════════════════════════════════════════════
        {
          id: 'cart_abandoned_1',
          name: 'سلة متروكة - التذكير الأول',
          language: 'ar',
          category: 'sales_recovery',
          triggerEvent: 'abandoned.cart',
          content: 'مرحباً {{customer_name}} 👋\n\nلاحظنا أنك تركت بعض المنتجات في سلتك 🛒\n\nلا تفوت الفرصة! أكمل طلبك الآن واستمتع بمنتجاتك المفضلة\n\nإجمالي السلة: {{cart_total}} ريال',
          buttons: [
            { type: 'url', text: 'أكمل الطلب', url: '{{cart_link}}' },
          ],
        },
        {
          id: 'cart_abandoned_2',
          name: 'سلة متروكة - مع كوبون خصم',
          language: 'ar',
          category: 'sales_recovery',
          triggerEvent: 'abandoned.cart',
          content: 'مرحباً {{customer_name}} 🎁\n\nسلتك لا زالت بانتظارك! لأنك مميز، جهزنا لك خصم حصري 🎉\n\nاستخدم كود: {{coupon_code}}\nواحصل على خصم {{discount_percent}}% على سلتك\n\nالعرض لفترة محدودة ⏰',
          buttons: [
            { type: 'url', text: 'استفد من الخصم', url: '{{cart_link}}' },
          ],
        },
        {
          id: 'cart_abandoned_3',
          name: 'سلة متروكة - التذكير الأخير',
          language: 'ar',
          category: 'sales_recovery',
          triggerEvent: 'abandoned.cart',
          content: 'مرحباً {{customer_name}} ⏰\n\nآخر فرصة! منتجاتك في السلة قد تنفد قريباً\n\nإجمالي السلة: {{cart_total}} ريال\n\nلا تفوّت العرض، الكمية محدودة! 🔥',
          buttons: [
            { type: 'url', text: 'اطلب الآن', url: '{{cart_link}}' },
          ],
        },
        {
          id: 'payment_reminder',
          name: 'تذكير بالدفع',
          language: 'ar',
          category: 'sales_recovery',
          triggerEvent: 'order.created',
          content: 'مرحباً {{customer_name}} 💳\n\nتذكير: طلبك رقم #{{order_id}} بانتظار إتمام الدفع\n\nالمبلغ: {{order_total}} ريال\n\nسيتم إلغاء الطلب تلقائياً إذا لم يتم الدفع خلال 24 ساعة ⏰',
          buttons: [
            { type: 'url', text: 'ادفع الآن', url: '{{payment_link}}' },
          ],
        },
        {
          id: 'product_restock',
          name: 'إعادة توفر منتج',
          language: 'ar',
          category: 'sales_recovery',
          triggerEvent: 'product.available',
          content: 'مرحباً {{customer_name}} 🔔\n\nخبر سار! المنتج الذي كنت تنتظره عاد للمخزون ✅\n\n{{product_name}}\nالسعر: {{product_price}} ريال\n\nاطلبه الآن قبل نفاد الكمية! 🏃',
          buttons: [
            { type: 'url', text: 'اطلب الآن', url: '{{product_url}}' },
          ],
        },

        // ═══════════════════════════════════════════════════════════════
        // 📢 التسويق والحملات (Marketing & Campaigns)
        // ═══════════════════════════════════════════════════════════════
        {
          id: 'welcome_new_customer',
          name: 'ترحيب بعميل جديد',
          language: 'ar',
          category: 'marketing',
          triggerEvent: 'customer.created',
          content: 'أهلاً وسهلاً {{customer_name}} 🎉\n\nمرحباً بك في {{store_name}}!\n\nنحن سعداء بانضمامك إلينا. استمتع بتجربة تسوق مميزة واكتشف أحدث المنتجات\n\nاستخدم كود {{coupon_code}} واحصل على خصم {{discount_percent}}% على أول طلب 🎁',
          buttons: [
            { type: 'url', text: 'تسوق الآن', url: '{{store_url}}' },
          ],
        },
        {
          id: 'welcome_series_2',
          name: 'سلسلة الترحيب - تعرف علينا',
          language: 'ar',
          category: 'marketing',
          triggerEvent: 'customer.created',
          content: 'مرحباً {{customer_name}} 💙\n\nهل تعلم أن {{store_name}} يوفر لك:\n\n✨ منتجات أصلية 100%\n🚚 توصيل سريع\n🔄 إرجاع مجاني خلال 14 يوم\n💬 دعم فوري على واتساب\n\nاكتشف الأكثر مبيعاً لدينا 🔥',
          buttons: [
            { type: 'url', text: 'الأكثر مبيعاً', url: '{{store_url}}/best-sellers' },
          ],
        },
        {
          id: 'promotion_offer',
          name: 'عرض وتخفيض',
          language: 'ar',
          category: 'marketing',
          triggerEvent: null,
          content: 'مرحباً {{customer_name}} 🔥\n\nعرض حصري من {{store_name}}!\n\nخصم يصل إلى {{discount_percent}}% على منتجات مختارة 🎉\n\nالعرض ساري حتى {{offer_end_date}}\n\nلا تفوّت الفرصة! ⏰',
          buttons: [
            { type: 'url', text: 'تسوق العروض', url: '{{store_url}}/offers' },
          ],
        },
        {
          id: 'coupon_exclusive',
          name: 'كوبون خصم حصري',
          language: 'ar',
          category: 'marketing',
          triggerEvent: null,
          content: 'مرحباً {{customer_name}} 🎁\n\nلأنك من عملائنا المميزين، جهزنا لك كوبون خصم حصري!\n\nالكود: {{coupon_code}}\nالخصم: {{discount_percent}}%\nصالح حتى: {{offer_end_date}}\n\nاستخدمه الآن! 🛍️',
          buttons: [
            { type: 'url', text: 'استخدم الكوبون', url: '{{store_url}}' },
          ],
        },
        {
          id: 'new_product_launch',
          name: 'منتج جديد',
          language: 'ar',
          category: 'marketing',
          triggerEvent: 'product.created',
          content: 'مرحباً {{customer_name}} ✨\n\nوصل جديد لمتجر {{store_name}}!\n\n{{product_name}}\nالسعر: {{product_price}} ريال\n\nكن من أوائل المقتنين 🏆',
          buttons: [
            { type: 'url', text: 'اطلع على المنتج', url: '{{product_url}}' },
          ],
        },
        {
          id: 'winback_inactive',
          name: 'استرداد عميل غير نشط',
          language: 'ar',
          category: 'marketing',
          triggerEvent: null,
          content: 'مرحباً {{customer_name}} 💙\n\nاشتقنا لك في {{store_name}}! 🥺\n\nمر وقت من آخر زيارة لك، ووددنا نطمن عليك\n\nجهزنا لك خصم خاص: {{coupon_code}} بقيمة {{discount_percent}}%\n\nعود لنا! 🙏',
          buttons: [
            { type: 'url', text: 'تسوق الآن', url: '{{store_url}}' },
          ],
        },
        {
          id: 'post_purchase_upsell',
          name: 'توصيات بعد الشراء',
          language: 'ar',
          category: 'marketing',
          triggerEvent: 'order.delivered',
          content: 'مرحباً {{customer_name}} 🌟\n\nنأمل أنك استمتعت بمشترياتك من {{store_name}}!\n\nبناءً على طلبك السابق، نعتقد أنك ستحب هذه المنتجات أيضاً 👇\n\nاكتشف المزيد واستمتع بتجربة تسوق مميزة ✨',
          buttons: [
            { type: 'url', text: 'منتجات مقترحة', url: '{{store_url}}/recommended' },
          ],
        },

        // ═══════════════════════════════════════════════════════════════
        // ⭐ التفاعل والولاء (Engagement & Loyalty)
        // ═══════════════════════════════════════════════════════════════
        {
          id: 'review_request',
          name: 'طلب تقييم',
          language: 'ar',
          category: 'engagement',
          triggerEvent: 'order.delivered',
          content: 'مرحباً {{customer_name}} ⭐\n\nنأمل أنك استمتعت بتجربتك مع {{store_name}}!\n\nرأيك يهمنا كثيراً، شاركنا تقييمك للمنتجات\n\nتقييمك يساعدنا نقدم لك الأفضل دائماً 💙',
          buttons: [
            { type: 'url', text: 'قيّم الآن', url: '{{store_url}}/reviews' },
          ],
        },
        {
          id: 'review_reward',
          name: 'مكافأة التقييم',
          language: 'ar',
          category: 'engagement',
          triggerEvent: 'review.added',
          content: 'شكراً {{customer_name}} على تقييمك! ⭐\n\nنقدّر وقتك ورأيك القيّم 🙏\n\nكمكافأة لك، استخدم كود: {{coupon_code}}\nواحصل على خصم {{discount_percent}}% على طلبك القادم 🎁\n\nشكراً لثقتك في {{store_name}} 💙',
          buttons: [
            { type: 'url', text: 'تسوق بالخصم', url: '{{store_url}}' },
          ],
        },
        {
          id: 'loyalty_points',
          name: 'نقاط الولاء',
          language: 'ar',
          category: 'engagement',
          triggerEvent: null,
          content: 'مرحباً {{customer_name}} 🏆\n\nرصيد نقاطك في {{store_name}}: {{loyalty_points}} نقطة\n\nاستبدل نقاطك بخصومات حصرية على مشترياتك القادمة!\n\nاستمر بالتسوق واجمع المزيد من النقاط ✨',
          buttons: [
            { type: 'url', text: 'استبدل نقاطك', url: '{{store_url}}/loyalty' },
          ],
        },
        {
          id: 'referral_invite',
          name: 'دعوة إحالة صديق',
          language: 'ar',
          category: 'engagement',
          triggerEvent: null,
          content: 'مرحباً {{customer_name}} 🤝\n\nشارك تجربتك مع أصدقائك واحصل على مكافأة!\n\nرابط الإحالة الخاص بك:\n{{referral_link}}\n\nعن كل صديق يسجل ويشتري، تحصل على {{referral_reward}} ريال رصيد 🎉',
          buttons: [
            { type: 'url', text: 'شارك الرابط', url: '{{referral_link}}' },
          ],
        },

        // ═══════════════════════════════════════════════════════════════
        // 🔧 رسائل الخدمة (Service & Utility)
        // ═══════════════════════════════════════════════════════════════
        {
          id: 'otp_verification',
          name: 'رمز التحقق OTP',
          language: 'ar',
          category: 'service',
          triggerEvent: 'customer.otp.request',
          content: 'رمز التحقق الخاص بك: {{otp_code}} 🔐\n\nصالح لمدة 5 دقائق\n\nإذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة',
          buttons: [],
        },
        {
          id: 'digital_product_delivery',
          name: 'تسليم منتج رقمي',
          language: 'ar',
          category: 'service',
          triggerEvent: 'order.payment.updated',
          content: 'مرحباً {{customer_name}} 📱\n\nتم تأكيد دفعك بنجاح! إليك منتجك الرقمي:\n\nطلب رقم: #{{order_id}}\n\nيمكنك تحميل المنتج من الرابط أدناه 👇\n\nشكراً لتسوقك من {{store_name}} 💙',
          buttons: [
            { type: 'url', text: 'تحميل المنتج', url: '{{download_link}}' },
          ],
        },
        {
          id: 'after_hours_reply',
          name: 'رد خارج أوقات العمل',
          language: 'ar',
          category: 'service',
          triggerEvent: null,
          content: 'مرحباً {{customer_name}} 🌙\n\nشكراً لتواصلك مع {{store_name}}\n\nنحن خارج أوقات العمل حالياً\nساعات العمل: {{working_hours}}\n\nسنرد على رسالتك في أقرب وقت ممكن ⏰\n\nشكراً لصبرك 🙏',
          buttons: [],
        },
        {
          id: 'low_stock_alert',
          name: 'تنبيه نفاد المخزون',
          language: 'ar',
          category: 'service',
          triggerEvent: 'product.quantity.low',
          content: '⚠️ تنبيه مخزون - {{store_name}}\n\nالمنتج: {{product_name}}\nالكمية المتبقية: {{product_quantity}} قطعة\n\nيرجى إعادة تعبئة المخزون لتجنب نفاد المنتج 📦',
          buttons: [],
        },
        {
          id: 'invoice_created',
          name: 'فاتورة جديدة',
          language: 'ar',
          category: 'service',
          triggerEvent: 'invoice.created',
          content: 'مرحباً {{customer_name}} 🧾\n\nتم إصدار فاتورة جديدة لطلبك رقم #{{order_id}}\n\nالمبلغ: {{order_total}} ريال\n\nيمكنك تحميل الفاتورة من الرابط أدناه 👇',
          buttons: [
            { type: 'url', text: 'تحميل الفاتورة', url: '{{invoice_link}}' },
          ],
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /templates - إنشاء قالب جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post()
  @ApiOperation({
    summary: 'إنشاء قالب جديد',
    description: 'إنشاء قالب رسالة جديد (نصي، صورة، فيديو، تفاعلي)',
  })
  @ApiResponse({ status: 201, description: 'تم إنشاء القالب' })
  async create(@CurrentUser() user: any,
    @Body() dto: CreateTemplateDto) {
    const tenantId = user.tenantId;
    return this.templatesService.create(tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /templates/:id - تفاصيل قالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @ApiOperation({
    summary: 'تفاصيل قالب',
    description: 'جلب تفاصيل قالب معين مع إحصائيات الاستخدام',
  })
  @ApiParam({ name: 'id', description: 'معرف القالب' })
  @ApiResponse({ status: 200, description: 'تفاصيل القالب' })
  @ApiResponse({ status: 404, description: 'القالب غير موجود' })
  async findOne(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.templatesService.findById(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PUT /templates/:id - تحديث قالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Put(':id')
  @ApiOperation({
    summary: 'تحديث قالب',
    description: 'تحديث محتوى أو إعدادات قالب',
  })
  @ApiResponse({ status: 200, description: 'تم التحديث' })
  async update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    const tenantId = user.tenantId;
    return this.templatesService.update(id, tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE /templates/:id - حذف قالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'حذف قالب',
    description: 'حذف قالب نهائياً (لا يمكن التراجع)',
  })
  @ApiResponse({ status: 204, description: 'تم الحذف' })
  async remove(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.templatesService.delete(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PATCH /templates/:id/toggle - تفعيل/تعطيل قالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Patch(':id/toggle')
  @ApiOperation({
    summary: 'تفعيل/تعطيل قالب',
    description: 'تبديل حالة القالب بين نشط ومعطل',
  })
  @ApiResponse({ status: 200, description: 'تم تغيير الحالة' })
  async toggle(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.templatesService.toggle(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /templates/:id/duplicate - نسخ قالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/duplicate')
  @ApiOperation({
    summary: 'نسخ قالب',
    description: 'إنشاء نسخة من قالب موجود',
  })
  @ApiResponse({ status: 201, description: 'تم نسخ القالب' })
  async duplicate(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string },
  ) {
    const tenantId = user.tenantId;
    return this.templatesService.duplicate(id, tenantId, body.name);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /templates/:id/test - اختبار قالب
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'اختبار قالب',
    description: 'إرسال رسالة اختبارية للتأكد من القالب',
  })
  async test(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { phone: string; variables?: Record<string, string> },
  ) {
    const tenantId = user.tenantId;
    return this.templatesService.sendTest(id, tenantId, body.phone, body.variables);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // WhatsApp Template Management
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('whatsapp/submit')
  @ApiOperation({
    summary: 'إرسال قالب للموافقة',
    description: 'إرسال قالب WhatsApp لمراجعة Meta',
  })
  async submitWhatsAppTemplate(@CurrentUser() user: any,
    @Body() dto: SubmitWhatsAppTemplateDto) {
    const tenantId = user.tenantId;
    return this.templatesService.submitToWhatsApp(tenantId, dto);
  }

  @Get('whatsapp/status')
  @ApiOperation({
    summary: 'حالة قوالب WhatsApp',
    description: 'جلب حالة الموافقة على قوالب WhatsApp',
  })
  async getWhatsAppTemplatesStatus(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.templatesService.getWhatsAppTemplatesStatus(tenantId);
  }

  @Post('whatsapp/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'مزامنة قوالب WhatsApp',
    description: 'مزامنة القوالب مع WhatsApp Business API',
  })
  async syncWhatsAppTemplates(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.templatesService.syncWithWhatsApp(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Statistics
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/stats')
  @ApiOperation({
    summary: 'إحصائيات القالب',
    description: 'عدد مرات الاستخدام، معدل القراءة، معدل النقر',
  })
  async getStats(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.templatesService.getStats(id, tenantId);
  }
}
