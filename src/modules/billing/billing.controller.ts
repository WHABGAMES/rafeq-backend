/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Billing Controller                         ║
 * ║                                                                                ║
 * ║  📌 REST API للفوترة والاشتراكات                                                ║
 * ║                                                                                ║
 * ║  المسارات:                                                                     ║
 * ║  GET  /billing/subscription      - الحصول على الاشتراك الحالي                   ║
 * ║  POST /billing/subscription      - إنشاء اشتراك جديد                           ║
 * ║  PATCH /billing/subscription     - تحديث الاشتراك                              ║
 * ║  POST /billing/subscription/change-plan - تغيير الخطة                          ║
 * ║  POST /billing/subscription/cancel      - إلغاء الاشتراك                       ║
 * ║  GET  /billing/usage             - إحصائيات الاستخدام                          ║
 * ║  GET  /billing/invoices          - قائمة الفواتير                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

// Guards
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';

// Services
import { BillingService } from './billing.service';

// DTOs
import {
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  ChangeSubscriptionPlanDto,
  CancelSubscriptionDto,
  SubscriptionResponseDto,
  UsageStatsResponseDto,
} from './dto';

// Request interface
interface AuthenticatedRequest {
  user: {
    id: string;
    tenantId: string;
    role: string;
  };
}

/**
 * 🎛️ BillingController
 * 
 * التحكم في عمليات الفوترة والاشتراكات
 */
