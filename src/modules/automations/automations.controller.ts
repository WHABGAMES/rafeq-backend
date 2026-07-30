/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Automations Controller                           ║
 * ║                                                                                ║
 * ║  📌 إدارة الأتمتة والـ Workflows والمحفزات                                      ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  === Automations ===                                                          ║
 * ║  GET    /automations                  → قائمة الأتمتات                         ║
 * ║  POST   /automations                  → إنشاء أتمتة                            ║
 * ║  GET    /automations/:id              → تفاصيل أتمتة                           ║
 * ║  PUT    /automations/:id              → تحديث أتمتة                            ║
 * ║  DELETE /automations/:id              → حذف أتمتة                              ║
 * ║  POST   /automations/:id/activate     → تفعيل                                  ║
 * ║  POST   /automations/:id/deactivate   → تعطيل                                  ║
 * ║                                                                                ║
 * ║  === Workflows ===                                                            ║
 * ║  GET    /automations/workflows        → قائمة الـ Workflows                    ║
 * ║  POST   /automations/workflows        → إنشاء Workflow                         ║
 * ║  GET    /automations/workflows/:id    → تفاصيل Workflow                        ║
 * ║  PUT    /automations/workflows/:id    → تحديث Workflow                         ║
 * ║  DELETE /automations/workflows/:id    → حذف Workflow                           ║
 * ║                                                                                ║
 * ║  === Triggers ===                                                             ║
 * ║  GET    /automations/triggers         → قائمة المحفزات المتاحة                  ║
 * ║  GET    /automations/actions          → قائمة الإجراءات المتاحة                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AutomationsService } from './automations.service';
import {
  CreateAutomationDto,
  UpdateAutomationDto,
  CreateWorkflowDto,
  UpdateWorkflowDto,
} from './dto';

