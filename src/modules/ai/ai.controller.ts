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
 * ║  POST /ai/knowledge/reindex  → إعادة توليد Embeddings                          ║
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
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { PlatformFeatureGuard } from '../platform-capabilities/platform-feature.guard';
import { RequirePlatformFeature } from '../platform-capabilities/platform-feature.decorator';
import { User } from '@database/entities';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AIService, SearchPriority } from './ai.service';
import { AILearningService } from './ai-learning.service';
import { UnansweredStatus } from './entities/unanswered-question.entity';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

class WebsiteProductDto {
  @IsString()
  name: string;

  @IsString()
  price: string;

  @IsBoolean()
  available: boolean;

  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  description?: string;
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
  storeIntroduction?: string;

  @IsOptional() @IsString()
  workingHours?: string;

  @IsOptional() @IsString()
  returnPolicy?: string;

  @IsOptional() @IsString()
  shippingInfo?: string;

  @IsOptional() @IsString()
  cancellationPolicy?: string;

  @IsOptional() @IsString()
  welcomeMessage?: string;

  @IsOptional() @IsString()
  fallbackMessage?: string;

  @IsOptional() @IsString()
  handoffMessage?: string;

  @IsOptional() @IsNumber()
  responseDelay?: number;

  // ✅ Level 2: Dynamic Thresholds
  @IsOptional() @IsNumber()
  highSimilarityThreshold?: number;

  @IsOptional() @IsNumber()
  mediumSimilarityThreshold?: number;

  @IsOptional() @IsNumber()
  lowSimilarityThreshold?: number;

  @IsOptional() @IsNumber()
  answerConfidenceThreshold?: number;

  @IsOptional() @IsNumber()
  clarifyConfidenceThreshold?: number;

  // ✅ Level 2: Performance Settings
  @IsOptional() @IsBoolean()
  enableParallelSearch?: boolean;

  @IsOptional() @IsBoolean()
  enableProductCache?: boolean;

  @IsOptional() @IsNumber()
  productCacheTTL?: number;

  @IsOptional() @IsBoolean()
  skipVerifierOnHighConfidence?: boolean;
  
  // ✅ Level 2: Timeouts and Rate Limits
  @IsOptional() @IsNumber()
  openaiTimeout?: number;

  @IsOptional() @IsNumber()
  productSearchTimeout?: number;

  @IsOptional() @IsNumber()
  maxRetries?: number;

  @IsOptional() @IsNumber()
  retryDelay?: number;

  // ✅ Product Source Settings
  @IsOptional() @IsString()
  productSource?: 'salla_api' | 'website_scrape' | 'none';

  @IsOptional() @IsBoolean()
  productActiveOnly?: boolean;

  @IsOptional() @IsString()
  websiteUrl?: string;

  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebsiteProductDto)
  websiteProducts?: WebsiteProductDto[];

  @IsOptional() @IsString()
  websiteScrapedAt?: string;

  // ✅ Owner Mode Settings
  @IsOptional() @IsBoolean()
  ownerModeEnabled?: boolean;

  @IsOptional() @IsArray()
  ownerPhones?: string[];

  @IsOptional() @IsString()
  ownerWelcomeMessage?: string;

  @IsOptional()
  ownerCapabilities?: {
    orderLookup: boolean;
    createCoupons: boolean;
    modifyOrders: boolean;
  };

  @IsOptional() @IsArray()
  ownerLids?: string[];

  // ✅ Test Mode Settings
  @IsOptional() @IsBoolean()
  testMode?: boolean;

  @IsOptional() @IsArray()
  testPhones?: string[];

  // ✅ Learning Capture
  @IsOptional() @IsBoolean()
  learningCaptureEnabled?: boolean;

  // ✅ Message Batching Settings
  @IsOptional() @IsBoolean()
  messageBatchingEnabled?: boolean;

  @IsOptional() @IsNumber()
  messageBatchingSeconds?: number;
}

class AddKnowledgeDto {
  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional() @IsString()
  category?: string;

  /**
   * ✅ BUG-KB2 FIX: نوع المعلومة — article أو qna
   * الواجهة ترسل type='article' أو type='qna'
   */
  @IsOptional() @IsString()
  type?: string;

  /**
   * ✅ BUG-KB2 FIX: جواب السؤال (فقط لنوع qna)
   */
  @IsOptional() @IsString()
  answer?: string;

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

  /**
   * ✅ BUG-KB2 FIX: تحديث نوع المعلومة
   */
  @IsOptional() @IsString()
  type?: string;