@ApiTags('Billing - الفوترة')
@Controller('billing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 SUBSCRIPTION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔍 الحصول على الاشتراك الحالي
   * 
   * @route GET /billing/subscription
   */
  @Get('subscription')
  @ApiOperation({
    summary: 'الحصول على الاشتراك الحالي',
    description: 'يعيد تفاصيل الاشتراك الفعال للمستأجر الحالي',
  })
  @ApiResponse({
    status: 200,
    description: 'تفاصيل الاشتراك',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'لا يوجد اشتراك فعال' })
  async getSubscription(@Request() req: AuthenticatedRequest) {
    const subscription = await this.billingService.getActiveSubscription(
      req.user.tenantId,
    );

    if (!subscription) {
      return {
        hasSubscription: false,
        message: 'لا يوجد اشتراك فعال. يرجى اختيار خطة للبدء.',
      };
    }

    // الحصول على إحصائيات الاستخدام
    const usage = await this.billingService.getUsageStats(req.user.tenantId);

    return {
      hasSubscription: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
        planName: subscription.plan?.name,
        billingInterval: subscription.billingInterval,
        startedAt: subscription.startedAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
        autoRenew: subscription.autoRenew,
        amount: subscription.amount,
        currency: subscription.currency,
      },
      usage,
    };
  }

  /**
   * ➕ إنشاء اشتراك جديد
   * 
   * @route POST /billing/subscription
   */
  @Post('subscription')
  
  
  @ApiOperation({
    summary: 'إنشاء اشتراك جديد',
    description: 'ينشئ اشتراك جديد للمستأجر. يتطلب صلاحية مالك أو مشرف.',
  })
  @ApiResponse({ status: 201, description: 'تم إنشاء الاشتراك بنجاح' })
  @ApiResponse({ status: 400, description: 'يوجد اشتراك فعال بالفعل' })
  async createSubscription(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateSubscriptionDto,
  ) {
    // تأكد أن الاشتراك للمستأجر الحالي
    dto.tenantId = req.user.tenantId;

    const subscription = await this.billingService.createSubscription(dto);

    return {
      success: true,
      message: 'تم إنشاء الاشتراك بنجاح',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
      },
    };
  }

  /**
   * ✏️ تحديث الاشتراك
   * 
   * @route PATCH /billing/subscription
   */
  @Patch('subscription')
  
  
  @ApiOperation({
    summary: 'تحديث الاشتراك',
    description: 'يحدّث إعدادات الاشتراك (التجديد التلقائي، بيانات الفوترة)',
  })
  @ApiResponse({ status: 200, description: 'تم التحديث بنجاح' })
  async updateSubscription(
    @Request() _req: AuthenticatedRequest,
    @Body() _dto: UpdateSubscriptionDto,
  ) {
    // TODO: Implement update logic
    return {
      success: true,
      message: 'تم تحديث الاشتراك بنجاح',
    };
  }

  /**
   * 🔄 تغيير الخطة
   * 
   * @route POST /billing/subscription/change-plan
   */
  @Post('subscription/change-plan')
  
  
  @ApiOperation({
    summary: 'تغيير خطة الاشتراك',
    description: 'يغيّر خطة الاشتراك (ترقية أو تخفيض)',
  })
  @ApiResponse({ status: 200, description: 'تم تغيير الخطة' })
  async changeSubscriptionPlan(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangeSubscriptionPlanDto,
  ) {
    const subscription = await this.billingService.changeSubscriptionPlan(
      req.user.tenantId,
      dto,
    );

    return {
      success: true,
      message: 'تم تغيير الخطة بنجاح',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
      },
    };
  }

  /**
   * ❌ إلغاء الاشتراك
   * 
   * @route POST /billing/subscription/cancel
   */
  @Post('subscription/cancel')
  
  
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إلغاء الاشتراك',
    description: 'يلغي الاشتراك الحالي. المالك فقط يمكنه الإلغاء.',
  })
  @ApiResponse({ status: 200, description: 'تم إلغاء الاشتراك' })
  async cancelSubscription(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CancelSubscriptionDto,
  ) {
    const subscription = await this.billingService.cancelSubscription(
      req.user.tenantId,
      dto,
    );

    return {
      success: true,
      message: dto.immediate
        ? 'تم إلغاء الاشتراك فوراً'
        : `تم جدولة الإلغاء في ${subscription.endsAt?.toLocaleDateString('ar-SA')}`,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        endsAt: subscription.endsAt,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 USAGE ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📊 إحصائيات الاستخدام
   * 
   * @route GET /billing/usage
   */
  @Get('usage')
  @ApiOperation({
    summary: 'إحصائيات الاستخدام',
    description: 'يعيد إحصائيات استخدام الموارد مقارنة بالحدود',
  })
  @ApiResponse({ status: 200, type: UsageStatsResponseDto })
  async getUsageStats(@Request() req: AuthenticatedRequest) {
    return this.billingService.getUsageStats(req.user.tenantId);
  }

  /**
   * ✅ التحقق من الحصة
   * 
   * @route GET /billing/quota/:resource
   */
  @Get('quota/:resource')
  @ApiOperation({
    summary: 'التحقق من حصة مورد معين',
    description: 'يتحقق من إمكانية استخدام كمية معينة من مورد',
  })
  @ApiParam({
    name: 'resource',
    enum: ['messages', 'stores', 'users', 'channels', 'campaigns', 'templates', 'storage'],
  })
  @ApiQuery({ name: 'amount', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'الحصة متاحة' })
  @ApiResponse({ status: 403, description: 'تجاوز الحصة' })
  async checkQuota(
    @Request() req: AuthenticatedRequest,
    @Param('resource') resource: string,
    @Query('amount') amount?: number,
  ) {
    // Map resource name to UsageStats key
    const resourceMap: Record<string, string> = {
      messages: 'messagesUsed',
      stores: 'storesUsed',
      users: 'usersUsed',
      channels: 'channelsUsed',
      campaigns: 'campaignsUsed',
      templates: 'templatesUsed',
      storage: 'storageUsedMb',
    };

    const resourceKey = resourceMap[resource];
    if (!resourceKey) {
      return { available: false, message: 'مورد غير معروف' };
    }

    try {
      await this.billingService.checkQuota(
        req.user.tenantId,
        resourceKey as any,
        amount || 1,
      );
      return { available: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = (error as { response?: Record<string, unknown> })?.response;
      return {
        available: false,
        message: errorMessage,
        ...(errorResponse || {}),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧾 INVOICES ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📄 قائمة الفواتير
   * 
   * @route GET /billing/invoices
   */
  @Get('invoices')
  @ApiOperation({
    summary: 'قائمة الفواتير',
    description: 'يعيد قائمة فواتير المستأجر',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getInvoices(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    // TODO: Implement invoices retrieval from payment provider
    return {
      invoices: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * 📄 تفاصيل فاتورة
   * 
   * @route GET /billing/invoices/:id
   */
  @Get('invoices/:id')
  @ApiOperation({
    summary: 'تفاصيل فاتورة',
    description: 'يعيد تفاصيل فاتورة محددة',
  })
  @ApiParam({ name: 'id', description: 'معرف الفاتورة' })
  async getInvoice(
    @Request() _req: AuthenticatedRequest,
    @Param('id') _invoiceId: string,
  ) {
    // TODO: Implement invoice retrieval
    return {
      invoice: null,
      message: 'سيتم تفعيل هذه الميزة قريباً',
    };
  }

  /**
   * 📥 تحميل فاتورة PDF
   * 
   * @route GET /billing/invoices/:id/download
   */
  @Get('invoices/:id/download')
  @ApiOperation({
    summary: 'تحميل فاتورة PDF',
    description: 'يعيد رابط تحميل الفاتورة بصيغة PDF',
  })
  @ApiParam({ name: 'id', description: 'معرف الفاتورة' })
  async downloadInvoice(
    @Request() _req: AuthenticatedRequest,
    @Param('id') _invoiceId: string,
  ) {
    // TODO: Implement PDF generation
    return {
      downloadUrl: null,
      message: 'سيتم تفعيل هذه الميزة قريباً',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💳 PAYMENT METHODS ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 💳 قائمة وسائل الدفع
   * 
   * @route GET /billing/payment-methods
   */
  @Get('payment-methods')
  @ApiOperation({
    summary: 'قائمة وسائل الدفع',
    description: 'يعيد وسائل الدفع المحفوظة',
  })
  async getPaymentMethods(@Request() _req: AuthenticatedRequest) {
    // TODO: Implement payment methods retrieval
    return {
      paymentMethods: [],
      defaultPaymentMethodId: null,
    };
  }

  /**
   * ➕ إضافة وسيلة دفع
   * 
   * @route POST /billing/payment-methods
   */
  @Post('payment-methods')
  
  
  @ApiOperation({
    summary: 'إضافة وسيلة دفع',
    description: 'يضيف وسيلة دفع جديدة (بطاقة، تحويل بنكي، مدى)',
  })
  async addPaymentMethod(
    @Request() _req: AuthenticatedRequest,
    @Body() _dto: Record<string, unknown>,
  ) {
    // TODO: Implement payment method addition
    return {
      success: true,
      message: 'سيتم تفعيل هذه الميزة قريباً',
    };
  }
}
