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
        {
          id: 'order_confirmation_ar',
          name: 'تأكيد الطلب',
          language: 'ar',
          category: 'order_confirmation',
          content: 'مرحباً {{customer_name}} 👋\n\nتم استلام طلبك رقم #{{order_id}} بنجاح ✅\n\nإجمالي الطلب: {{order_total}} ريال\n\nشكراً لتسوقك من {{store_name}} 🛍️',
          buttons: [
            { type: 'url', text: 'تتبع الطلب', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'abandoned_cart_ar',
          name: 'سلة متروكة',
          language: 'ar',
          category: 'abandoned_cart',
          content: 'مرحباً {{customer_name}} 👋\n\nلاحظنا أنك تركت بعض المنتجات في سلتك 🛒\n\nلا تفوت الفرصة! أكمل طلبك الآن واستمتع بمنتجاتك المفضلة.\n\nإجمالي السلة: {{cart_total}} ريال',
          buttons: [
            { type: 'url', text: 'أكمل الطلب', url: '{{cart_link}}' },
          ],
        },
        {
          id: 'shipping_update_ar',
          name: 'تحديث الشحن',
          language: 'ar',
          category: 'shipping_update',
          content: 'مرحباً {{customer_name}} 📦\n\nتم شحن طلبك رقم #{{order_id}}\n\nشركة الشحن: {{shipping_company}}\nالتوصيل المتوقع: {{delivery_date}}\n\nيمكنك تتبع شحنتك من الرابط أدناه 👇',
          buttons: [
            { type: 'url', text: 'تتبع الشحنة', url: '{{order_tracking}}' },
          ],
        },
        {
          id: 'review_request_ar',
          name: 'طلب تقييم',
          language: 'ar',
          category: 'review_request',
          content: 'مرحباً {{customer_name}} ⭐\n\nنأمل أنك استمتعت بتجربتك مع {{store_name}}!\n\nرأيك يهمنا، شاركنا تقييمك للمنتجات واحصل على خصم {{discount_percent}}% على طلبك القادم 🎁',
          buttons: [
            { type: 'url', text: 'قيّم الآن', url: '{{store_url}}/reviews' },
          ],
        },
        {
          id: 'cod_confirmation_ar',
          name: 'تأكيد الدفع عند الاستلام',
          language: 'ar',
          category: 'cod_confirmation',
          content: 'مرحباً {{customer_name}} 👋\n\nلديك طلب جديد رقم #{{order_id}} بقيمة {{order_total}} ريال\n\nطريقة الدفع: الدفع عند الاستلام 💵\n\nهل تؤكد طلبك؟',
          buttons: [
            { type: 'quick_reply', text: 'نعم، أؤكد ✅' },
            { type: 'quick_reply', text: 'إلغاء الطلب ❌' },
          ],
        },
        {
          id: 'welcome_ar',
          name: 'ترحيب بعميل جديد',
          language: 'ar',
          category: 'welcome',
          content: 'أهلاً وسهلاً {{customer_name}} 🎉\n\nمرحباً بك في {{store_name}}!\n\nنحن سعداء بانضمامك إلينا. استمتع بتجربة تسوق مميزة واكتشف أحدث المنتجات.\n\nاستخدم كود {{coupon_code}} واحصل على خصم {{discount_percent}}% على أول طلب 🎁',
          buttons: [
            { type: 'url', text: 'تسوق الآن', url: '{{store_url}}' },
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