  /**
   * ✅ BUG-KB2 FIX: تحديث الجواب (qna)
   */
  @IsOptional() @IsString()
  answer?: string;

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
@UseGuards(JwtAuthGuard, PlatformFeatureGuard)
@RequirePlatformFeature('ai_assistant')
export class AiController {
  constructor(
    private readonly aiService: AIService,
    private readonly learningService: AILearningService,
  ) {}

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
  @RequirePlatformFeature('ai_assistant')
  @ApiOperation({ summary: 'جلب إعدادات البوت' })
  async getSettings(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.aiService.getSettings(tenantId, storeId);
  }

  @Put('settings')
  @RequirePlatformFeature('ai_assistant')
  @ApiOperation({ summary: 'تحديث إعدادات البوت' })
  async updateSettings(
    @CurrentUser() user: User,
    @Body() dto: UpdateAISettingsDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.aiService.updateSettings(tenantId, storeId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('knowledge')
  @RequirePlatformFeature('ai_assistant.knowledge')
  @ApiOperation({ summary: 'جلب قاعدة المعرفة' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getKnowledge(
    @CurrentUser() user: User,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.aiService.getKnowledge(user.tenantId, { category, search });
  }

  @Post('knowledge')
  @RequirePlatformFeature('ai_assistant.knowledge')
  @ApiOperation({ summary: 'إضافة معرفة جديدة' })
  async addKnowledge(
    @CurrentUser() user: User,
    @Body() dto: AddKnowledgeDto,
  ) {
    return this.aiService.addKnowledge(user.tenantId, dto);
  }

  @Put('knowledge/:id')
  @RequirePlatformFeature('ai_assistant.knowledge')
  @ApiOperation({ summary: 'تحديث معرفة' })
  async updateKnowledge(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeDto,
  ) {
    return this.aiService.updateKnowledge(user.tenantId, id, dto);
  }

  @Delete('knowledge/:id')
  @RequirePlatformFeature('ai_assistant.knowledge')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف معرفة' })
  async deleteKnowledge(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.aiService.deleteKnowledge(user.tenantId, id);
  }

  @Post('knowledge/reindex')
  @RequirePlatformFeature('ai_assistant.knowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إعادة توليد Embeddings لكل المكتبة (RAG)' })
  async reindexEmbeddings(@CurrentUser() user: User) {
    return this.aiService.reindexEmbeddings(user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRAINING (يحول إلى knowledge base entries)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('train')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'تدريب البوت' })
  async trainBot(
    @CurrentUser() user: User,
    @Body() dto: TrainBotDto,
  ) {
    return this.aiService.trainBot(user.tenantId, dto);
  }

  @Get('training-status')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'حالة التدريب' })
  async getTrainingStatus(@CurrentUser() user: User) {
    return this.aiService.getTrainingStatus(user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('analytics')
  @ApiOperation({ summary: 'تحليلات أداء البوت' })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'week', 'month'] })
  async getAnalytics(
    @CurrentUser() user: User,
    @Query('period') period = 'week',
  ) {
    return this.aiService.getAnalytics(user.tenantId, period);
  }

  @Get('stats')
  @ApiOperation({ summary: 'إحصائيات الـ AI' })
  async getStats(@CurrentUser() user: User) {
    return this.aiService.getStats(user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESPOND & TEST
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('respond')
  @RequirePlatformFeature('ai_assistant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إنشاء رد على رسالة' })
  @ApiResponse({ status: 200, description: 'الرد المولّد' })
  async respond(
    @CurrentUser() user: User,
    @Body() dto: RespondDto,
  ) {
    return this.aiService.generateResponse({
      tenantId: user.tenantId,
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
  @RequirePlatformFeature('ai_assistant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اختبار رد البوت (بدون حفظ)' })
  async testResponse(
    @CurrentUser() user: User,
    @Body() dto: TestResponseDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.aiService.testResponse(
      user.tenantId,
      dto.message,
      storeId,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GENERATE STORE INFO WITH AI
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('generate-store-info')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إنشاء معلومات المتجر بالذكاء الاصطناعي' })
  async generateStoreInfo(
    @CurrentUser() user: User,
    @Body() dto: { description: string },
  ) {
    if (!dto.description?.trim()) {
      throw new BadRequestException('يرجى إدخال وصف المتجر');
    }
    return this.aiService.generateStoreInfo(user.tenantId, dto.description.trim());
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCRAPE PRODUCTS — قراءة المنتجات من رابط الموقع
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('scrape-products')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'قراءة المنتجات من رابط موقع خارجي' })
  async scrapeProducts(
    @Body() dto: { url: string },
  ) {
    if (!dto.url?.trim()) {
      throw new BadRequestException('يرجى إدخال رابط الموقع');
    }
    // Validate URL format
    try {
      new URL(dto.url.trim());
    } catch {
      throw new BadRequestException('الرابط غير صالح — يجب أن يبدأ بـ https://');
    }
    return this.aiService.scrapeProducts(dto.url.trim());
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 📚 SELF-LEARNING — أسئلة بدون إجابة
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('learning/unanswered')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'قائمة الأسئلة بدون إجابة — مرتبة بالتكرار' })
  async getUnanswered(
    @CurrentUser() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ) {
    const tenantId = user.tenantId;
    if (!tenantId) return { items: [], total: 0, page: 1, limit: 50 };
    return this.learningService.getUnanswered(
      tenantId,
      UnansweredStatus.PENDING,
      parseInt(limit || '50', 10),
      parseInt(page || '1', 10),
      source || undefined,
    );
  }

  @Get('learning/stats')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'إحصائيات الأسئلة بدون إجابة' })
  async getLearningStats(@CurrentUser() user: User) {
    const tenantId = user.tenantId;
    if (!tenantId) return { pendingCount: 0, totalHits: 0, topQuestion: null };
    return this.learningService.getStats(tenantId);
  }

  @Put('learning/unanswered/:id/resolve')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'تحديث حالة سؤال — resolved (تم إضافة الجواب)' })
  async resolveQuestion(
    @CurrentUser() user: User,
    @Param('id') questionId: string,
    @Body() body: { knowledgeId?: string },
  ) {
    const tenantId = user.tenantId;
    if (!tenantId) return null;
    return this.learningService.updateStatus(
      tenantId,
      questionId,
      UnansweredStatus.RESOLVED,
      body.knowledgeId,
    );
  }

