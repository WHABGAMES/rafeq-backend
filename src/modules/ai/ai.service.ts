/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Service (Production v4 — Orchestrator)        ║
 * ║                                                                                ║
 * ║  ✅ المهمة 1: Intent Classification (LLM-based) — تصنيف النية قبل البحث       ║
 * ║  ✅ المهمة 2: Search Priority Enforcement — فرض search_mode صارم              ║
 * ║  ✅ المهمة 3: Strict RAG Retrieval — بحث دلالي + بوابات تحقق                  ║
 * ║  ✅ المهمة 4: Retry Logic — توضيح قبل التحويل حسب عداد المحاولات             ║
 * ║  ✅ المهمة 5: Tone & Language — فرض تقني وليس نصي                             ║
 * ║  ✅ المهمة 6: Handoff + Notifications — تحويل بشري مع إشعارات                 ║
 * ║                                                                                ║
 * ║  التسلسل: Message → Intent → Route → Search/Tool → Answer/Clarify/Handoff    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

// ✅ Entities — مطابقة لـ @database/entities/index.ts
import { KnowledgeBase, KnowledgeCategory, KnowledgeType } from './entities/knowledge-base.entity';
import { StoreSettings } from '../settings/entities/store-settings.entity';
import {
  Conversation,
  ConversationHandler,
  Message,
  MessageDirection,
  Order,
} from '@database/entities';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 ENUMS & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

export enum SearchPriority {
  LIBRARY_ONLY = 'library_only',
  LIBRARY_THEN_PRODUCTS = 'library_then_products',
  PRODUCTS_ONLY = 'products_only',
}

export interface AISettings {
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  language: 'ar' | 'en' | 'auto';
  tone: 'formal' | 'friendly' | 'professional';

  // Handoff
  autoHandoff: boolean;
  handoffAfterFailures: number;
  handoffKeywords: string[];

  // Search
  searchPriority: SearchPriority;

  // Silence
  silenceOnHandoff: boolean;
  silenceDurationMinutes: number;
  silenceOnAgentOpen: boolean;
  silenceAfterAgentMinutes: number;

  // Notifications
  handoffNotifyEmployeeIds: string[];
  handoffNotifyPhones: string[];
  handoffNotifyEmails: string[];

  // Store Info
  storeName: string;
  storeDescription: string;
  workingHours: string;
  returnPolicy: string;
  shippingInfo: string;

  // Custom Messages
  welcomeMessage: string;
  fallbackMessage: string;
  handoffMessage: string;
}