@ApiTags('Automations - الأتمتة والـ Workflows')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'automations',
  version: '1',
})
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Available Triggers & Actions
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('triggers')
  @ApiOperation({
    summary: 'المحفزات المتاحة',
    description: 'قائمة جميع المحفزات التي يمكن استخدامها في الأتمتة',
  })
  getTriggers() {
    return {
      triggers: [
        // E-commerce Triggers (Salla/Zid)
        {
          id: 'order.created',
          name: 'طلب جديد',
          nameEn: 'New Order',
          category: 'orders',
          icon: '🛒',
          description: 'عند إنشاء طلب جديد',
          variables: ['order_id', 'order_total', 'customer_name', 'customer_phone'],
        },
        {
          id: 'order.status_updated',
          name: 'تحديث حالة الطلب',
          nameEn: 'Order Status Updated',
          category: 'orders',
          icon: '📦',
          description: 'عند تغيير حالة الطلب',
          variables: ['order_id', 'old_status', 'new_status'],
          conditions: ['status'],
        },
        {
          id: 'order.shipped',
          name: 'شحن الطلب',
          nameEn: 'Order Shipped',
          category: 'orders',
          icon: '🚚',
          description: 'عند شحن الطلب',
          variables: ['order_id', 'tracking_number', 'shipping_company'],
        },
        {
          id: 'order.delivered',
          name: 'توصيل الطلب',
          nameEn: 'Order Delivered',
          category: 'orders',
          icon: '✅',
          description: 'عند توصيل الطلب',
          variables: ['order_id', 'delivery_date'],
        },
        {
          id: 'order.cancelled',
          name: 'إلغاء الطلب',
          nameEn: 'Order Cancelled',
          category: 'orders',
          icon: '❌',
          description: 'عند إلغاء الطلب',
          variables: ['order_id', 'cancel_reason'],
        },
        {
          id: 'abandoned_cart',
          name: 'سلة متروكة',
          nameEn: 'Abandoned Cart',
          category: 'cart',
          icon: '🛒',
          description: 'عند ترك سلة بدون إكمال الشراء',
          variables: ['cart_total', 'cart_items', 'cart_link'],
          timing: { delay: '1h', maxDelay: '72h' },
        },
        {
          id: 'cod_order',
          name: 'طلب دفع عند الاستلام',
          nameEn: 'COD Order',
          category: 'orders',
          icon: '💵',
          description: 'عند إنشاء طلب بالدفع عند الاستلام',
          variables: ['order_id', 'order_total'],
        },
        
        // Customer Triggers
        {
          id: 'customer.created',
          name: 'عميل جديد',
          nameEn: 'New Customer',
          category: 'customers',
          icon: '👤',
          description: 'عند تسجيل عميل جديد',
          variables: ['customer_name', 'customer_phone', 'customer_email'],
        },
        {
          id: 'customer.first_order',
          name: 'أول طلب للعميل',
          nameEn: 'Customer First Order',
          category: 'customers',
          icon: '🎉',
          description: 'عند إنشاء أول طلب للعميل',
          variables: ['customer_name', 'order_id'],
        },
        
        // Conversation Triggers
        {
          id: 'conversation.created',
          name: 'محادثة جديدة',
          nameEn: 'New Conversation',
          category: 'inbox',
          icon: '💬',
          description: 'عند بدء محادثة جديدة',
          variables: ['customer_name', 'channel'],
        },
        {
          id: 'message.received',
          name: 'رسالة جديدة',
          nameEn: 'New Message',
          category: 'inbox',
          icon: '📩',
          description: 'عند استلام رسالة جديدة',
          variables: ['message_text', 'customer_name'],
          conditions: ['contains_keyword', 'channel'],
        },
        {
          id: 'message.keyword',
          name: 'كلمة مفتاحية',
          nameEn: 'Keyword Detected',
          category: 'inbox',
          icon: '🔑',
          description: 'عند اكتشاف كلمة مفتاحية في الرسالة',
          variables: ['keyword', 'message_text'],
        },
        {
          id: 'conversation.idle',
          name: 'محادثة خاملة',
          nameEn: 'Idle Conversation',
          category: 'inbox',
          icon: '⏰',
          description: 'عند عدم الرد لفترة معينة',
          timing: { delay: '5m', maxDelay: '24h' },
        },
        
        // Review Triggers
        {
          id: 'review.added',
          name: 'تقييم جديد',
          nameEn: 'New Review',
          category: 'reviews',
          icon: '⭐',
          description: 'عند إضافة تقييم جديد',
          variables: ['rating', 'review_text', 'product_name'],
        },
        
        // Product Triggers
        {
          id: 'product.low_stock',
          name: 'انخفاض المخزون',
          nameEn: 'Low Stock',
          category: 'products',
          icon: '📉',
          description: 'عند انخفاض مخزون منتج',
          variables: ['product_name', 'current_stock'],
        },
        {
          id: 'product.restocked',
          name: 'إعادة التخزين',
          nameEn: 'Product Restocked',
          category: 'products',
          icon: '📦',
          description: 'عند إعادة تخزين منتج',
          variables: ['product_name'],
        },
        
        // Scheduled Triggers
        {
          id: 'schedule.daily',
          name: 'جدولة يومية',
          nameEn: 'Daily Schedule',
          category: 'schedule',
          icon: '📅',
          description: 'تشغيل يومي في وقت محدد',
        },
        {
          id: 'schedule.weekly',
          name: 'جدولة أسبوعية',
          nameEn: 'Weekly Schedule',
          category: 'schedule',
          icon: '📆',
          description: 'تشغيل أسبوعي في يوم ووقت محدد',
        },
      ],
    };
  }

  @Get('actions')
  @ApiOperation({
    summary: 'الإجراءات المتاحة',
    description: 'قائمة جميع الإجراءات التي يمكن تنفيذها',
  })
  getActions() {
    return {
      actions: [
        // Messaging Actions
        {
          id: 'send_whatsapp',
          name: 'إرسال رسالة واتساب',
          nameEn: 'Send WhatsApp Message',
          category: 'messaging',
          icon: '📱',
          inputs: ['template_id', 'variables'],
        },
        {
          id: 'send_sms',
          name: 'إرسال SMS',
          nameEn: 'Send SMS',
          category: 'messaging',
          icon: '📲',
          inputs: ['message', 'variables'],
        },
        {
          id: 'send_email',
          name: 'إرسال بريد إلكتروني',
          nameEn: 'Send Email',
          category: 'messaging',
          icon: '📧',
          inputs: ['template_id', 'subject', 'variables'],
        },
        
        // Conversation Actions
        {
          id: 'assign_conversation',
          name: 'تعيين المحادثة',
          nameEn: 'Assign Conversation',
          category: 'inbox',
          icon: '👤',
          inputs: ['user_id', 'team_id'],
        },
        {
          id: 'add_tag',
          name: 'إضافة تصنيف',
          nameEn: 'Add Tag',
          category: 'inbox',
          icon: '🏷️',
          inputs: ['tag'],
        },
        {
          id: 'set_priority',
          name: 'تعيين الأولوية',
          nameEn: 'Set Priority',
          category: 'inbox',
          icon: '🔥',
          inputs: ['priority'],
        },
        {
          id: 'close_conversation',
          name: 'إغلاق المحادثة',
          nameEn: 'Close Conversation',
          category: 'inbox',
          icon: '✅',
        },
        
        // Customer Actions
        {
          id: 'update_contact',
          name: 'تحديث بيانات العميل',
          nameEn: 'Update Contact',
          category: 'crm',
          icon: '📝',
          inputs: ['fields'],
        },
        {
          id: 'add_to_segment',
          name: 'إضافة إلى شريحة',
          nameEn: 'Add to Segment',
          category: 'crm',
          icon: '📊',
          inputs: ['segment_id'],
        },
        
        // Delay Actions
        {
          id: 'delay',
          name: 'انتظار',
          nameEn: 'Wait/Delay',
          category: 'flow',
          icon: '⏱️',
          inputs: ['duration', 'unit'],
        },
        {
          id: 'condition',
          name: 'شرط',
          nameEn: 'Condition',
          category: 'flow',
          icon: '🔀',
          inputs: ['conditions'],
        },
        
        // Integration Actions
        {
          id: 'webhook',
          name: 'إرسال Webhook',
          nameEn: 'Send Webhook',
          category: 'integrations',
          icon: '🔗',
          inputs: ['url', 'method', 'headers', 'body'],
        },
        {
          id: 'http_request',
          name: 'طلب HTTP',
          nameEn: 'HTTP Request',
          category: 'integrations',
          icon: '🌐',
          inputs: ['url', 'method', 'headers', 'body'],
        },
        
        // Notification Actions
        {
          id: 'notify_team',
          name: 'إشعار الفريق',
          nameEn: 'Notify Team',
          category: 'notifications',
          icon: '🔔',
          inputs: ['message', 'users'],
        },
      ],
    };
  }

  @Get('presets')
  @ApiOperation({
    summary: 'أتمتات جاهزة',
    description: 'قوالب أتمتة معدة مسبقاً يمكن استخدامها مباشرة',
  })
  getPresets() {
    return {
      presets: [
        {
          id: 'abandoned_cart_recovery',
          name: 'استرداد السلات المتروكة',
          description: 'إرسال 3 تذكيرات للسلات المتروكة',
          trigger: 'abandoned_cart',
          popularity: 98,
        },
        {
          id: 'order_confirmation',
          name: 'تأكيد الطلب',
          description: 'إرسال رسالة تأكيد فورية',
          trigger: 'order.created',
          popularity: 95,
        },
        {
          id: 'shipping_notification',
          name: 'إشعار الشحن',
          description: 'إرسال رابط التتبع عند الشحن',
          trigger: 'order.shipped',
          popularity: 92,
        },
        {
          id: 'review_request',
          name: 'طلب تقييم',
          description: 'طلب تقييم بعد التوصيل',
          trigger: 'order.delivered',
          popularity: 85,
        },
        {
          id: 'cod_confirmation',
          name: 'تأكيد COD',
          description: 'تأكيد طلبات الدفع عند الاستلام',
          trigger: 'cod_order',
          popularity: 88,
        },
        {
          id: 'welcome_message',
          name: 'رسالة ترحيب',
          description: 'ترحيب بالعملاء الجدد',
          trigger: 'customer.created',
          popularity: 80,
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Automations CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'قائمة الأتمتات',
    description: 'جلب جميع الأتمتات المنشأة',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'draft'] })
  @ApiQuery({ name: 'trigger', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('trigger') trigger?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.automationsService.findAll(tenantId, { status, trigger }, { page, limit });
  }

  @Post()
  @ApiOperation({
    summary: 'إنشاء أتمتة',
    description: 'إنشاء أتمتة جديدة',
  })
  async create(@CurrentUser() user: any,
    @Body() dto: CreateAutomationDto) {
    const tenantId = user.tenantId;
    return this.automationsService.create(tenantId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل أتمتة' })
  async findOne(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.automationsService.findById(id, tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث أتمتة' })
  async update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    const tenantId = user.tenantId;
    return this.automationsService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف أتمتة' })
  async remove(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.automationsService.delete(id, tenantId);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'تفعيل أتمتة' })
  async activate(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.automationsService.activate(id, tenantId);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'تعطيل أتمتة' })
  async deactivate(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.automationsService.deactivate(id, tenantId);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'سجلات الأتمتة' })
  async getLogs(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    const tenantId = user.tenantId;
    return this.automationsService.getLogs(id, tenantId, { page, limit });
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'إحصائيات الأتمتة' })
  async getStats(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.automationsService.getStats(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Workflows
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('workflows')
  @ApiOperation({
    summary: 'قائمة الـ Workflows',
    description: 'الـ Workflows هي سلاسل أتمتة متقدمة بخطوات متعددة',
  })
  async getWorkflows(
    @CurrentUser() user: any,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.automationsService.getWorkflows(tenantId, { page, limit });
  }

  @Post('workflows')
  @ApiOperation({ summary: 'إنشاء Workflow' })
  async createWorkflow(@CurrentUser() user: any,
    @Body() dto: CreateWorkflowDto) {
    const tenantId = user.tenantId;
    return this.automationsService.createWorkflow(tenantId, dto);
  }

  @Get('workflows/:id')
  @ApiOperation({ summary: 'تفاصيل Workflow' })
  async getWorkflow(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.automationsService.getWorkflowById(id, tenantId);
  }

  @Put('workflows/:id')
  @ApiOperation({ summary: 'تحديث Workflow' })
  async updateWorkflow(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    const tenantId = user.tenantId;
    return this.automationsService.updateWorkflow(id, tenantId, dto);
  }

  @Delete('workflows/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف Workflow' })
  async deleteWorkflow(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.automationsService.deleteWorkflow(id, tenantId);
  }
}
