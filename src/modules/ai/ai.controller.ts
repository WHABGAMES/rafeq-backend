/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Controller                                    ║
 * ║                                                                                ║
 * ║  📌 نقاط الوصول للذكاء الاصطناعي                                                ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET  /ai/settings           → جلب إعدادات البوت                              ║
 * ║  PUT  /ai/settings           → تحديث إعدادات البوت                            ║
 * ║  POST /ai/respond            → إنشاء رد على رسالة                             ║
 * ║  POST /ai/analyze            → تحليل رسالة (النية، المشاعر)                    ║
 * ║  GET  /ai/stats              → إحصائيات الـ AI                                 ║
 * ║  POST /ai/test               → اختبار رد الـ AI                                ║
 * ║  GET  /ai/knowledge          → قاعدة المعرفة                                   ║
 * ║  POST /ai/knowledge          → إضافة معرفة                                     ║
 * ║  POST /ai/train              → تدريب البوت                                     ║
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
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AIService } from './ai.service';

/**
 * DTOs
 */
class RespondDto {
  conversationId: string;
  message: string;
  context?: Record<string, unknown>;
}

class AnalyzeDto {
  message: string;
  language?: string;
}

class TestResponseDto {
  message: string;
  storeContext?: {
    storeName: string;
    storeType: string;
    tone: 'friendly' | 'professional' | 'casual';
  };
}

class UpdateAISettingsDto {
  enabled?: boolean;
  model?: 'gpt-4' | 'gpt-3.5-turbo' | 'claude-3';
  temperature?: number;
  maxTokens?: number;
  language?: 'ar' | 'en' | 'auto';
  tone?: 'formal' | 'friendly' | 'professional';
  autoHandoff?: boolean;
  handoffAfterFailures?: number;
  handoffKeywords?: string[];
  storeName?: string;
  storeDescription?: string;
  workingHours?: string;
  returnPolicy?: string;
  shippingInfo?: string;
  welcomeMessage?: string;
  fallbackMessage?: string;
  customFaqs?: Array<{ question: string; answer: string }>;
}

class AddKnowledgeDto {
  title: string;
  content: string;
  category?: string;
  keywords?: string[];
}

