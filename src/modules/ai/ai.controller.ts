/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Controller (Production v2)                    ║
 * ║                                                                                ║
 * ║  ✅ يمرر storeId من x-store-id header (مثل settings.controller.ts)           ║
 * ║  ✅ جميع الـ endpoints متوافقة مع ai.service.ts v2                             ║
 * ║  ✅ knowledge CRUD كامل (GET, POST, PUT, DELETE)                               ║
 * ║                                                                                ║
 * ║  GET  /ai/settings           → جلب إعدادات البوت                              ║
 * ║  PUT  /ai/settings           → تحديث إعدادات البوت                            ║
 * ║  GET  /ai/knowledge          → قاعدة المعرفة                                   ║
 * ║  POST /ai/knowledge          → إضافة معرفة                                     ║
 * ║  PUT  /ai/knowledge/:id      → تحديث معرفة                                     ║
 * ║  DELETE /ai/knowledge/:id    → حذف معرفة                                       ║
 * ║  POST /ai/respond            → إنشاء رد على رسالة                             ║
 * ║  POST /ai/analyze            → تحليل رسالة                                     ║
 * ║  GET  /ai/stats              → إحصائيات                                        ║
 * ║  GET  /ai/analytics          → تحليلات مفصلة                                   ║
 * ║  POST /ai/test               → اختبار رد البوت                                 ║
 * ║  POST /ai/train              → تدريب البوت                                     ║
 * ║  GET  /ai/training-status    → حالة التدريب                                    ║
 * ║  GET  /ai/intents            → قائمة النوايا المدعومة                           ║
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
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { AIService, SearchPriority } from './ai.service';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
} from 'class-validator';

// ═══════════════════════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════════════════════

class RespondDto {
  @IsString()
  conversationId: string;

  @IsString()
  message: string;
}

class AnalyzeDto {
  @IsString()
  message: string;
}

class TestResponseDto {
  @IsString()
  message: string;
}

class UpdateAISettingsDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsString()
  model?: string;

  @IsOptional() @IsNumber()
  temperature?: number;

  @IsOptional() @IsNumber()
  maxTokens?: number;

  @IsOptional() @IsString()
  language?: 'ar' | 'en' | 'auto';

  @IsOptional() @IsString()
  tone?: 'formal' | 'friendly' | 'professional';

  @IsOptional() @IsBoolean()
  autoHandoff?: boolean;

  @IsOptional() @IsNumber()
  handoffAfterFailures?: number;

  @IsOptional() @IsArray()
  handoffKeywords?: string[];

  @IsOptional() @IsEnum(SearchPriority)
  searchPriority?: SearchPriority;

  @IsOptional() @IsBoolean()
  silenceOnHandoff?: boolean;

  @IsOptional() @IsNumber()
  silenceDurationMinutes?: number;

  @IsOptional() @IsBoolean()
  silenceOnAgentOpen?: boolean;

  @IsOptional() @IsNumber()
  silenceAfterAgentMinutes?: number;

  @IsOptional() @IsArray()
  handoffNotifyEmployeeIds?: string[];

  @IsOptional() @IsArray()
  handoffNotifyPhones?: string[];

  @IsOptional() @IsArray()
  handoffNotifyEmails?: string[];

  @IsOptional() @IsString()
  storeName?: string;

  @IsOptional() @IsString()
  storeDescription?: string;

  @IsOptional() @IsString()
  workingHours?: string;

  @IsOptional() @IsString()
  returnPolicy?: string;

  @IsOptional() @IsString()
  shippingInfo?: string;

  @IsOptional() @IsString()
  welcomeMessage?: string;

  @IsOptional() @IsString()
  fallbackMessage?: string;

  @IsOptional() @IsString()
  handoffMessage?: string;
}

class AddKnowledgeDto {
  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsArray()
  keywords?: string[];

  @IsOptional() @IsNumber()
  priority?: number;
}

class UpdateKnowledgeDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  content?: string;

  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsArray()
  keywords?: string[];

  @IsOptional() @IsNumber()
  priority?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

class TrainBotDto {
  @IsOptional() @IsArray()
  faqs?: Array<{ question: string; answer: string }>;

  @IsOptional() @IsArray()
  documents?: Array<{ title: string; content: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@Controller({
  path: 'ai',
  version: '1',
})
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AIService) {}