export interface ConversationContext {
  conversationId: string;
  tenantId: string;
  storeId?: string;
  customerId: string;
  customerName?: string;
  channel: string;
  messageCount: number;
  failedAttempts: number;
  isHandedOff: boolean;
  handoffAt?: string;
  previousMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AIResponse {
  reply: string;
  confidence: number;
  intent?: string;
  shouldHandoff: boolean;
  handoffReason?: string;
  toolsUsed?: string[];
  /** ✅ RAG: مخرجات التدقيق الداخلي */
  ragAudit?: RagAudit;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** ✅ BUG-7: حد أقصى لحجم Knowledge Base في الـ System Prompt (حروف) */
const MAX_KNOWLEDGE_CHARS = 6000;

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 RAG CONSTANTS — نظام البحث الدلالي الصارم
// ═══════════════════════════════════════════════════════════════════════════════

/** عتبة التشابه الدلالي — أقل من هذا = لا يوجد تطابق */
const SIMILARITY_THRESHOLD = 0.72;

/** عدد المقاطع المسترجعة من البحث الدلالي */
const RAG_TOP_K = 5;

/** نموذج الـ Embedding من OpenAI */
const EMBEDDING_MODEL = 'text-embedding-3-small';

/** رسالة عدم التطابق — إلزامية بدون تعديل */
const NO_MATCH_MESSAGE = 'عذرًا، هذا السؤال خارج نطاق المعلومات المتوفرة لدي حاليًا.\nإذا رغبت، أستطيع تحويلك إلى الدعم البشري لمساعدتك.';

/** رسائل طلب التوضيح (حسب اللغة) — تُستخدم قبل الوصول للحد الأقصى */
const CLARIFICATION_MESSAGES: Record<string, string[]> = {
  ar: [
    'ممكن توضح سؤالك أكثر لو تكرمت؟ أبي أساعدك بشكل أفضل 🙏',
    'عذرًا، ما قدرت أفهم طلبك بالضبط. ممكن تعيد صياغته بطريقة ثانية؟',
  ],
  en: [
    'Could you clarify your question a bit more? I want to help you better 🙏',
    'Sorry, I couldn\'t quite understand your request. Could you rephrase it?',
  ],
};

/** رسالة عرض التحويل البشري — عند الوصول للحد الأقصى */
const HANDOFF_OFFER_MESSAGES: Record<string, string> = {
  ar: 'يبدو إن سؤالك خارج نطاق المعلومات المتوفرة لدي. هل تحب أحوّلك للدعم البشري لمساعدتك؟',
  en: 'It seems your question is outside the information I have available. Would you like me to connect you with our support team?',
};

/** ✅ Intent Classification: نتيجة تصنيف نية الرسالة */
interface IntentResult {
  intent: 'SMALLTALK' | 'SUPPORT_QUERY' | 'ORDER_QUERY' | 'HUMAN_REQUEST' | 'UNKNOWN';
  confidence: number;
}

/** أنماط الأسئلة البسيطة التي لا تحتاج RAG */
const GREETING_PATTERNS = [
  'مرحبا', 'السلام عليكم', 'أهلا', 'هلا', 'هاي', 'صباح', 'مساء',
  'اخبارك', 'أخبارك', 'كيفك', 'كيف حالك', 'حياك', 'يا هلا', 'الو',
  'سلام', 'هلو', 'كيف الحال', 'شخبارك', 'شلونك', 'وش أخبارك',
  'hello', 'hi', 'hey', 'good morning', 'good evening', 'howdy',
];
const THANKS_PATTERNS = [
  'شكرا', 'شكراً', 'مشكور', 'يعطيك العافية', 'الله يعافيك', 'تسلم',
  'thank', 'thanks', 'thx',
];

/** مخرجات التدقيق الداخلي لكل رد */
export interface RagAudit {
  answer_source: 'library' | 'product' | 'tool' | 'greeting' | 'none';
  similarity_score: number;
  verifier_result: 'YES' | 'NO' | 'SKIPPED';
  final_decision: 'ANSWER' | 'BLOCKED';
  retrieved_chunks: number;
  gate_a_passed: boolean;
  gate_b_passed: boolean;
}

const AI_DEFAULTS: AISettings = {
  enabled: false,
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 1000,
  language: 'ar',
  tone: 'friendly',
  autoHandoff: true,
  handoffAfterFailures: 3,
  handoffKeywords: ['موظف', 'شخص', 'بشري', 'مدير', 'أريد إنسان'],
  searchPriority: SearchPriority.LIBRARY_THEN_PRODUCTS,
  silenceOnHandoff: true,
  silenceDurationMinutes: 60,
  silenceOnAgentOpen: true,
  silenceAfterAgentMinutes: 30,
  handoffNotifyEmployeeIds: [],
  handoffNotifyPhones: [],
  handoffNotifyEmails: [],
  storeName: '',
  storeDescription: '',
  workingHours: '',
  returnPolicy: '',
  shippingInfo: '',
  welcomeMessage: 'أهلاً وسهلاً! كيف يمكنني مساعدتك؟ 😊',
  fallbackMessage: 'عذراً، لم أتمكن من فهم طلبك. هل ترغب بتحويلك لأحد موظفينا؟',
  handoffMessage: 'سأحولك الآن لأحد أفراد فريقنا. سيتواصل معك قريباً! 🙋‍♂️',
};

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private openai: OpenAI;
  private readonly isApiKeyConfigured: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,

    @InjectRepository(KnowledgeBase)
    private readonly knowledgeRepo: Repository<KnowledgeBase>,

    @InjectRepository(StoreSettings)
    private readonly settingsRepo: Repository<StoreSettings>,

    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {
    // ✅ BUG-9 FIX: تحذير واضح إذا API Key مفقود
    const apiKey = this.configService.get<string>('ai.apiKey');
    this.isApiKeyConfigured = !!apiKey;

    if (!this.isApiKeyConfigured) {
      this.logger.warn(
        '⚠️ OpenAI API key is NOT configured — AI features will not work. ' +
          'Set OPENAI_API_KEY in your environment.',
      );
    }

    this.openai = new OpenAI({ apiKey: apiKey || 'missing-api-key' });

    // ✅ BUG-15 FIX: قراءة model الافتراضي من config.ai.model
    const configModel = this.configService.get<string>('ai.model');
    if (configModel && configModel !== AI_DEFAULTS.model) {
      AI_DEFAULTS.model = configModel;
    }

    this.logger.log(
      `✅ AI Service initialized ` +
        `(API key: ${this.isApiKeyConfigured ? 'configured' : 'MISSING'}, ` +
        `model: ${AI_DEFAULTS.model})`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 SETTINGS — حقيقية من store_settings table
  // ═══════════════════════════════════════════════════════════════════════════════

  async getSettings(tenantId: string, storeId?: string): Promise<AISettings> {
    const where: Record<string, unknown> = { tenantId, settingsKey: 'ai' };
    if (storeId) where.storeId = storeId;

    const row = await this.settingsRepo.findOne({ where });

    if (row?.settingsValue) {
      return { ...AI_DEFAULTS, ...(row.settingsValue as Partial<AISettings>) };
    }
    return { ...AI_DEFAULTS };
  }

  /**
   * ✅ BUG-8 FIX: storeId مطلوب لحفظ الإعدادات
   * StoreSettings entity: @Unique(['storeId', 'settingsKey'])
   * استخدام tenantId كبديل سيخلق إعدادات مكررة أو خاطئة
   */
  async updateSettings(
    tenantId: string,
    storeId: string | undefined,
    updates: Partial<AISettings>,
  ): Promise<AISettings> {
    if (!storeId) {
      throw new BadRequestException(
        'storeId is required to save AI settings. ' +
          'Pass it via x-store-id header or storeId query parameter.',
      );
    }

    const where = { tenantId, settingsKey: 'ai' as const, storeId };

    let row = await this.settingsRepo.findOne({ where });

    const current = row?.settingsValue
      ? { ...AI_DEFAULTS, ...(row.settingsValue as Partial<AISettings>) }
      : { ...AI_DEFAULTS };

    const merged = { ...current, ...updates };

    if (row) {
      row.settingsValue = merged as unknown as Record<string, unknown>;
    } else {
      row = this.settingsRepo.create({
        tenantId,
        storeId,
        settingsKey: 'ai',
        settingsValue: merged as unknown as Record<string, unknown>,
      });
    }

    await this.settingsRepo.save(row);
    this.logger.log('✅ AI settings saved', { tenantId, storeId });
    return merged;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📚 KNOWLEDGE BASE — CRUD حقيقي
  // ═══════════════════════════════════════════════════════════════════════════════

  async getKnowledge(
    tenantId: string,
    filters?: { category?: string; search?: string },
  ) {
    const qb = this.knowledgeRepo
      .createQueryBuilder('kb')
      .where('kb.tenantId = :tenantId', { tenantId })
      .orderBy('kb.priority', 'ASC')
      .addOrderBy('kb.createdAt', 'DESC');

    if (filters?.category) {
      qb.andWhere('kb.category = :category', { category: filters.category });
    }
    if (filters?.search) {
      qb.andWhere('(kb.title ILIKE :search OR kb.content ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    const items = await qb.getMany();

    const categoryCounts = await this.knowledgeRepo
      .createQueryBuilder('kb')
      .select('kb.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('kb.tenantId = :tenantId', { tenantId })
      .groupBy('kb.category')
      .getRawMany();

    return {
      items,
      categories: categoryCounts.map((c: Record<string, string>) => ({
        id: c.category,
        count: parseInt(c.count),
      })),
      total: items.length,
    };
  }

  async addKnowledge(
    tenantId: string,
    data: {
      title: string;
      content: string;
      category?: string;
      keywords?: string[];
      priority?: number;
      type?: string;
      answer?: string;
    },
  ): Promise<KnowledgeBase> {
    // ✅ RAG: توليد embedding تلقائياً عند الإضافة
    // ✅ BUG-KB3 FIX: لنوع QnA نضيف الجواب في نص الـ embedding
    const textForEmbedding = data.answer
      ? `${data.title}\n${data.content}\n${data.answer}`
      : `${data.title}\n${data.content}`;
    const embedding = await this.generateEmbedding(textForEmbedding);

    const entry = this.knowledgeRepo.create({
      tenantId,
      title: data.title,
      content: data.content,
      category:
        (data.category as KnowledgeCategory) || KnowledgeCategory.GENERAL,
      keywords: data.keywords || [],
      priority: data.priority ?? 10,
      isActive: true,
      embedding: embedding || undefined,
      // ✅ BUG-KB3 FIX: حفظ نوع المعلومة والجواب
      type: (data.type as KnowledgeType) || KnowledgeType.ARTICLE,
      answer: data.answer || undefined,
    });
    const saved = await this.knowledgeRepo.save(entry);
    this.logger.log('✅ Knowledge added', {
      tenantId,
      id: saved.id,
      hasEmbedding: !!embedding,
    });
    return saved;
  }

  async updateKnowledge(
    tenantId: string,
    id: string,
    data: Partial<{
      title: string;
      content: string;
      category: string;
      keywords: string[];
      priority: number;
      isActive: boolean;
      type: string;
      answer: string;
    }>,
  ): Promise<KnowledgeBase | null> {
    const entry = await this.knowledgeRepo.findOne({
      where: { id, tenantId },
    });
    if (!entry) return null;
    Object.assign(entry, data);

    // ✅ RAG: إعادة توليد embedding إذا تغيّر العنوان أو المحتوى أو الجواب
    if (data.title || data.content || data.answer) {
      const textForEmbedding = entry.answer
        ? `${entry.title}\n${entry.content}\n${entry.answer}`
        : `${entry.title}\n${entry.content}`;
      const embedding = await this.generateEmbedding(textForEmbedding);
      if (embedding) {
        entry.embedding = embedding;
      }
    }

    return this.knowledgeRepo.save(entry);
  }

  async deleteKnowledge(tenantId: string, id: string): Promise<boolean> {
    const result = await this.knowledgeRepo.delete({ id, tenantId });
    return (result.affected || 0) > 0;
  }

  /**
   * ✅ RAG: إعادة توليد Embeddings لكل مقاطع المعرفة
   * يُستدعى من الـ controller عند الحاجة لتحديث الفهرس
   */
  async reindexEmbeddings(tenantId: string): Promise<{
    total: number;
    indexed: number;
    failed: number;
  }> {
    const entries = await this.knowledgeRepo.find({
      where: { tenantId, isActive: true },
    });

    let indexed = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        // ✅ BUG-KB3 FIX: تضمين الجواب في الـ embedding
        const text = entry.answer
          ? `${entry.title}\n${entry.content}\n${entry.answer}`
          : `${entry.title}\n${entry.content}`;
        const embedding = await this.generateEmbedding(text);
        if (embedding) {
          entry.embedding = embedding;
          await this.knowledgeRepo.save(entry);
          indexed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      // تأخير بسيط لمنع تجاوز rate limit
      await new Promise((r) => setTimeout(r, 200));
    }

    this.logger.log('✅ Reindex complete', { tenantId, total: entries.length, indexed, failed });
    return { total: entries.length, indexed, failed };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🤖 MAIN AI PROCESSING — OpenAI GPT-4o
  // ═══════════════════════════════════════════════════════════════════════════════

  async processMessage(
    message: string,
    context: ConversationContext,
    settings: AISettings,
  ): Promise<AIResponse> {
    this.logger.debug('Processing AI message', {
      conversationId: context.conversationId,
    });

    // ✅ BUG-9: التحقق من API Key قبل المحاولة
    if (!this.isApiKeyConfigured) {
      this.logger.error(
        'Cannot process AI message: OpenAI API key is not configured',
      );
      return {
        reply: settings.fallbackMessage || AI_DEFAULTS.fallbackMessage,
        confidence: 0,
        shouldHandoff: true,
        handoffReason: 'AI_NOT_CONFIGURED',
      };
    }

    // ✅ BUG-5 FIX: سكوت البوت بعد التحويل — مع حساب المدة
    if (settings.silenceOnHandoff && context.isHandedOff) {
      const silenceExpired = this.isSilenceExpired(
        context.handoffAt,
        settings.silenceDurationMinutes,
      );

      if (!silenceExpired) {
        return {
          reply: '',
          confidence: 0,
          shouldHandoff: false,
          intent: 'SILENCED',
        };
      }

      // انتهت مدة الصمت → أعد البوت للعمل
      this.logger.log(
        `⏰ Silence expired for conversation ${context.conversationId} — re-enabling AI`,
      );
      await this.conversationRepo.update(
        { id: context.conversationId },
        { handler: ConversationHandler.AI },
      );
      context.isHandedOff = false;
    }

    // 2. كلمات التحويل المباشر
    const handoff = this.checkDirectHandoff(message, settings);
    if (handoff.shouldHandoff) {
      await this.handleHandoff(
        context,
        settings,
        handoff.reason || 'CUSTOMER_REQUEST',
      );
      return {
        reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
        confidence: 1,
        shouldHandoff: true,
        handoffReason: handoff.reason,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. ✅ ORCHESTRATOR — تصنيف النية → قرار → تنفيذ
    // ═══════════════════════════════════════════════════════════════════════════

    const lang = settings.language !== 'en' ? 'ar' : 'en';

    // 3a. ✅ المهمة 1: تصنيف النية (Intent Classification)
    const intentResult = await this.classifyIntent(message, settings);
    this.logger.log(`🧠 Intent: ${intentResult.intent} (${intentResult.confidence})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 3b. ✅ المهمة 4: SMALLTALK → رد اجتماعي بدون بحث
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === 'SMALLTALK') {
      // ✅ تحديد نوع SMALLTALK (تحية / شكر / كلام عام)
      const socialReply = this.generateSocialReply(message, settings);
      await this.resetFailedAttempts(context);
      return {
        reply: socialReply,
        confidence: intentResult.confidence,
        shouldHandoff: false,
        intent: 'SMALLTALK',
        ragAudit: {
          answer_source: 'greeting',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: 0,
          gate_a_passed: true,
          gate_b_passed: true,
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3c. ✅ HUMAN_REQUEST → تحقق من العداد ثم تحويل
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === 'HUMAN_REQUEST') {
      await this.handleHandoff(context, settings, 'CUSTOMER_REQUEST');
      return {
        reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
        confidence: 1,
        shouldHandoff: true,
        handoffReason: 'CUSTOMER_REQUEST',
        intent: 'HUMAN_REQUEST',
        ragAudit: {
          answer_source: 'none',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: 0,
          gate_a_passed: true,
          gate_b_passed: true,
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3d. ✅ ORDER_QUERY → أدوات مباشرة (بدون RAG)
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === 'ORDER_QUERY') {
      return this.handleOrderQuery(message, context, settings);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3e. ✅ UNKNOWN → طلب توضيح (مع عداد)
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === 'UNKNOWN') {
      return this.handleNoMatch(context, settings, lang, 'UNKNOWN');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3f. ✅ المهمة 2+3: SUPPORT_QUERY → بحث حسب search_mode
    // ──────────────────────────────────────────────────────────────────────────

    // ✅ المهمة 2: فرض search_mode
    const searchMode = settings.searchPriority || SearchPriority.LIBRARY_THEN_PRODUCTS;
    this.logger.log(`🔍 Search mode: ${searchMode}`);

    const ragResult = await this.ragRetrieve(message, context, settings);

    this.logger.log(`🔍 RAG Result`, {
      conversationId: context.conversationId,
      topScore: ragResult.topScore.toFixed(3),
      chunksFound: ragResult.chunks.length,
      gateA: ragResult.gateAPassed ? 'PASS' : 'FAIL',
    });

    // ✅ بوابة A: عتبة التشابه
    if (!ragResult.gateAPassed) {
      this.logger.log(`🚫 Gate A FAILED (score=${ragResult.topScore.toFixed(3)} < ${SIMILARITY_THRESHOLD})`);
      // ✅ المهمة 4: نظام المحاولات — لا نحظر مباشرة
      return this.handleNoMatch(context, settings, lang, 'SUPPORT_QUERY');
    }

    // ✅ بوابة B: التحقق الدلالي
    let gateBPassed = false;
    if (ragResult.chunks.length > 0) {
      gateBPassed = await this.verifyRelevance(message, ragResult.chunks);
      this.logger.log(`🔎 Gate B (Verifier): ${gateBPassed ? 'PASS' : 'FAIL'}`);

      if (!gateBPassed) {
        return this.handleNoMatch(context, settings, lang, 'SUPPORT_QUERY');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. ✅ توليد الرد — من المقاطع المسترجعة فقط
    // ═══════════════════════════════════════════════════════════════════════════

    // ✅ نجح البحث → أعد العداد لصفر
    await this.resetFailedAttempts(context);

    const systemPrompt = this.buildStrictSystemPrompt(settings, context, ragResult.chunks);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...context.previousMessages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const tools = this.getAvailableTools();

    try {
      const completion = await this.openai.chat.completions.create({
        model: settings.model || AI_DEFAULTS.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: 0.3,
        max_tokens: settings.maxTokens || 1000,
      });

      const assistantMsg = completion.choices[0]?.message;
      if (!assistantMsg) throw new Error('No response from OpenAI');

      let finalReply = assistantMsg.content || '';
      const toolsUsed: string[] = [];
      let finalSource: RagAudit['answer_source'] = 'library';

      // تنفيذ الأدوات
      if (assistantMsg.tool_calls?.length) {
        const toolResults = await this.executeToolCalls(assistantMsg.tool_calls, context, settings);
        toolsUsed.push(...toolResults.map((r) => r.name));

        const handoffTool = toolResults.find((r) => r.name === 'request_human_agent');
        if (handoffTool) {
          return {
            reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
            confidence: 1,
            shouldHandoff: true,
            handoffReason: 'CUSTOMER_REQUEST',
            toolsUsed,
          };
        }

        const toolMessages: ChatCompletionMessageParam[] = [
          ...messages,
          assistantMsg as ChatCompletionMessageParam,
          ...toolResults.map((r) => ({
            role: 'tool' as const,
            tool_call_id: r.toolCallId,
            content: JSON.stringify(r.result),
          })),
        ];

        const followUp = await this.openai.chat.completions.create({
          model: settings.model || AI_DEFAULTS.model,
          messages: toolMessages,
          temperature: 0.3,
          max_tokens: settings.maxTokens || 1000,
        });

        finalReply = followUp.choices[0]?.message?.content || finalReply;
        finalSource = 'tool';
      }

      return {
        reply: finalReply,
        confidence: 0.9,
        intent: 'SUPPORT_QUERY',
        shouldHandoff: false,
        toolsUsed,
        ragAudit: {
          answer_source: finalSource,
          similarity_score: ragResult.topScore,
          verifier_result: gateBPassed ? 'YES' : 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: ragResult.chunks.length,
          gate_a_passed: ragResult.gateAPassed,
          gate_b_passed: gateBPassed,
        },
      };
    } catch (error) {
      this.logger.error('OpenAI API error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return {
        reply: settings.fallbackMessage || AI_DEFAULTS.fallbackMessage,
        confidence: 0,
        shouldHandoff: true,
        handoffReason: 'AI_ERROR',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎯 ORCHESTRATOR HELPERS — المهام المساندة للتسلسل التنفيذي
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ المهمة 4 (جزء SMALLTALK): توليد رد اجتماعي حسب النبرة واللغة
   * ❌ لا يتم أي بحث — رد مباشر
   */
  private generateSocialReply(message: string, settings: AISettings): string {
    const lower = message.trim().toLowerCase();
    const isAr = settings.language !== 'en';
    const tone = settings.tone || 'friendly';

    // كشف نوع SMALLTALK
    const isGreeting = GREETING_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
    const isThanks = THANKS_PATTERNS.some((p) => lower.includes(p.toLowerCase()));

    if (isGreeting) {
      // إذا هناك رسالة ترحيب مخصصة → استخدمها
      if (settings.welcomeMessage) return settings.welcomeMessage;

      // ردود حسب النبرة
      const greetings: Record<string, Record<string, string>> = {
        formal: {
          ar: 'مرحبًا بك. كيف يمكنني مساعدتك اليوم؟',
          en: 'Welcome. How may I assist you today?',
        },
        friendly: {
          ar: 'أهلاً وسهلاً! كيف أقدر أساعدك؟ 😊',
          en: 'Hi there! How can I help you? 😊',
        },
        professional: {
          ar: 'مرحبًا بك. أنا هنا لمساعدتك. تفضل بسؤالك.',
          en: 'Hello. I\'m here to help. Please go ahead with your question.',
        },
      };
      return greetings[tone]?.[isAr ? 'ar' : 'en'] || greetings.friendly[isAr ? 'ar' : 'en'];
    }

    if (isThanks) {
      const thanks: Record<string, Record<string, string>> = {
        formal: {
          ar: 'على الرحب والسعة. هل هناك شيء آخر يمكنني مساعدتك به؟',
          en: 'You\'re most welcome. Is there anything else I can assist you with?',
        },
        friendly: {
          ar: 'العفو! هل تحتاج شي ثاني؟ 😊',
          en: 'You\'re welcome! Need anything else? 😊',
        },
        professional: {
          ar: 'العفو. لا تتردد في السؤال إذا احتجت أي مساعدة.',
          en: 'You\'re welcome. Don\'t hesitate to ask if you need further assistance.',
        },
      };
      return thanks[tone]?.[isAr ? 'ar' : 'en'] || thanks.friendly[isAr ? 'ar' : 'en'];
    }

    // كلام عام (كيف حالك، اخبارك، إلخ)
    const general: Record<string, Record<string, string>> = {
      formal: {
        ar: 'شكرًا لتواصلك. كيف يمكنني مساعدتك؟',
        en: 'Thank you for reaching out. How can I help you?',
      },
      friendly: {
        ar: 'الحمدلله بخير! كيف أقدر أساعدك اليوم؟ 😊',
        en: 'I\'m doing great! How can I help you today? 😊',
      },
      professional: {
        ar: 'أهلاً بك. كيف أستطيع مساعدتك؟',
        en: 'Hello. How may I help you?',
      },
    };
    return general[tone]?.[isAr ? 'ar' : 'en'] || general.friendly[isAr ? 'ar' : 'en'];
  }

  /**
   * ✅ المهمة 4: نظام المحاولات قبل التحويل (Retry Logic)
   *
   * المنطق:
   * - إذا attempts < max → اطلب توضيح + زِد العداد
   * - إذا attempts == max → اعرض اقتراح التحويل البشري
   *
   * ❌ لا يتم التحويل مباشرة من أول محاولة
   */
  private async handleNoMatch(
    context: ConversationContext,
    settings: AISettings,
    lang: string,
    intentType: string,
  ): Promise<AIResponse> {
    const maxAttempts = settings.handoffAfterFailures || AI_DEFAULTS.handoffAfterFailures;

    // زيادة العداد
    await this.incrementFailedAttempts(context);
    const currentAttempts = (context.failedAttempts || 0) + 1;

    this.logger.log(`📊 Failed attempts: ${currentAttempts}/${maxAttempts} for conversation ${context.conversationId} (intent: ${intentType})`);

    // ✅ لم يصل للحد → اطلب توضيح
    if (currentAttempts < maxAttempts) {
      const clarifyMsgs = CLARIFICATION_MESSAGES[lang] || CLARIFICATION_MESSAGES.ar;
      const clarifyIndex = Math.min(currentAttempts - 1, clarifyMsgs.length - 1);
      const clarifyMsg = clarifyMsgs[clarifyIndex];

      return {
        reply: clarifyMsg,
        confidence: 0.3,
        shouldHandoff: false,
        intent: 'CLARIFICATION_NEEDED',
        ragAudit: {
          answer_source: 'none',
          similarity_score: 0,
          verifier_result: 'NO',
          final_decision: 'BLOCKED',
          retrieved_chunks: 0,
          gate_a_passed: false,
          gate_b_passed: false,
        },
      };
    }

    // ✅ وصل للحد الأقصى → اعرض التحويل البشري
    this.logger.log(`🔄 Max attempts reached (${currentAttempts}/${maxAttempts}) — offering handoff`);

    if (settings.autoHandoff) {
      // تحويل تلقائي
      await this.handleHandoff(context, settings, 'NO_MATCH_AFTER_MAX_ATTEMPTS');
      return {
        reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
        confidence: 0,
        shouldHandoff: true,
        handoffReason: 'NO_MATCH_AFTER_MAX_ATTEMPTS',
        intent: 'HANDOFF',
        ragAudit: {
          answer_source: 'none',
          similarity_score: 0,
          verifier_result: 'NO',
          final_decision: 'BLOCKED',
          retrieved_chunks: 0,
          gate_a_passed: false,
          gate_b_passed: false,
        },
      };
    }

    // اقتراح التحويل (بدون تحويل تلقائي)
    const offerMsg = HANDOFF_OFFER_MESSAGES[lang] || HANDOFF_OFFER_MESSAGES.ar;
    return {
      reply: offerMsg,
      confidence: 0,
      shouldHandoff: false,
      intent: 'HANDOFF_OFFERED',
      ragAudit: {
        answer_source: 'none',
        similarity_score: 0,
        verifier_result: 'NO',
        final_decision: 'BLOCKED',
        retrieved_chunks: 0,
        gate_a_passed: false,
        gate_b_passed: false,
      },
    };
  }

  /**
   * ✅ معالجة استفسارات الطلبات — أدوات مباشرة بدون RAG
   */
  private async handleOrderQuery(
    message: string,
    context: ConversationContext,
    settings: AISettings,
  ): Promise<AIResponse> {
    const systemPrompt = this.buildStrictSystemPrompt(settings, context, []);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...context.previousMessages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const tools = this.getAvailableTools();

    try {
      const completion = await this.openai.chat.completions.create({
        model: settings.model || AI_DEFAULTS.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: 0.3,
        max_tokens: settings.maxTokens || 1000,
      });

      const assistantMsg = completion.choices[0]?.message;
      if (!assistantMsg) throw new Error('No response from OpenAI');

      let finalReply = assistantMsg.content || '';
      const toolsUsed: string[] = [];

      if (assistantMsg.tool_calls?.length) {
        const toolResults = await this.executeToolCalls(assistantMsg.tool_calls, context, settings);
        toolsUsed.push(...toolResults.map((r) => r.name));

        const handoffTool = toolResults.find((r) => r.name === 'request_human_agent');
        if (handoffTool) {
          return {
            reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
            confidence: 1,
            shouldHandoff: true,
            handoffReason: 'CUSTOMER_REQUEST',
            toolsUsed,
          };
        }

        const toolMessages: ChatCompletionMessageParam[] = [
          ...messages,
          assistantMsg as ChatCompletionMessageParam,
          ...toolResults.map((r) => ({
            role: 'tool' as const,
            tool_call_id: r.toolCallId,
            content: JSON.stringify(r.result),
          })),
        ];

        const followUp = await this.openai.chat.completions.create({
          model: settings.model || AI_DEFAULTS.model,
          messages: toolMessages,
          temperature: 0.3,
          max_tokens: settings.maxTokens || 1000,
        });

        finalReply = followUp.choices[0]?.message?.content || finalReply;
      }

      await this.resetFailedAttempts(context);

      return {
        reply: finalReply,
        confidence: 0.9,
        intent: 'ORDER_QUERY',
        shouldHandoff: false,
        toolsUsed,
        ragAudit: {
          answer_source: 'tool',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: 0,
          gate_a_passed: true,
          gate_b_passed: true,
        },
      };
    } catch (error) {
      this.logger.error('Order query failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return {
        reply: settings.fallbackMessage || AI_DEFAULTS.fallbackMessage,
        confidence: 0,
        shouldHandoff: true,
        handoffReason: 'AI_ERROR',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 SYSTEM PROMPT — الصارم (RAG-based)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ RAG: بناء Prompt صارم — يحتوي فقط على المقاطع المسترجعة
   * ❌ ممنوع الاستنتاج أو الإكمال من المعرفة العامة
   */
  private buildStrictSystemPrompt(
    settings: AISettings,
    context: ConversationContext,
    retrievedChunks: Array<{ title: string; content: string; score: number; answer?: string }>,
  ): string {
    const isAr = settings.language !== 'en';

    let prompt = isAr
      ? `أنت مساعد ذكي لخدمة العملاء في "${settings.storeName || 'المتجر'}".`
      : `You are a helpful customer service assistant for "${settings.storeName || 'Store'}".`;

    const tones: Record<string, string> = {
      formal: isAr
        ? 'استخدم لغة رسمية ومهنية. لا تستخدم أي رموز تعبيرية (Emoji). خاطب العميل بصيغة الجمع المحترمة.'
        : 'Use formal, professional language. Do NOT use any emojis. Address the customer formally.',
      friendly: isAr
        ? 'كن ودوداً ولطيفاً. يمكنك استخدام رموز تعبيرية بشكل معتدل.'
        : 'Be friendly and warm. You may use emojis moderately.',
      professional: isAr
        ? 'كن مهنياً ومفيداً. ردودك مختصرة ودقيقة.'
        : 'Be professional and helpful. Keep responses concise and accurate.',
    };
    prompt += '\n' + (tones[settings.tone] || tones.friendly);

    // ✅ المهمة 5: فرض اللغة تقنياً — قاعدة إلزامية
    prompt += isAr
      ? '\n\n⚠️ قاعدة اللغة: أجب فقط باللغة العربية. ممنوع المزج بين العربية والإنجليزية في نفس الرد.'
      : '\n\n⚠️ Language rule: Respond ONLY in English. Do NOT mix English with Arabic in the same response.';

    // معلومات المتجر الأساسية
    if (settings.storeDescription)
      prompt += `\n${isAr ? 'عن المتجر' : 'About'}: ${settings.storeDescription}`;
    if (settings.workingHours)
      prompt += `\n${isAr ? 'أوقات العمل' : 'Hours'}: ${settings.workingHours}`;
    if (settings.returnPolicy)
      prompt += `\n${isAr ? 'سياسة الإرجاع' : 'Returns'}: ${settings.returnPolicy}`;
    if (settings.shippingInfo)
      prompt += `\n${isAr ? 'الشحن' : 'Shipping'}: ${settings.shippingInfo}`;

    // ✅ RAG: المقاطع المسترجعة فقط (وليس كل المكتبة)
    if (retrievedChunks.length > 0) {
      prompt += isAr
        ? '\n\n=== معلومات متوفرة (مصدرك الوحيد للإجابة) ==='
        : '\n\n=== Available Information (your ONLY source for answers) ===';

      let charsUsed = 0;
      for (const chunk of retrievedChunks) {
        // ✅ BUG-KB3 FIX: تضمين الجواب لنوع QnA
        const answerPart = chunk.answer ? `\nالجواب: ${chunk.answer}` : '';
        const entry = `\n[${chunk.title}]: ${chunk.content}${answerPart}`;
        if (charsUsed + entry.length > MAX_KNOWLEDGE_CHARS) break;
        prompt += entry;
        charsUsed += entry.length;
      }
    }

    // اسم العميل
    if (context.customerName) {
      prompt += `\n\n${isAr ? 'اسم العميل' : 'Customer'}: ${context.customerName}`;
    }

    // ✅ القواعد الصارمة — منع الهلوسة
    prompt += isAr
      ? `\n\n=== قواعد صارمة (إلزامية) ===
1. أجب فقط وحصرياً من المعلومات المتوفرة أعلاه. لا تختلق أو تفترض أي معلومة.
2. إذا لم تجد الإجابة في المعلومات المتوفرة أعلاه، أجب حرفياً بهذا النص فقط:
"${NO_MATCH_MESSAGE}"
3. لا تذكر أسعاراً أو منتجات أو تفاصيل غير موجودة في المعلومات المتوفرة.
4. لا تستخدم معرفتك العامة أبداً. لا تقدم نصائح طبية أو صحية أو ثقافية.
5. لا تشرح منتجات غير مذكورة أعلاه حتى لو عرفتها.
6. إذا طلب العميل شخصاً بشرياً، استخدم أداة request_human_agent.
7. كن موجزاً ومفيداً. لا تتوسع خارج المعلومات المقدمة.`
      : `\n\n=== Strict Rules (mandatory) ===
1. ONLY answer from the information provided above. Never make up or assume any information.
2. If the answer is NOT in the provided information, respond EXACTLY with:
"${NO_MATCH_MESSAGE}"
3. Do NOT mention prices, products, or details not in the provided information.
4. NEVER use general knowledge. No medical, health, or cultural advice.
5. Do NOT explain products not listed above, even if you know about them.
6. If customer asks for a human, use request_human_agent tool.
7. Be concise and helpful. Do not expand beyond provided information.`;

    return prompt;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 RAG ENGINE — البحث الدلالي والتحقق
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ توليد Embedding عبر OpenAI
   * يستخدم text-embedding-3-small (1536 dims)
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text.substring(0, 8000), // حد أقصى
      });
      return response.data[0]?.embedding || null;
    } catch (error) {
      this.logger.error('Failed to generate embedding', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  /**
   * ✅ حساب Cosine Similarity بين متجهين
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * ✅ البحث الدلالي في مكتبة المعلومات
   * 1. يجلب كل المقاطع التي لها embedding
   * 2. يحسب cosine similarity مع سؤال المستخدم
   * 3. يرجع Top-K الأعلى تشابهاً
   */
  private async semanticSearch(
    queryEmbedding: number[],
    tenantId: string,
  ): Promise<Array<{ title: string; content: string; score: number; id: string; answer?: string }>> {
    // جلب كل مقاطع المعرفة التي لها embedding
    const entries = await this.knowledgeRepo
      .createQueryBuilder('kb')
      .where('kb.tenantId = :tenantId', { tenantId })
      .andWhere('kb.isActive = true')
      .andWhere('kb.embedding IS NOT NULL')
      .select(['kb.id', 'kb.title', 'kb.content', 'kb.embedding', 'kb.answer'])
      .getMany();

    if (entries.length === 0) return [];

    // حساب التشابه + ترتيب
    const scored = entries
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        content: entry.content,
        answer: entry.answer || undefined,
        score: this.cosineSimilarity(queryEmbedding, entry.embedding || []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, RAG_TOP_K);

    return scored;
  }

  /**
   * ✅ بوابة B: التحقق الدلالي
   * يسأل LLM: "هل هذه المقاطع تحتوي إجابة مباشرة على السؤال؟"
   * استدعاء خفيف (max_tokens=10, temperature=0)
   */
  private async verifyRelevance(
    question: string,
    chunks: Array<{ title: string; content: string; score: number; answer?: string }>,
  ): Promise<boolean> {
    try {
      const chunksText = chunks
        .map((c) => {
          const answerPart = c.answer ? `\nالجواب: ${c.answer}` : '';
          return `[${c.title}]: ${c.content}${answerPart}`;
        })
        .join('\n');

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // نموذج خفيف للتحقق
        messages: [
          {
            role: 'system',
            content: 'أنت محكّم. أجب فقط بـ YES أو NO. لا تشرح.',
          },
          {
            role: 'user',
            content: `هل المقاطع التالية تحتوي إجابة مباشرة وواضحة على سؤال المستخدم؟

سؤال المستخدم: "${question}"

المقاطع:
${chunksText}

أجب YES إذا المقاطع تحتوي إجابة واضحة ومباشرة.
أجب NO إذا المقاطع لا تحتوي إجابة أو الإجابة غير مباشرة.`,
          },
        ],
        temperature: 0,
        max_tokens: 5,
      });

      const answer = (response.choices[0]?.message?.content || '').trim().toUpperCase();
      return answer.includes('YES');
    } catch (error) {
      this.logger.error('Verifier failed — defaulting to FAIL', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return false; // فشل التحقق = لا نسمح بالرد (أمان)
    }
  }

  /**
   * ✅ RAG Retrieve: يدير كامل عملية البحث الدلالي
   * 1. توليد embedding للسؤال
   * 2. بحث دلالي في المكتبة
   * 3. فحص عتبة التشابه (Gate A)
   * 4. يرجع النتائج مع حالة البوابات
   */
  private async ragRetrieve(
    message: string,
    context: ConversationContext,
    settings: AISettings,
  ): Promise<{
    chunks: Array<{ title: string; content: string; score: number; answer?: string }>;
    topScore: number;
    gateAPassed: boolean;
  }> {
    // إذا المكتبة معطلة
    const sp = settings.searchPriority || SearchPriority.LIBRARY_THEN_PRODUCTS;
    if (sp === SearchPriority.PRODUCTS_ONLY) {
      return { chunks: [], topScore: 0, gateAPassed: false };
    }

    // توليد embedding
    const queryEmbedding = await this.generateEmbedding(message);
    if (!queryEmbedding) {
      this.logger.warn('Failed to generate query embedding — falling back to keyword search');
      // Fallback: بحث كلمات مفتاحية
      return this.fallbackKeywordSearch(message, context.tenantId);
    }

    // بحث دلالي
    const results = await this.semanticSearch(queryEmbedding, context.tenantId);

    if (results.length === 0) {
      return { chunks: [], topScore: 0, gateAPassed: false };
    }

    const topScore = results[0].score;
    const gateAPassed = topScore >= SIMILARITY_THRESHOLD;

    return {
      chunks: results,
      topScore,
      gateAPassed,
    };
  }

  /**
   * ✅ Fallback: بحث كلمات مفتاحية (إذا فشل الـ Embedding)
   * يبحث بـ ILIKE في العنوان والمحتوى
   */
  private async fallbackKeywordSearch(
    message: string,
    tenantId: string,
  ): Promise<{
    chunks: Array<{ title: string; content: string; score: number; answer?: string }>;
    topScore: number;
    gateAPassed: boolean;
  }> {
    // استخراج كلمات مفتاحية من السؤال
    const words = message.split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) {
      return { chunks: [], topScore: 0, gateAPassed: false };
    }

    const qb = this.knowledgeRepo
      .createQueryBuilder('kb')
      .where('kb.tenantId = :tenantId', { tenantId })
      .andWhere('kb.isActive = true');

    // بحث OR على كل كلمة
    const conditions = words.map((_, i) => `(kb.title ILIKE :w${i} OR kb.content ILIKE :w${i})`);
    const params: Record<string, string> = {};
    words.forEach((w, i) => { params[`w${i}`] = `%${w}%`; });

    qb.andWhere(`(${conditions.join(' OR ')})`, params);
    qb.orderBy('kb.priority', 'ASC').take(RAG_TOP_K);

    const entries = await qb.getMany();

    if (entries.length === 0) {
      return { chunks: [], topScore: 0, gateAPassed: false };
    }

    // Keyword match = score 0.75 (أقل من threshold = يحتاج تحقق)
    const chunks = entries.map((e) => ({
      title: e.title,
      content: e.content,
      answer: e.answer || undefined,
      score: 0.75,
    }));

    return {
      chunks,
      topScore: 0.75,
      gateAPassed: true, // keyword match يعبر البوابة A بشرط بوابة B
    };
  }

  /**
   * ✅ المهمة 1: تصنيف نية الرسالة بالـ LLM (Intent Classification)
   * يحدد نوع الرسالة قبل أي بحث أو معالجة
   * يستخدم gpt-4o-mini للسرعة والتكلفة المنخفضة
   */
  private async classifyIntent(
    message: string,
    settings: AISettings,
  ): Promise<IntentResult> {
    // ✅ فحص سريع بـ Pattern أولاً (لتجنب API call غير ضروري)
    const patternResult = this.detectSimpleIntentPattern(message, settings);
    if (patternResult) return patternResult;

    try {
      const lang = settings.language !== 'en' ? 'ar' : 'en';
      const systemPrompt = lang === 'ar'
        ? `أنت محلل نوايا. صنّف رسالة العميل إلى واحد فقط من الأنواع التالية.
أجب فقط بـ JSON بدون أي نص آخر.
الأنواع:
- SMALLTALK: تحية، سؤال عام عن الحال، مجاملة، كلام اجتماعي
- SUPPORT_QUERY: سؤال يحتاج معلومة عن منتج أو خدمة أو سياسة المتجر
- ORDER_QUERY: استفسار عن حالة طلب أو شحنة أو تتبع
- HUMAN_REQUEST: طلب صريح للتحدث مع موظف أو شخص بشري
- UNKNOWN: لا يمكن تحديد النوع`
        : `You are an intent classifier. Classify the customer message into exactly one type.
Respond ONLY with JSON, no other text.
Types:
- SMALLTALK: greeting, how are you, compliment, social talk
- SUPPORT_QUERY: question needing product/service/policy info
- ORDER_QUERY: order status, shipping, tracking inquiry
- HUMAN_REQUEST: explicit request to speak to a human agent
- UNKNOWN: cannot determine`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `رسالة العميل: "${message}"\n\nأجب بـ JSON:\n{"intent":"...","confidence":0.00}` },
        ],
        temperature: 0,
        max_tokens: 50,
      });

      const raw = (response.choices[0]?.message?.content || '').trim();
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as IntentResult;

      // التحقق من صحة النتيجة
      const validIntents = ['SMALLTALK', 'SUPPORT_QUERY', 'ORDER_QUERY', 'HUMAN_REQUEST', 'UNKNOWN'];
      if (!validIntents.includes(parsed.intent)) {
        return { intent: 'UNKNOWN', confidence: 0.5 };
      }

      this.logger.log(`🧠 Intent: ${parsed.intent} (${parsed.confidence}) for: "${message.substring(0, 50)}"`);
      return parsed;

    } catch (error) {
      this.logger.warn('Intent classification failed — using pattern fallback', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      // Fallback: محاولة تصنيف بدائي
      return this.fallbackIntentClassification(message);
    }
  }

  /**
   * ✅ فحص سريع بـ Pattern — لتجنب API call على التحيات الواضحة
   */
  private detectSimpleIntentPattern(
    message: string,
    settings: AISettings,
  ): IntentResult | null {
    const lower = message.trim().toLowerCase();

    // تحية فقط إذا الرسالة قصيرة (أقل من 30 حرف)
    if (lower.length < 30) {
      for (const p of GREETING_PATTERNS) {
        if (lower.includes(p.toLowerCase())) {
          return { intent: 'SMALLTALK', confidence: 0.95 };
        }
      }
      for (const p of THANKS_PATTERNS) {
        if (lower.includes(p.toLowerCase())) {
          return { intent: 'SMALLTALK', confidence: 0.95 };
        }
      }
    }

    // طلب بشري واضح
    const humanKeywords = settings.handoffKeywords || AI_DEFAULTS.handoffKeywords;
    for (const kw of humanKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { intent: 'HUMAN_REQUEST', confidence: 0.95 };
      }
    }

    // استفسار طلب واضح
    if (this.isOrderInquiry(message)) {
      return { intent: 'ORDER_QUERY', confidence: 0.90 };
    }

    return null; // لا يمكن التحديد بـ pattern → يحتاج LLM
  }

  /**
   * ✅ Fallback: تصنيف بدائي بدون LLM (إذا فشل API)
   */
  private fallbackIntentClassification(message: string): IntentResult {
    const lower = message.toLowerCase();

    if (lower.length < 15) return { intent: 'SMALLTALK', confidence: 0.6 };

    const orderPatterns = ['طلب', 'طلبي', 'شحن', 'تتبع', 'order', 'track', 'shipping', '#'];
    if (orderPatterns.some((p) => lower.includes(p))) {
      return { intent: 'ORDER_QUERY', confidence: 0.7 };
    }

    // افتراضي: سؤال دعم
    return { intent: 'SUPPORT_QUERY', confidence: 0.6 };
  }

  /**
   * ✅ كشف استفسارات الطلبات (تعتمد على أدوات وليس RAG)
   */
  private isOrderInquiry(message: string): boolean {
    const lower = message.toLowerCase();
    const orderPatterns = [
      'طلب', 'طلبي', 'رقم الطلب', 'حالة الطلب', 'تتبع', 'شحن',
      'order', 'track', 'shipping', 'delivery', '#',
    ];
    return orderPatterns.some((p) => lower.includes(p));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 TOOLS (Function Calling)
  // ═══════════════════════════════════════════════════════════════════════════════

  private getAvailableTools(): ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_order_status',
          description: 'Get order status by order ID or reference number',
          parameters: {
            type: 'object',
            properties: {
              order_id: {
                type: 'string',
                description: 'Order ID or reference',
              },
            },
            required: ['order_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'request_human_agent',
          description: 'Transfer the conversation to a human agent',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Reason for handoff',
              },
            },
            required: ['reason'],
          },
        },
      },
    ];
  }

  /**
   * ✅ BUG-2 FIX: executeToolCalls يستدعي handleHandoff فعلياً
   */
  private async executeToolCalls(
    toolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>,
    context: ConversationContext,
    settings: AISettings,
  ): Promise<
    Array<{ name: string; result: unknown; toolCallId: string }>
  > {
    const results: Array<{
      name: string;
      result: unknown;
      toolCallId: string;
    }> = [];

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* invalid JSON */
      }

      let result: unknown;
      try {
        switch (tc.function.name) {
          case 'get_order_status':
            // ✅ BUG-16 FIX: نمرر storeId أيضاً
            result = await this.toolGetOrderStatus(
              context.tenantId,
              args.order_id as string,
              context.storeId,
            );
            break;

          case 'request_human_agent':
            // ✅ BUG-2 FIX: استدعاء handleHandoff() فعلياً
            await this.handleHandoff(
              context,
              settings,
              (args.reason as string) || 'CUSTOMER_REQUEST',
            );
            result = { success: true, message: 'تم التحويل للدعم البشري' };
            break;

          default:
            result = { error: 'Unknown function' };
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Error' };
      }

      results.push({ name: tc.function.name, result, toolCallId: tc.id });
    }

    return results;
  }

  /**
   * ✅ BUG-16 FIX: يبحث بـ storeId + tenantId
   *
   * Order entity:
   * - tenantId: nullable (column: tenant_id)
   * - storeId: required (column: store_id)
   * - sallaOrderId: required (column: salla_order_id)
   * - referenceId: nullable (column: reference_id)
   */
  private async toolGetOrderStatus(
    tenantId: string,
    orderId: string,
    storeId?: string,
  ): Promise<unknown> {
    const whereConditions: Record<string, unknown>[] = [
      { tenantId, sallaOrderId: orderId },
      { tenantId, referenceId: orderId },
    ];

    // ✅ BUG-16: بحث إضافي بـ storeId لأن tenantId قد يكون null
    if (storeId) {
      whereConditions.push(
        { storeId, sallaOrderId: orderId },
        { storeId, referenceId: orderId },
      );
    }

    const order = await this.orderRepo.findOne({
      where: whereConditions,
    });

    if (!order) {
      return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم' };
    }

    const statusAr: Record<string, string> = {
      created: 'تم الإنشاء',
      processing: 'قيد المعالجة',
      pending_payment: 'بانتظار الدفع',
      paid: 'تم الدفع',
      ready_to_ship: 'جاهز للشحن',
      shipped: 'تم الشحن',
      delivered: 'تم التسليم',
      completed: 'مكتمل',
      cancelled: 'ملغي',
      refunded: 'مسترد',
    };

    return {
      found: true,
      order_id: order.sallaOrderId,
      status: order.status,
      status_ar: statusAr[order.status] || order.status,
      total: order.totalAmount,
      currency: order.currency,
      shipping_info: order.shippingInfo || null,
      items_count: order.items?.length || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 HANDOFF & SILENCE
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ BUG-2 + BUG-5 FIX:
   * - يحدّث handler فعلياً إلى HUMAN
   * - يسجّل handoffAt في aiContext (للحساب مدة الصمت)
   * - يطلق حدث ai.handoff للإشعارات
   */
  private async handleHandoff(
    context: ConversationContext,
    settings: AISettings,
    reason: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    const conv = await this.conversationRepo.findOne({
      where: { id: context.conversationId },
    });

    if (conv) {
      const aiContext = (conv.aiContext || {}) as Record<string, unknown>;
      conv.handler = ConversationHandler.HUMAN;
      conv.aiContext = {
        ...aiContext,
        handoffAt: now,
        handoffReason: reason,
        failedAttempts: 0,
      };
      await this.conversationRepo.save(conv);
    } else {
      await this.conversationRepo.update(
        { id: context.conversationId },
        { handler: ConversationHandler.HUMAN },
      );
    }

    this.eventEmitter.emit('ai.handoff', {
      conversationId: context.conversationId,
      tenantId: context.tenantId,
      customerId: context.customerId,
      customerName: context.customerName,
      channel: context.channel,
      reason,
      handoffAt: now,
      notifyEmployeeIds: settings.handoffNotifyEmployeeIds,
      notifyPhones: settings.handoffNotifyPhones,
      notifyEmails: settings.handoffNotifyEmails,
    });

    this.logger.log('🔄 Handoff executed', {
      conversationId: context.conversationId,
      reason,
    });
  }

  /**
   * ✅ BUG-5 FIX: تحقق إذا انتهت مدة الصمت
   */
  private isSilenceExpired(
    handoffAt: string | undefined,
    silenceDurationMinutes: number,
  ): boolean {
    if (!handoffAt) return true;

    const handoffTime = new Date(handoffAt).getTime();
    if (isNaN(handoffTime)) return true;

    const duration = silenceDurationMinutes || 60;
    const elapsedMinutes = (Date.now() - handoffTime) / 60000;

    return elapsedMinutes >= duration;
  }

  private checkDirectHandoff(
    message: string,
    settings: AISettings,
  ): { shouldHandoff: boolean; reason?: string } {
    const lower = message.toLowerCase();

    // ✅ فقط الكلمات المفتاحية — كمسار سريع بدون LLM
    // MAX_FAILURES يُعالج الآن في handleNoMatch بعد Intent Classification
    const keywords = [
      'أريد شخص',
      'أريد إنسان',
      'موظف',
      'دعم بشري',
      'تحدث مع شخص',
      'human',
      'agent',
      'real person',
      ...(settings.handoffKeywords || []),
    ];

    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { shouldHandoff: true, reason: 'CUSTOMER_REQUEST' };
      }
    }

    return { shouldHandoff: false };
  }

  // 📊 FAILED ATTEMPTS TRACKING — BUG-3 FIX
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ BUG-3 FIX: زيادة عداد المحاولات الفاشلة في conversation.aiContext
   *
   * Entity field: Conversation.aiContext (column: ai_context, JSONB)
   */
  private async incrementFailedAttempts(
    context: ConversationContext,
  ): Promise<void> {
    try {
      const conv = await this.conversationRepo.findOne({
        where: { id: context.conversationId },
      });
      if (!conv) return;

      const aiContext = (conv.aiContext || {}) as Record<string, unknown>;
      const current = (aiContext.failedAttempts as number) || 0;
      conv.aiContext = { ...aiContext, failedAttempts: current + 1 };
      await this.conversationRepo.save(conv);

      this.logger.debug(
        `Failed attempts → ${current + 1} for conversation ${context.conversationId}`,
      );
    } catch (error) {
      this.logger.error('Failed to increment failed attempts', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  /**
   * ✅ BUG-3 FIX: إعادة تعيين عداد المحاولات الفاشلة عند النجاح
   */
  private async resetFailedAttempts(
    context: ConversationContext,
  ): Promise<void> {
    try {
      if (context.failedAttempts === 0) return;

      const conv = await this.conversationRepo.findOne({
        where: { id: context.conversationId },
      });
      if (!conv) return;

      const aiContext = (conv.aiContext || {}) as Record<string, unknown>;
      if ((aiContext.failedAttempts as number) > 0) {
        conv.aiContext = { ...aiContext, failedAttempts: 0 };
        await this.conversationRepo.save(conv);
      }
    } catch (error) {
      this.logger.error('Failed to reset failed attempts', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧪 TEST & GENERATE RESPONSE
  // ═══════════════════════════════════════════════════════════════════════════════

  async testResponse(
    tenantId: string,
    message: string,
    storeId?: string,
  ): Promise<{ reply: string; processingTime: number; toolsUsed?: string[]; ragAudit?: RagAudit }> {
    const startTime = Date.now();

    if (!this.isApiKeyConfigured) {
      return {
        reply: 'خطأ: مفتاح OpenAI API غير مكوّن. يرجى إضافة OPENAI_API_KEY.',
        processingTime: Date.now() - startTime,
      };
    }

    try {
      const settings = await this.getSettings(tenantId, storeId);

      const testContext: ConversationContext = {
        conversationId: 'test',
        tenantId,
        storeId: storeId || undefined,
        customerId: '',
        customerName: undefined,
        channel: '',
        messageCount: 0,
        failedAttempts: 0,
        isHandedOff: false,
        previousMessages: [],
      };

      // ✅ إذا لم يأتِ storeId من الهيدر، نحاول جلبه من أول قناة
      if (!testContext.storeId) {
        try {
          const anyConv = await this.conversationRepo.findOne({
            where: { tenantId },
            relations: ['channel'],
            order: { createdAt: 'DESC' },
          });
          if (anyConv?.channel?.storeId) {
            testContext.storeId = anyConv.channel.storeId;
          }
        } catch {
          /* no conversation yet — OK */
        }
      }

      // ✅ RAG: يستخدم نفس processMessage الصارم
      const result = await this.processMessage(message, testContext, settings);

      return {
        reply: result.reply || 'لم أتمكن من الرد',
        processingTime: Date.now() - startTime,
        toolsUsed: result.toolsUsed?.length ? result.toolsUsed : undefined,
        ragAudit: result.ragAudit,
      };
    } catch (error) {
      return {
        reply: `خطأ: ${error instanceof Error ? error.message : 'فشل الاتصال بـ OpenAI'}`,
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * ✅ BUG-3 + BUG-5 FIX: generateResponse
   * - يقرأ failedAttempts من aiContext في DB (لا hardcoded 0)
   * - يقرأ handoffAt من aiContext لحساب مدة الصمت
   */
  async generateResponse(params: {
    tenantId: string;
    conversationId: string;
    message: string;
  }): Promise<AIResponse> {
    // ✅ تحميل المحادثة أولاً لجلب storeId من القناة
    const conv = await this.conversationRepo.findOne({
      where: { id: params.conversationId },
      relations: ['channel'], // ✅ نحمّل القناة لجلب storeId
    });

    // ✅ storeId من Channel — يضمن عزل الإعدادات لكل متجر
    const storeId = conv?.channel?.storeId;

    const settings = await this.getSettings(params.tenantId, storeId);

    if (!settings.enabled) {
      return { reply: '', confidence: 0, shouldHandoff: false };
    }

    // ✅ BUG-3 + BUG-5: قراءة failedAttempts و handoffAt من aiContext
    const aiContext = (conv?.aiContext || {}) as Record<string, unknown>;

    const context: ConversationContext = {
      conversationId: params.conversationId,
      tenantId: params.tenantId,
      storeId,
      customerId: conv?.customerId || '',
      customerName: conv?.customerName || undefined,
      channel: conv?.channelId || '',
      messageCount: conv?.messagesCount || 0,
      failedAttempts: (aiContext.failedAttempts as number) || 0,
      isHandedOff: conv?.handler === ConversationHandler.HUMAN,
      handoffAt: aiContext.handoffAt as string | undefined,
      previousMessages: [],
    };

    // جلب آخر 10 رسائل
    if (conv) {
      const msgs = await this.messageRepo.find({
        where: { conversationId: params.conversationId },
        order: { createdAt: 'DESC' },
        take: 10,
      });

      context.previousMessages = msgs.reverse().map((m) => ({
        role:
          m.direction === MessageDirection.OUTBOUND
            ? ('assistant' as const)
            : ('user' as const),
        content: m.content || '',
      }));
    }

    return this.processMessage(params.message, context, settings);
  }

  async analyzeMessage(
    message: string,
  ): Promise<{ intent: string; sentiment: string; confidence: number }> {
    const lower = message.toLowerCase();
    let intent = 'general';
    let sentiment = 'neutral';

    if (lower.includes('طلب') || lower.includes('order')) {
      intent = 'order_inquiry';
    } else if (lower.includes('شكر') || lower.includes('thank')) {
      intent = 'thanks';
      sentiment = 'positive';
    } else if (lower.includes('مشكل') || lower.includes('problem')) {
      intent = 'complaint';
      sentiment = 'negative';
    } else if (lower.includes('مرحب') || lower.includes('السلام')) {
      intent = 'greeting';
      sentiment = 'positive';
    }

    return { intent, sentiment, confidence: 0.8 };
  }

  async trainBot(
    tenantId: string,
    data: {
      faqs?: Array<{ question: string; answer: string }>;
      documents?: Array<{ title: string; content: string }>;
    },
  ): Promise<{ status: string; entriesAdded: number }> {
    let added = 0;

    if (data.faqs?.length) {
      for (const faq of data.faqs) {
        await this.addKnowledge(tenantId, {
          title: faq.question,
          content: faq.answer,
          category: 'general',
        });
        added++;
      }
    }

    if (data.documents?.length) {
      for (const doc of data.documents) {
        await this.addKnowledge(tenantId, {
          title: doc.title,
          content: doc.content,
          category: 'general',
        });
        added++;
      }
    }

    return { status: 'completed', entriesAdded: added };
  }

  async getTrainingStatus(tenantId: string): Promise<{
    status: string;
    totalEntries: number;
    categories: Record<string, number>;
  }> {
    const result = await this.knowledgeRepo
      .createQueryBuilder('kb')
      .select('kb.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('kb.tenantId = :tenantId', { tenantId })
      .groupBy('kb.category')
      .getRawMany();

    const categories: Record<string, number> = {};
    let total = 0;
    for (const r of result) {
      categories[r.category] = parseInt(r.count);
      total += parseInt(r.count);
    }

    return { status: 'ready', totalEntries: total, categories };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 ANALYTICS — محسوبة من DB الحقيقي
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ BUG-10: avgResponseTime محسوب من ai_metadata->>'processingTime'
   * ✅ BUG-10: avgResponseTime محسوب من firstResponseAt (نفس نمط message.service.ts)
   * ✅ BUG-11: handoffRate يحسب المحادثات المحوّلة (handler='human' + default='ai')
   *
   * ⚠️ لا نستخدم JSONB ->> لأن المشروع لا يستخدمه — نعتمد على TypeORM property names
   */
  async getStats(tenantId: string): Promise<{
    totalResponses: number;
    successRate: number;
    avgResponseTime: number;
    handoffRate: number;
  }> {
    // عدد المحادثات المُدارة بالـ AI حالياً
    const totalAI = await this.conversationRepo.count({
      where: { tenantId, handler: ConversationHandler.AI },
    });

    // ✅ BUG-11 FIX: المحادثات المحوّلة للبشري
    // default handler = AI → أي محادثة handler='human' تعني تم التحويل
    const handoffs = await this.conversationRepo.count({
      where: { tenantId, handler: ConversationHandler.HUMAN },
    });

    const total = totalAI + handoffs;

    // عدد رسائل البوت (aiMetadata موجود = رد AI)
    const botMessages = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.direction = :dir', { dir: MessageDirection.OUTBOUND })
      .andWhere('m.aiMetadata IS NOT NULL')
      .getCount();

    // ✅ BUG-10 FIX: متوسط وقت الرد — نفس نمط message.service.ts getMessageStats()
    // نستخدم firstResponseAt - createdAt من Conversation (بدل JSONB parsing)
    const avgResult = await this.conversationRepo
      .createQueryBuilder('c')
      .select(
        'AVG(EXTRACT(EPOCH FROM (c.firstResponseAt - c.createdAt)) * 1000)',
        'avg',
      )
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.firstResponseAt IS NOT NULL')
      .getRawOne();

    return {
      totalResponses: botMessages,
      successRate:
        total > 0 ? Math.round((totalAI / total) * 100) : 0,
      avgResponseTime: Math.round(parseFloat(avgResult?.avg) || 0),
      handoffRate:
        total > 0 ? Math.round((handoffs / total) * 100) : 0,
    };
  }

  async getAnalytics(tenantId: string, period: string) {
    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    const conversations = await this.conversationRepo.find({
      where: { tenantId, createdAt: Between(startDate, now) },
      select: ['id', 'handler', 'status', 'createdAt'],
    });

    const totalConversations = conversations.length;
    const aiHandled = conversations.filter(
      (c) => c.handler === ConversationHandler.AI,
    ).length;
    const humanHandoff = conversations.filter(
      (c) => c.handler === ConversationHandler.HUMAN,
    ).length;

    const dailyData = await this.conversationRepo
      .createQueryBuilder('c')
      .select('DATE(c.createdAt)', 'date')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        `COUNT(CASE WHEN c.handler = 'ai' THEN 1 END)`,
        'ai_handled',
      )
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: now,
      })
      .groupBy('DATE(c.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      period,
      summary: {
        totalConversations,
        aiHandled,
        humanHandoff,
        successRate:
          totalConversations > 0
            ? Math.round(
                (aiHandled / totalConversations) * 100 * 10,
              ) / 10
            : 0,
      },
      trends: dailyData.map((d: Record<string, string>) => ({
        date: d.date,
        conversations: parseInt(d.total),
        aiHandled: parseInt(d.ai_handled),
      })),
    };
  }

  detectLanguage(text: string): 'ar' | 'en' {
    return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
  }
}