class TrainBotDto {
  faqs?: Array<{ question: string; answer: string }>;
  documents?: Array<{ title: string; content: string }>;
  urls?: string[];
}

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@Controller({
  path: 'ai',
  version: '1',
})
export class AiController {
  constructor(private readonly aiService: AIService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // AI SETTINGS - إعدادات البوت
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'جلب إعدادات البوت',
    description: 'جلب جميع إعدادات الذكاء الاصطناعي للمتجر',
  })
  async getSettings(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.aiService.getSettings(tenantId);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'تحديث إعدادات البوت',
    description: 'تحديث إعدادات الذكاء الاصطناعي',
  })
  async updateSettings(@CurrentUser() user: any,
    @Body() dto: UpdateAISettingsDto) {
    const tenantId = user.tenantId;
    return this.aiService.updateSettings(tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE - قاعدة المعرفة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('knowledge')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'قاعدة المعرفة',
    description: 'جلب جميع المعلومات المخزنة في قاعدة معرفة البوت',
  })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getKnowledge(
    @CurrentUser() user: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    const tenantId = user.tenantId;
    return this.aiService.getKnowledge(tenantId, { category, search });
  }

  @Post('knowledge')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'إضافة معرفة',
    description: 'إضافة معلومات جديدة لقاعدة معرفة البوت',
  })
  async addKnowledge(@CurrentUser() user: any,
    @Body() dto: AddKnowledgeDto) {
    const tenantId = user.tenantId;
    return this.aiService.addKnowledge(tenantId, dto);
  }

  @Delete('knowledge/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'حذف معرفة',
    description: 'حذف معلومة من قاعدة المعرفة',
  })
  async deleteKnowledge(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    return this.aiService.deleteKnowledge(tenantId, id);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRAINING - تدريب البوت
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('train')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'تدريب البوت',
    description: 'تدريب البوت على أسئلة وأجوبة جديدة',
  })
  async trainBot(@CurrentUser() user: any,
    @Body() dto: TrainBotDto) {
    const tenantId = user.tenantId;
    return this.aiService.trainBot(tenantId, dto);
  }

  @Get('training-status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'حالة التدريب',
    description: 'جلب حالة عملية تدريب البوت',
  })
  async getTrainingStatus(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.aiService.getTrainingStatus(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS - تحليلات البوت
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('analytics')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'تحليلات البوت',
    description: 'تحليلات أداء البوت',
  })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'week', 'month'] })
  async getAnalytics(@CurrentUser() user: any,
    @Query('period') period = 'week') {
    const tenantId = user.tenantId;
    return this.aiService.getAnalytics(tenantId, period);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /ai/respond - إنشاء رد على رسالة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إنشاء رد على رسالة',
    description: 'يحلل الرسالة ويولّد رداً مناسباً باستخدام الـ AI',
  })
  @ApiResponse({ status: 200, description: 'الرد المولّد' })
  async respond(@CurrentUser() user: any,
    @Body() dto: RespondDto) {
    const tenantId = user.tenantId;
    
    const response = await this.aiService.generateResponse({
      tenantId,
      conversationId: dto.conversationId,
      message: dto.message,
      context: dto.context,
    });

    return response;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /ai/analyze - تحليل رسالة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تحليل رسالة',
    description: 'تحليل النية (intent) والمشاعر (sentiment) للرسالة',
  })
  async analyze(@CurrentUser() _user: any,
    @Body() dto: AnalyzeDto) {
    const analysis = await this.aiService.analyzeMessage(dto.message, dto.language);
    return analysis;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /ai/stats - إحصائيات الـ AI
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('stats')
  @ApiOperation({
    summary: 'إحصائيات الـ AI',
    description: 'عدد الردود، نسبة النجاح، التحويلات للموظفين',
  })
  async getStats(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.aiService.getStats(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /ai/test - اختبار رد الـ AI
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'اختبار رد الـ AI',
    description: 'اختبار كيف سيرد الـ AI على رسالة معينة (بدون حفظ)',
  })
  async testResponse(@CurrentUser() _user: any,
    @Body() dto: TestResponseDto) {
    const response = await this.aiService.testResponse(
      dto.message,
      dto.storeContext,
    );
    return response;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /ai/intents - قائمة النوايا المدعومة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('intents')
  @ApiOperation({
    summary: 'قائمة النوايا المدعومة',
    description: 'قائمة بجميع النوايا (intents) التي يفهمها الـ AI',
  })
  getIntents() {
    return {
      intents: [
        {
          id: 'order_status',
          name: 'حالة الطلب',
          examples: ['أين طلبي؟', 'متى يصل طلبي؟', 'أريد تتبع طلبي'],
        },
        {
          id: 'order_cancel',
          name: 'إلغاء الطلب',
          examples: ['أريد إلغاء طلبي', 'كيف ألغي الطلب؟'],
        },
        {
          id: 'product_inquiry',
          name: 'استفسار عن منتج',
          examples: ['هل المنتج متوفر؟', 'كم سعر المنتج؟'],
        },
        {
          id: 'shipping_info',
          name: 'معلومات الشحن',
          examples: ['كم رسوم الشحن؟', 'متى التوصيل؟'],
        },
        {
          id: 'payment_methods',
          name: 'طرق الدفع',
          examples: ['ما طرق الدفع؟', 'هل تقبلون مدى؟'],
        },
        {
          id: 'return_request',
          name: 'طلب إرجاع',
          examples: ['أريد إرجاع المنتج', 'كيف الاستبدال؟'],
        },
        {
          id: 'complaint',
          name: 'شكوى',
          examples: ['عندي مشكلة', 'المنتج تالف'],
        },
        {
          id: 'greeting',
          name: 'تحية',
          examples: ['مرحبا', 'السلام عليكم'],
        },
        {
          id: 'thanks',
          name: 'شكر',
          examples: ['شكراً', 'جزاك الله خير'],
        },
        {
          id: 'human_request',
          name: 'طلب موظف',
          examples: ['أريد التحدث مع موظف', 'حوّلني لشخص'],
        },
        {
          id: 'unknown',
          name: 'غير معروف',
          examples: [],
        },
      ],
    };
  }
}