  /**
   * ✅ نفس pattern الموجود في settings.controller.ts:
   * storeId يأتي من x-store-id header أو query param
   */
  private getStoreId(
    storeIdHeader?: string,
    storeIdQuery?: string,
  ): string | undefined {
    return storeIdHeader || storeIdQuery || undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AI SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('settings')
  @ApiOperation({ summary: 'جلب إعدادات البوت' })
  async getSettings(
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.aiService.getSettings(tenantId, storeId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'تحديث إعدادات البوت' })
  async updateSettings(
    @Req() req: any,
    @Body() dto: UpdateAISettingsDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.aiService.updateSettings(tenantId, storeId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('knowledge')
  @ApiOperation({ summary: 'جلب قاعدة المعرفة' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getKnowledge(
    @Req() req: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.aiService.getKnowledge(req.user.tenantId, { category, search });
  }

  @Post('knowledge')
  @ApiOperation({ summary: 'إضافة معرفة جديدة' })
  async addKnowledge(
    @Req() req: any,
    @Body() dto: AddKnowledgeDto,
  ) {
    return this.aiService.addKnowledge(req.user.tenantId, dto);
  }

  @Put('knowledge/:id')
  @ApiOperation({ summary: 'تحديث معرفة' })
  async updateKnowledge(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeDto,
  ) {
    return this.aiService.updateKnowledge(req.user.tenantId, id, dto);
  }

  @Delete('knowledge/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف معرفة' })
  async deleteKnowledge(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.aiService.deleteKnowledge(req.user.tenantId, id);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRAINING (يحول إلى knowledge base entries)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('train')
  @ApiOperation({ summary: 'تدريب البوت' })
  async trainBot(
    @Req() req: any,
    @Body() dto: TrainBotDto,
  ) {
    return this.aiService.trainBot(req.user.tenantId, dto);
  }

  @Get('training-status')
  @ApiOperation({ summary: 'حالة التدريب' })
  async getTrainingStatus(@Req() req: any) {
    return this.aiService.getTrainingStatus(req.user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('analytics')
  @ApiOperation({ summary: 'تحليلات أداء البوت' })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'week', 'month'] })
  async getAnalytics(
    @Req() req: any,
    @Query('period') period = 'week',
  ) {
    return this.aiService.getAnalytics(req.user.tenantId, period);
  }

  @Get('stats')
  @ApiOperation({ summary: 'إحصائيات الـ AI' })
  async getStats(@Req() req: any) {
    return this.aiService.getStats(req.user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESPOND & TEST
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إنشاء رد على رسالة' })
  @ApiResponse({ status: 200, description: 'الرد المولّد' })
  async respond(
    @Req() req: any,
    @Body() dto: RespondDto,
  ) {
    return this.aiService.generateResponse({
      tenantId: req.user.tenantId,
      conversationId: dto.conversationId,
      message: dto.message,
    });
  }

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تحليل رسالة (intent + sentiment)' })
  async analyze(@Body() dto: AnalyzeDto) {
    return this.aiService.analyzeMessage(dto.message);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اختبار رد البوت (بدون حفظ)' })
  async testResponse(
    @Req() req: any,
    @Body() dto: TestResponseDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.aiService.testResponse(
      req.user.tenantId,
      dto.message,
      storeId,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INTENTS LIST
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('intents')
  @ApiOperation({ summary: 'قائمة النوايا المدعومة' })
  getIntents() {
    return {
      intents: [
        { id: 'order_status', name: 'حالة الطلب', examples: ['أين طلبي؟', 'متى يصل طلبي؟'] },
        { id: 'order_cancel', name: 'إلغاء الطلب', examples: ['أريد إلغاء طلبي'] },
        { id: 'product_inquiry', name: 'استفسار عن منتج', examples: ['هل المنتج متوفر؟', 'كم سعر المنتج؟'] },
        { id: 'shipping_info', name: 'معلومات الشحن', examples: ['كم رسوم الشحن؟', 'متى التوصيل؟'] },
        { id: 'payment_methods', name: 'طرق الدفع', examples: ['ما طرق الدفع؟', 'هل تقبلون مدى؟'] },
        { id: 'return_request', name: 'طلب إرجاع', examples: ['أريد إرجاع المنتج', 'كيف الاستبدال؟'] },
        { id: 'complaint', name: 'شكوى', examples: ['عندي مشكلة', 'المنتج تالف'] },
        { id: 'greeting', name: 'تحية', examples: ['مرحبا', 'السلام عليكم'] },
        { id: 'thanks', name: 'شكر', examples: ['شكراً', 'جزاك الله خير'] },
        { id: 'human_request', name: 'طلب موظف', examples: ['أريد التحدث مع موظف', 'حوّلني لشخص'] },
      ],
    };
  }
}