  @Put('learning/unanswered/:id/dismiss')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'تجاهل سؤال — غير مهم' })
  async dismissQuestion(
    @CurrentUser() user: User,
    @Param('id') questionId: string,
  ) {
    const tenantId = user.tenantId;
    if (!tenantId) return { success: false };
    const result = await this.learningService.dismiss(tenantId, questionId);
    return { success: result };
  }

  @Delete('learning/unanswered/clear')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'حذف جميع الأسئلة المعلّقة' })
  async clearAllUnanswered(
    @CurrentUser() user: User,
    @Query('source') source?: string,
  ) {
    const tenantId = user.tenantId;
    if (!tenantId) return { deleted: 0 };
    const deleted = await this.learningService.clearAll(tenantId, source || undefined);
    return { deleted };
  }

  @Get('learning/resolved')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'الأسئلة اللي تم الرد عليها' })
  async getResolved(@CurrentUser() user: User) {
    const tenantId = user.tenantId;
    if (!tenantId) return { items: [], total: 0, page: 1, limit: 50 };
    return this.learningService.getUnanswered(tenantId, UnansweredStatus.RESOLVED, 50);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📚 LEARNING v2 — تعديل رد البوت + إضافة للمكتبة
  // ═══════════════════════════════════════════════════════════════════════════

  @Put('learning/unanswered/:id/answer')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'تعديل جواب التاجر على سؤال' })
  async setMerchantAnswer(
    @CurrentUser() user: User,
    @Param('id') questionId: string,
    @Body() body: { answer: string },
  ) {
    const tenantId = user.tenantId;
    if (!tenantId) return null;
    return this.learningService.setMerchantAnswer(tenantId, questionId, body.answer);
  }

  @Post('learning/unanswered/:id/add-to-library')
  @RequirePlatformFeature('ai_assistant.learning')
  @ApiOperation({ summary: 'إضافة سؤال + جواب التاجر للمكتبة مباشرة' })
  async addToLibraryFromLearning(
    @CurrentUser() user: User,
    @Param('id') questionId: string,
    @Body() body: { answer?: string },
  ) {
    const tenantId = user.tenantId;
    if (!tenantId) return { success: false };

    // 1. جلب السؤال
    const { items: questions } = await this.learningService.getUnanswered(tenantId);
    const question = questions.find(q => q.id === questionId);
    if (!question) return { success: false, error: 'not_found' };

    // 2. الجواب = body.answer أو merchantAnswer أو botResponse
    const answer = body.answer || question.merchantAnswer || question.botResponse;
    if (!answer) return { success: false, error: 'no_answer' };

    // 3. إضافة للمكتبة
    const knowledge = await this.aiService.addKnowledge(tenantId, {
      title: question.representativeQuestion.slice(0, 100),
      content: `سؤال: ${question.representativeQuestion}\nجواب: ${answer}`,
      category: 'general',
    });

    // 4. حفظ رد التاجر على السؤال (عشان يظهر في تبويب "تم الرد")
    await this.learningService.setMerchantAnswer(tenantId, questionId, answer);

    // 5. تحديث حالة السؤال
    await this.learningService.updateStatus(
      tenantId,
      questionId,
      UnansweredStatus.RESOLVED,
      knowledge?.id,
    );

    return { success: true, knowledgeId: knowledge?.id };
  }
}
