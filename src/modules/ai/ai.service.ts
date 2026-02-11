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
import { Store, StorePlatform, StoreStatus } from '../stores/entities/store.entity';
import {
  Conversation,
  ConversationHandler,
  Message,
  MessageDirection,
  Order,
} from '@database/entities';

// ✅ Services
import { SallaApiService, SallaProduct } from '../stores/salla-api.service';

// ✅ Utils
import { decrypt } from '@common/utils/encryption.util';

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
  storeIntroduction: string;
  workingHours: string;
  returnPolicy: string;
  shippingInfo: string;

  // Custom Messages
  welcomeMessage: string;
  fallbackMessage: string;
  handoffMessage: string;

  // ✅ Level 2: Dynamic Thresholds
  highSimilarityThreshold?: number; // Default: 0.85 - skip verifier
  mediumSimilarityThreshold?: number; // Default: 0.72 - run verifier
  lowSimilarityThreshold?: number; // Default: 0.5 - direct clarification
  
  // ✅ Level 2: Confidence Thresholds
  answerConfidenceThreshold?: number; // Default: 0.75 - provide answer
  clarifyConfidenceThreshold?: number; // Default: 0.5 - ask clarification
  // Below clarifyConfidenceThreshold = handoff

  // ✅ Level 2: Performance Settings
  enableParallelSearch?: boolean; // Default: true
  enableProductCache?: boolean; // Default: true
  productCacheTTL?: number; // Default: 300 seconds
  skipVerifierOnHighConfidence?: boolean; // Default: true
  
  // ✅ Level 2: Timeouts and Rate Limits
  openaiTimeout?: number; // Default: 30000 ms (30 seconds)
  productSearchTimeout?: number; // Default: 10000 ms (10 seconds)
  maxRetries?: number; // Default: 2
  retryDelay?: number; // Default: 1000 ms
}

export interface ConversationContext {
  conversationId: string;
  tenantId: string;
  storeId?: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
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

/** ✅ Level 2: Extended Intent Classification with routing strategy */
export enum IntentType {
  GREETING = 'GREETING',
  SMALLTALK = 'SMALLTALK',
  PRODUCT_QUESTION = 'PRODUCT_QUESTION',
  POLICY_SUPPORT_FAQ = 'POLICY_SUPPORT_FAQ',
  COMPLAINT_ESCALATION = 'COMPLAINT_ESCALATION',
  ORDER_QUERY = 'ORDER_QUERY',
  HUMAN_REQUEST = 'HUMAN_REQUEST',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  UNKNOWN = 'UNKNOWN',
}

/** ✅ Level 2: Intent Result with routing strategy and allowed sources */
interface IntentResult {
  intent: IntentType;
  confidence: number;
  strategy?: SearchPriority;
  allowedSources?: ('library' | 'products')[];
}

/** أنماط الأسئلة البسيطة التي لا تحتاج RAG */
/**
 * ✅ FIX-A: فصل التحيات الحقيقية عن الكلام الاجتماعي
 * التحيات → رسالة ترحيب
 * الكلام الاجتماعي → رد اجتماعي مختلف (الحمدلله بخير، إلخ)
 */
const PURE_GREETING_PATTERNS = [
  'مرحبا', 'السلام عليكم', 'أهلا', 'هلا', 'هاي', 'حياك', 'يا هلا', 'الو',
  'سلام', 'هلو', 'صباح الخير', 'مساء الخير',
  'hello', 'hi', 'hey', 'good morning', 'good evening', 'howdy',
];

const SOCIAL_PATTERNS = [
  'اخبارك', 'أخبارك', 'كيفك', 'كيف حالك', 'كيف الحال',
  'شخبارك', 'شلونك', 'وش أخبارك', 'وش لونك', 'شحالك',
  'how are you', 'what\'s up', 'how\'s it going',
];

/** ✅ FIX-A: كل الأنماط مجتمعة للـ intent detection */
const GREETING_PATTERNS = [...PURE_GREETING_PATTERNS, ...SOCIAL_PATTERNS];
const THANKS_PATTERNS = [
  'شكرا', 'شكراً', 'مشكور', 'يعطيك العافية', 'الله يعافيك', 'تسلم',
  'thank', 'thanks', 'thx',
];

/** ✅ Level 2: Extended audit interface with confidence breakdown and citations */
export interface RagAudit {
  answer_source: 'library' | 'product' | 'tool' | 'greeting' | 'none';
  similarity_score: number;
  verifier_result: 'YES' | 'NO' | 'SKIPPED';
  final_decision: 'ANSWER' | 'CLARIFY' | 'HANDOFF' | 'BLOCKED';
  retrieved_chunks: number;
  gate_a_passed: boolean;
  gate_b_passed: boolean;
  // ✅ Level 2: Unified confidence breakdown
  confidence_breakdown?: {
    similarity_weight: number;
    intent_weight: number;
    verifier_weight: number;
    coverage_weight: number;
    final_confidence: number;
  };
  // ✅ Level 2: Internal citations (chunkId mapping)
  citations?: Array<{ chunkId: string; claim: string }>;
  // ✅ Level 2: Rejection reason for analytics
  rejection_reason?: 'GATE_A' | 'GATE_B' | 'GROUNDING' | 'LOW_CONFIDENCE' | 'OUT_OF_SCOPE';
  // ✅ Level 2: Intent tracking
  detected_intent?: IntentType;
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
  storeIntroduction: '',
  workingHours: '',
  returnPolicy: '',
  shippingInfo: '',
  welcomeMessage: 'أهلاً وسهلاً! كيف يمكنني مساعدتك؟ 😊',
  fallbackMessage: 'عذراً، لم أتمكن من فهم طلبك. هل ترغب بتحويلك لأحد موظفينا؟',
  handoffMessage: 'سأحولك الآن لأحد أفراد فريقنا. سيتواصل معك قريباً! 🙋‍♂️',
  // ✅ Level 2: Dynamic Thresholds
  highSimilarityThreshold: 0.85,
  mediumSimilarityThreshold: 0.72,
  lowSimilarityThreshold: 0.5,
  answerConfidenceThreshold: 0.75,
  clarifyConfidenceThreshold: 0.5,
  // ✅ Level 2: Performance Settings
  enableParallelSearch: true,
  enableProductCache: true,
  productCacheTTL: 300,
  skipVerifierOnHighConfidence: true,
  // ✅ Level 2: Timeouts and Rate Limits
  openaiTimeout: 30000,
  productSearchTimeout: 10000,
  maxRetries: 2,
  retryDelay: 1000,
};

/** ✅ Level 2: Confidence weights for unified scoring */
const CONFIDENCE_WEIGHTS = {
  SIMILARITY: 0.40,
  INTENT: 0.20,
  VERIFIER: 0.30,
  COVERAGE: 0.10,
  // Note: Weights must sum to 1.0 for accurate confidence calculation
};

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private openai: OpenAI;
  private readonly isApiKeyConfigured: boolean;
  
  // ✅ Level 2: In-memory cache for product search results with insertion order tracking
  private readonly productCache = new Map<string, {
    result: { chunks: Array<{ title: string; content: string; score: number }>; topScore: number; gateAPassed: boolean };
    timestamp: number;
  }>();
  private readonly MAX_CACHE_SIZE = 1000;
  private lastCacheCleanup = 0;
  private readonly CACHE_CLEANUP_INTERVAL = 60000; // Cleanup at most once per minute

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly sallaApiService: SallaApiService,

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

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
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
  // 🔧 UTILITY HELPERS — Timeouts and Retries
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ Level 2: Timeout wrapper for promises
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * ✅ Level 2: Retry wrapper with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    retryDelay: number,
    operation: string
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < maxRetries) {
          // Exponential backoff with max cap of 30 seconds
          const delay = Math.min(retryDelay * Math.pow(2, attempt), 30000);
          this.logger.warn(`${operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.logger.error(`${operation} failed after ${maxRetries + 1} attempts`);
    throw lastError;
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
    // 3. ✅ Level 2: ENHANCED ORCHESTRATOR — Intent Routing → Dynamic Strategy → Unified Confidence
    // ═══════════════════════════════════════════════════════════════════════════

    const lang = settings.language !== 'en' ? 'ar' : 'en';

    // 3a. ✅ Level 2: Enhanced Intent Routing with strategy determination
    const intentResult = await this.routeIntent(message, settings);
    this.logger.log(`🧠 Intent: ${intentResult.intent} (confidence: ${intentResult.confidence}, strategy: ${intentResult.strategy || 'none'})`);

    // ──────────────────────────────────────────────────────────────────────────
    // 3b. ✅ SMALLTALK/GREETING → رد اجتماعي بدون بحث
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.SMALLTALK || intentResult.intent === IntentType.GREETING) {
      const socialReply = this.generateSocialReply(message, settings);
      await this.resetFailedAttempts(context);
      return {
        reply: socialReply,
        confidence: intentResult.confidence,
        shouldHandoff: false,
        intent: intentResult.intent,
        ragAudit: {
          answer_source: 'greeting',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: 0,
          gate_a_passed: true,
          gate_b_passed: true,
          detected_intent: intentResult.intent,
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3c. ✅ HUMAN_REQUEST → تحقق من العداد ثم تحويل
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.HUMAN_REQUEST) {
      // Emit analytics event for human request handoff
      this.eventEmitter.emit('ai.handoff', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        conversationId: context.conversationId,
        message,
        reason: 'CUSTOMER_REQUEST',
        intent: intentResult.intent,
        timestamp: new Date(),
      });
      
      await this.handleHandoff(context, settings, 'CUSTOMER_REQUEST');
      return {
        reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
        confidence: 1,
        shouldHandoff: true,
        handoffReason: 'CUSTOMER_REQUEST',
        intent: intentResult.intent,
        ragAudit: {
          answer_source: 'none',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'HANDOFF',
          retrieved_chunks: 0,
          gate_a_passed: true,
          gate_b_passed: true,
          detected_intent: intentResult.intent,
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3d. ✅ COMPLAINT_ESCALATION → تحويل مباشر
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.COMPLAINT_ESCALATION) {
      // Emit analytics event for complaint handoff
      this.eventEmitter.emit('ai.handoff', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        conversationId: context.conversationId,
        message,
        reason: 'COMPLAINT',
        intent: intentResult.intent,
        timestamp: new Date(),
      });
      
      await this.handleHandoff(context, settings, 'COMPLAINT');
      const complaintMsg = lang === 'ar'
        ? 'أنا آسف لما حصل. سأحولك لأحد مسؤولينا للمساعدة. 🙏'
        : 'I\'m sorry about that. I\'ll connect you with one of our managers for assistance. 🙏';
      return {
        reply: complaintMsg,
        confidence: 1,
        shouldHandoff: true,
        handoffReason: 'COMPLAINT',
        intent: intentResult.intent,
        ragAudit: {
          answer_source: 'none',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'HANDOFF',
          retrieved_chunks: 0,
          gate_a_passed: true,
          gate_b_passed: true,
          rejection_reason: 'OUT_OF_SCOPE',
          detected_intent: intentResult.intent,
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3e. ✅ OUT_OF_SCOPE → رفض مهذب
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.OUT_OF_SCOPE) {
      // Emit analytics event for out-of-scope question
      this.eventEmitter.emit('ai.out_of_scope', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        conversationId: context.conversationId,
        message,
        intent: intentResult.intent,
        timestamp: new Date(),
      });
      
      return {
        reply: lang === 'ar' 
          ? 'عذراً، هذا السؤال خارج نطاق تخصصي. أنا هنا للمساعدة بأسئلة متعلقة بالمتجر ومنتجاته. 😊'
          : 'Sorry, this question is outside my scope. I\'m here to help with store and product questions. 😊',
        confidence: 0.9,
        shouldHandoff: false,
        intent: intentResult.intent,
        ragAudit: {
          answer_source: 'none',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: 0,
          gate_a_passed: false,
          gate_b_passed: false,
          rejection_reason: 'OUT_OF_SCOPE',
          detected_intent: intentResult.intent,
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3f. ✅ ORDER_QUERY → أدوات مباشرة (بدون RAG)
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.ORDER_QUERY) {
      return this.handleOrderQuery(message, context, settings);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3g. ✅ UNKNOWN → طلب توضيح (مع عداد)
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.UNKNOWN) {
      return this.handleNoMatch(context, settings, lang, intentResult.intent);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3h. ✅ Level 2: PRODUCT_QUESTION / POLICY_SUPPORT_FAQ → Enhanced RAG with unified ranking
    // ──────────────────────────────────────────────────────────────────────────

    // ✅ Level 2: Use unified ranking for mixed sources, pass intent to enforce allowed sources
    const ragResult = settings.searchPriority === SearchPriority.LIBRARY_THEN_PRODUCTS
      ? await this.unifiedRanking(message, context, settings, intentResult)
      : await this.ragRetrieve(message, context, settings, intentResult);

    this.logger.log(`🔍 RAG Result`, {
      conversationId: context.conversationId,
      source: ragResult.source,
      topScore: ragResult.topScore.toFixed(3),
      chunksFound: ragResult.chunks.length,
    });

    // ✅ Level 2: Dynamic threshold-based decision with medium threshold
    const highThreshold = settings.highSimilarityThreshold ?? 0.85;
    const mediumThreshold = settings.mediumSimilarityThreshold ?? 0.72;
    const lowThreshold = settings.lowSimilarityThreshold ?? 0.5;
    
    // ✅ Level 2: Tiered threshold logic:
    // >= high: skip verifier
    // between medium and high: run verifier
    // between low and medium: force clarification (no answer generation)
    // < low: clarification/handoff
    
    // Check if score is too low for any answer
    if (ragResult.topScore < lowThreshold) {
      this.logger.log(`🚫 Score too low: ${ragResult.topScore.toFixed(3)} < ${lowThreshold} — direct clarification`);
      
      // Emit analytics event for low confidence
      this.eventEmitter.emit('ai.low_confidence', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        conversationId: context.conversationId,
        message,
        score: ragResult.topScore,
        threshold: lowThreshold,
        intent: intentResult.intent,
        timestamp: new Date(),
      });
      
      // Try settings-based answer first
      const settingsAnswer = await this.tryAnswerFromSettings(message, settings, context);
      if (settingsAnswer) {
        await this.resetFailedAttempts(context);
        return settingsAnswer;
      }
      
      return this.handleNoMatch(context, settings, lang, intentResult.intent);
    }
    
    // ✅ FIX: Between low and medium threshold → run verifier (NOT force clarification)
    // المشكلة السابقة: كان يرفض مباشرة بدون محاولة
    // الحل: نشغّل المحقق — GPT يقدر يفهم إن "تدخلوني" و "يوصل" نفس السياق حتى لو الـ embedding ما فهم
    if (ragResult.topScore >= lowThreshold && ragResult.topScore < mediumThreshold) {
      this.logger.log(`⚠️ Score between low and medium: ${ragResult.topScore.toFixed(3)} (${lowThreshold}-${mediumThreshold}) — running verifier before deciding`);
      
      // Emit analytics event for medium-low confidence
      this.eventEmitter.emit('ai.medium_low_confidence', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        conversationId: context.conversationId,
        message,
        score: ragResult.topScore,
        thresholds: { low: lowThreshold, medium: mediumThreshold },
        intent: intentResult.intent,
        timestamp: new Date(),
      });
      
      // ✅ FIX: شغّل المحقق — إذا قال YES نكمل، إذا NO نطلب توضيح
      if (ragResult.chunks.length > 0) {
        const verifierResult = await this.verifyRelevance(message, ragResult.chunks);
        this.logger.log(`🔎 Medium-low verifier: ${verifierResult ? 'PASS' : 'FAIL'}`);
        
        if (verifierResult) {
          // المحقق أكد إن المقاطع تجاوب السؤال — نكمل لإنشاء الرد
          this.logger.log(`✅ Verifier PASSED for medium-low score — proceeding to answer generation`);
          // نكمل التدفق العادي (ما نرجع هنا، نتركه يكمل للأسفل)
        } else {
          // المحقق أكد إن المقاطع ما تجاوب — نطلب توضيح
          const settingsAnswer = await this.tryAnswerFromSettings(message, settings, context);
          if (settingsAnswer) {
            await this.resetFailedAttempts(context);
            return settingsAnswer;
          }
          return this.handleNoMatch(context, settings, lang, intentResult.intent);
        }
      } else {
        // ما فيه chunks أصلاً
        const settingsAnswer = await this.tryAnswerFromSettings(message, settings, context);
        if (settingsAnswer) {
          await this.resetFailedAttempts(context);
          return settingsAnswer;
        }
        return this.handleNoMatch(context, settings, lang, intentResult.intent);
      }
    }

    // ✅ Level 2: Determine if we should skip verifier (score >= high threshold)
    const skipVerifier = (settings.skipVerifierOnHighConfidence ?? true) && ragResult.topScore >= highThreshold;
    
    let verifierPassed = true; // Default to true if skipped
    
    if (!skipVerifier && ragResult.chunks.length > 0) {
      // Run verifier for medium-high confidence (between medium and high thresholds)
      verifierPassed = await this.verifyRelevance(message, ragResult.chunks);
      this.logger.log(`🔎 Verifier: ${verifierPassed ? 'PASS' : 'FAIL'}, score: ${ragResult.topScore.toFixed(3)}`);
      
      if (!verifierPassed) {
        // Emit analytics event for verifier failure (Gate B)
        this.eventEmitter.emit('ai.gate_b_failed', {
          tenantId: context.tenantId,
          storeId: context.storeId,
          conversationId: context.conversationId,
          message,
          score: ragResult.topScore,
          intent: intentResult.intent,
          timestamp: new Date(),
        });
        
        // Try settings-based answer
        const settingsAnswer = await this.tryAnswerFromSettings(message, settings, context);
        if (settingsAnswer) {
          await this.resetFailedAttempts(context);
          return settingsAnswer;
        }
        
        return this.handleNoMatch(context, settings, lang, intentResult.intent);
      }
    } else if (skipVerifier) {
      this.logger.log(`⚡ Skipping verifier for high confidence: ${ragResult.topScore.toFixed(3)} >= ${highThreshold}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. ✅ Level 2: Answer Generation with Strict Grounding
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
      // ✅ Level 2: Apply timeout and retry to OpenAI call
      const timeout = settings.openaiTimeout ?? 30000;
      const maxRetries = settings.maxRetries ?? 2;
      const retryDelay = settings.retryDelay ?? 1000;
      
      const completion = await this.withTimeout(
        this.withRetry(
          () => this.openai.chat.completions.create({
            model: settings.model || AI_DEFAULTS.model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: tools.length > 0 ? 'auto' : undefined,
            temperature: 0.3,
            max_tokens: settings.maxTokens || 1000,
          }),
          maxRetries,
          retryDelay,
          'OpenAI chat completion'
        ),
        timeout,
        'OpenAI chat completion'
      );

      const assistantMsg = completion.choices[0]?.message;
      if (!assistantMsg) throw new Error('No response from OpenAI');

      let finalReply = assistantMsg.content || '';
      const toolsUsed: string[] = [];
      let finalSource: RagAudit['answer_source'] = ragResult.source === 'product' ? 'product' : 'library';

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

        const followUp = await this.withTimeout(
          this.withRetry(
            () => this.openai.chat.completions.create({
              model: settings.model || AI_DEFAULTS.model,
              messages: toolMessages,
              temperature: 0.3,
              max_tokens: settings.maxTokens || 1000,
            }),
            maxRetries,
            retryDelay,
            'OpenAI follow-up completion'
          ),
          timeout,
          'OpenAI follow-up completion'
        );

        finalReply = followUp.choices[0]?.message?.content || finalReply;
        finalSource = 'tool';
      }

      // ✅ Level 2: Post-generation grounding validation
      const groundingResult = await this.validateAnswerGrounding(finalReply, ragResult.chunks);
      
      if (!groundingResult.isGrounded) {
        this.logger.warn(`🛡️ Grounding validation FAILED — blocking answer`);
        
        // Emit analytics event for grounding failure
        this.eventEmitter.emit('ai.grounding_failed', {
          tenantId: context.tenantId,
          storeId: context.storeId,
          conversationId: context.conversationId,
          message,
          answer: finalReply,
          intent: intentResult.intent,
          score: ragResult.topScore,
          timestamp: new Date(),
        });
        
        // Return "لا أقدر أجاوب" fallback
        const noAnswerMessage = lang === 'ar'
          ? 'لا أقدر أجاوب على هذا السؤال بناءً على المعلومات المتوفرة لدي حالياً.'
          : 'I cannot answer this question based on the information currently available to me.';
        
        return {
          reply: noAnswerMessage,
          confidence: 0,
          shouldHandoff: false,
          intent: intentResult.intent,
          ragAudit: {
            answer_source: 'none',
            similarity_score: ragResult.topScore,
            verifier_result: verifierPassed ? 'YES' : 'NO',
            final_decision: 'BLOCKED',
            retrieved_chunks: ragResult.chunks.length,
            gate_a_passed: true,
            gate_b_passed: verifierPassed,
            rejection_reason: 'GROUNDING',
            detected_intent: intentResult.intent,
          },
        };
      }

      // ✅ Level 2: Calculate unified confidence
      const confidenceCalc = this.calculateUnifiedConfidence({
        similarityScore: ragResult.topScore,
        intentConfidence: intentResult.confidence,
        verifierPassed,
        retrievedChunks: ragResult.chunks.length,
      });

      this.logger.log(`📊 Unified Confidence: ${confidenceCalc.finalConfidence.toFixed(3)} (sim: ${confidenceCalc.breakdown.similarity_weight.toFixed(2)}, intent: ${confidenceCalc.breakdown.intent_weight.toFixed(2)}, verifier: ${confidenceCalc.breakdown.verifier_weight.toFixed(2)}, coverage: ${confidenceCalc.breakdown.coverage_weight.toFixed(2)})`);

      // ✅ Level 2: Confidence-based decision
      const answerThreshold = settings.answerConfidenceThreshold ?? 0.75;
      const clarifyThreshold = settings.clarifyConfidenceThreshold ?? 0.5;

      if (confidenceCalc.finalConfidence < clarifyThreshold) {
        // Low confidence → handoff or clarify
        this.logger.log(`⚠️ Low confidence (${confidenceCalc.finalConfidence.toFixed(3)} < ${clarifyThreshold}) — requesting clarification`);
        return this.handleNoMatch(context, settings, lang, intentResult.intent);
      } else if (confidenceCalc.finalConfidence < answerThreshold) {
        // Medium confidence → provide answer with clarification offer
        this.logger.log(`⚠️ Medium confidence (${confidenceCalc.finalConfidence.toFixed(3)} < ${answerThreshold}) — answering with caveat`);
        const caveat = lang === 'ar' ? '\n\nإذا كنت تحتاج تفاصيل أكثر، تقدر تسألني! 😊' : '\n\nIf you need more details, feel free to ask! 😊';
        finalReply = finalReply + caveat;
      }

      return {
        reply: finalReply,
        confidence: confidenceCalc.finalConfidence,
        intent: intentResult.intent,
        shouldHandoff: false,
        toolsUsed,
        ragAudit: {
          answer_source: finalSource,
          similarity_score: ragResult.topScore,
          verifier_result: skipVerifier ? 'SKIPPED' : (verifierPassed ? 'YES' : 'NO'),
          final_decision: 'ANSWER',
          retrieved_chunks: ragResult.chunks.length,
          gate_a_passed: true,
          gate_b_passed: verifierPassed,
          confidence_breakdown: confidenceCalc.breakdown,
          citations: groundingResult.citations,
          detected_intent: intentResult.intent,
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

    /**
     * ✅ FIX-A: كشف نوع SMALLTALK بدقة
     * - تحية حقيقية (هلا، مرحبا) → رسالة ترحيب
     * - كلام اجتماعي (اخبارك، كيفك) → رد اجتماعي مختلف
     * - شكر → رد شكر
     */
    const isPureGreeting = PURE_GREETING_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
    const isSocial = SOCIAL_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
    const isThanks = THANKS_PATTERNS.some((p) => lower.includes(p.toLowerCase()));

    // ✅ FIX-C: الكلام الاجتماعي يأخذ أولوية على التحية
    // لأن "هلا اخبارك" يجب أن يُرد عليها "الحمدلله بخير" مش "أهلاً وسهلاً"
    if (isSocial) {
      const socialReplies: Record<string, Record<string, string[]>> = {
        formal: {
          ar: [
            'شكرًا لسؤالك. كيف يمكنني مساعدتك؟',
            'الحمد لله. كيف أستطيع خدمتك؟',
          ],
          en: [
            'Thank you for asking. How can I assist you?',
            'I appreciate that. How may I help you?',
          ],
        },
        friendly: {
          ar: [
            'الحمدلله بخير! كيف أقدر أساعدك اليوم؟ 😊',
            'الله يسلمك! تفضل كيف أقدر أخدمك؟ 😊',
            'بخير الحمدلله! وش أقدر أسوي لك؟',
          ],
          en: [
            "I'm doing great, thanks! How can I help you? 😊",
            "All good, thanks for asking! What can I do for you?",
          ],
        },
        professional: {
          ar: [
            'الحمد لله بخير. كيف أستطيع مساعدتك؟',
            'بخير شكرًا لك. تفضل بسؤالك.',
          ],
          en: [
            "I'm well, thank you. How can I help you?",
            "Doing well, thanks. Please go ahead with your question.",
          ],
        },
      };

      const replies = socialReplies[tone]?.[isAr ? 'ar' : 'en'] || socialReplies.friendly[isAr ? 'ar' : 'en'];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    if (isPureGreeting) {
      // ✅ FIX-C: رسالة الترحيب المخصصة فقط للتحيات الحقيقية
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
    intentType: IntentType | string,
  ): Promise<AIResponse> {
    const maxAttempts = settings.handoffAfterFailures || AI_DEFAULTS.handoffAfterFailures;

    // زيادة العداد
    await this.incrementFailedAttempts(context);
    const currentAttempts = (context.failedAttempts || 0) + 1;

    this.logger.log(`📊 Failed attempts: ${currentAttempts}/${maxAttempts} for conversation ${context.conversationId} (intent: ${intentType})`);

    // ✅ Level 2: Track unanswered question for learning loop
    this.eventEmitter.emit('ai.unanswered_question', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      conversationId: context.conversationId,
      message: context.previousMessages[context.previousMessages.length - 1]?.content || '',
      attempt: currentAttempts,
      maxAttempts,
      intent: intentType,
      timestamp: new Date(),
    });

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
          final_decision: 'CLARIFY',
          retrieved_chunks: 0,
          gate_a_passed: false,
          gate_b_passed: false,
          rejection_reason: 'LOW_CONFIDENCE',
          detected_intent: typeof intentType === 'string' ? undefined : intentType,
        },
      };
    }

    // ✅ وصل للحد الأقصى → اعرض التحويل البشري
    this.logger.log(`🔄 Max attempts reached (${currentAttempts}/${maxAttempts}) — offering handoff`);

    if (settings.autoHandoff) {
      // Emit handoff analytics event
      this.eventEmitter.emit('ai.handoff', {
        tenantId: context.tenantId,
        storeId: context.storeId,
        conversationId: context.conversationId,
        message: context.previousMessages[context.previousMessages.length - 1]?.content || '',
        reason: 'NO_MATCH_AFTER_MAX_ATTEMPTS',
        intent: intentType,
        timestamp: new Date(),
      });
      
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
          final_decision: 'HANDOFF',
          retrieved_chunks: 0,
          gate_a_passed: false,
          gate_b_passed: false,
          rejection_reason: 'LOW_CONFIDENCE',
          detected_intent: typeof intentType === 'string' ? undefined : intentType,
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
  /**
   * ✅ FIX-ORDER-QUERY: معالجة استفسارات الطلبات مع fallback لـ RAG
   * 
   * المشكلة السابقة: كان يرسل GPT بـ ZERO chunks → GPT يرد بـ NO_MATCH_MESSAGE دائماً
   * 
   * الحل: 
   * 1. أولاً نحاول عبر أدوات (get_order_status)
   * 2. إذا GPT رد بـ NO_MATCH_MESSAGE أو رد فارغ → نسقط (fallback) لـ RAG العادي
   * 3. RAG يبحث في المكتبة والمنتجات كالمعتاد
   */
  private async handleOrderQuery(
    message: string,
    context: ConversationContext,
    settings: AISettings,
  ): Promise<AIResponse> {
    // ✅ FIX: نبحث في RAG أولاً لجلب chunks (إن وُجدت)
    const ragResult = settings.searchPriority === SearchPriority.LIBRARY_THEN_PRODUCTS
      ? await this.unifiedRanking(message, context, settings)
      : await this.ragRetrieve(message, context, settings);

    // ✅ FIX: نمرر chunks الحقيقية (وليس []) حتى لو كان ORDER_QUERY
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

      // ✅ FIX: إذا GPT رد بـ NO_MATCH_MESSAGE رغم وجود chunks → المشكلة في التصنيف
      // نحاول مرة ثانية بدون ORDER_QUERY intent (نعامله كـ FAQ)
      const isNoMatch = finalReply.includes('خارج نطاق المعلومات') || finalReply.includes('outside the scope');
      
      if (isNoMatch && ragResult.chunks.length === 0) {
        // لا chunks ولا نتيجة أداة → نرجع لـ handleNoMatch
        this.logger.warn('🔄 ORDER_QUERY: no chunks & no tool result — falling back to handleNoMatch');
        const lang = settings.language !== 'en' ? 'ar' : 'en';
        return this.handleNoMatch(context, settings, lang, IntentType.ORDER_QUERY);
      }

      await this.resetFailedAttempts(context);

      return {
        reply: finalReply,
        confidence: ragResult.chunks.length > 0 ? 0.9 : 0.7,
        intent: 'ORDER_QUERY',
        shouldHandoff: false,
        toolsUsed,
        ragAudit: {
          answer_source: toolsUsed.length > 0 ? 'tool' : (ragResult.chunks.length > 0 ? 'library' : 'none'),
          similarity_score: ragResult.topScore,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: ragResult.chunks.length,
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
   * ✅ Level 2: Applies timeout to embedding generation
   */
  private async generateEmbedding(text: string, timeout: number = 15000): Promise<number[] | null> {
    try {
      const response = await this.withTimeout(
        this.openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: text.substring(0, 8000), // حد أقصى
        }),
        timeout,
        'Embedding generation'
      );
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
    timeout: number = 10000,
  ): Promise<boolean> {
    try {
      const chunksText = chunks
        .map((c) => {
          const answerPart = c.answer ? `\nالجواب: ${c.answer}` : '';
          return `[${c.title}]: ${c.content}${answerPart}`;
        })
        .join('\n');

      // ✅ Level 2: Apply timeout to verifier
      const response = await this.withTimeout(
        this.openai.chat.completions.create({
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
        }),
        timeout,
        'Verifier'
      );

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
   * ✅ RAG Retrieve: يدير كامل عملية البحث الدلالي مع دعم multi-source
   * 1. يحدد search priority (library_only, products_only, library_then_products)
   * 2. يبحث في المصدر/المصادر المطلوبة
   * 3. فحص عتبة التشابه (Gate A)
   * 4. يرجع النتائج مع حالة البوابات وmetadata عن المصدر
   * ✅ Level 2: Enforces allowed sources from intent routing
   */
  private async ragRetrieve(
    message: string,
    context: ConversationContext,
    settings: AISettings,
    intentResult?: IntentResult,
  ): Promise<{
    chunks: Array<{ title: string; content: string; score: number; answer?: string }>;
    topScore: number;
    gateAPassed: boolean;
    source: 'library' | 'product' | 'mixed';
  }> {
    // ✅ Level 2: Respect intent-based allowed sources
    const allowedSources = intentResult?.allowedSources || ['library', 'products'];
    const canSearchLibrary = allowedSources.includes('library');
    const canSearchProducts = allowedSources.includes('products');
    
    if (allowedSources.length === 0) {
      this.logger.log('🚫 Intent restricts all sources - no search allowed');
      return { chunks: [], topScore: 0, gateAPassed: false, source: 'library' };
    }
    
    const sp = intentResult?.strategy || settings.searchPriority || SearchPriority.LIBRARY_THEN_PRODUCTS;
    this.logger.log(`🔍 RAG Retrieve: searchPriority=${sp}, storeId=${context.storeId || 'none'}, allowedSources=${allowedSources.join(', ')}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // MODE 1: PRODUCTS_ONLY — البحث فقط في المنتجات
    // ═══════════════════════════════════════════════════════════════════════════
    if (sp === SearchPriority.PRODUCTS_ONLY && canSearchProducts) {
      this.logger.log('🛒 Search mode: PRODUCTS_ONLY');
      
      if (!context.storeId) {
        this.logger.warn('🚫 PRODUCTS_ONLY mode: no storeId available');
        return { chunks: [], topScore: 0, gateAPassed: false, source: 'product' };
      }

      const productResult = await this.searchProducts(message, context.storeId, settings);
      return { ...productResult, source: 'product' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MODE 2: LIBRARY_ONLY — البحث فقط في المكتبة (هجين: semantic + keyword)
    // ═══════════════════════════════════════════════════════════════════════════
    if (sp === SearchPriority.LIBRARY_ONLY && canSearchLibrary) {
      this.logger.log('📚 Search mode: LIBRARY_ONLY');
      
      // توليد embedding
      const queryEmbedding = await this.generateEmbedding(message);
      if (!queryEmbedding) {
        this.logger.warn('Failed to generate query embedding — falling back to keyword search');
        const fallback = await this.fallbackKeywordSearch(message, context.tenantId);
        return { ...fallback, source: 'library' };
      }

      // بحث دلالي في المكتبة
      const results = await this.semanticSearch(queryEmbedding, context.tenantId);

      if (results.length === 0) {
        // ✅ FIX: لا نتائج من semantic → جرب keyword search
        this.logger.log('📚 No semantic matches — trying keyword fallback');
        const keywordResult = await this.fallbackKeywordSearch(message, context.tenantId);
        if (keywordResult.chunks.length > 0) {
          this.logger.log(`📚 Keyword fallback found ${keywordResult.chunks.length} chunks, topScore=${keywordResult.topScore.toFixed(3)}`);
          return { ...keywordResult, source: 'library' };
        }
        return { chunks: [], topScore: 0, gateAPassed: false, source: 'library' };
      }

      const topScore = results[0].score;
      const gateAPassed = topScore >= SIMILARITY_THRESHOLD;

      // ✅ FIX: إذا semantic score ضعيف → ادمج مع keyword search لتحسين النتائج
      if (!gateAPassed) {
        this.logger.log(`📚 Semantic score low (${topScore.toFixed(3)}) — trying hybrid with keyword search`);
        const keywordResult = await this.fallbackKeywordSearch(message, context.tenantId);
        
        if (keywordResult.chunks.length > 0) {
          // ادمج النتائج: إذا keyword لقى نفس المقال = boost score
          const mergedChunks = this.mergeSearchResults(results, keywordResult.chunks);
          const mergedTop = mergedChunks[0]?.score || topScore;
          this.logger.log(`📚 Hybrid search: merged ${mergedChunks.length} chunks, boostedTopScore=${mergedTop.toFixed(3)}`);
          
          return {
            chunks: mergedChunks,
            topScore: mergedTop,
            gateAPassed: mergedTop >= SIMILARITY_THRESHOLD,
            source: 'library',
          };
        }
      }

      this.logger.log(`📚 Library search: ${results.length} chunks, topScore=${topScore.toFixed(3)}, gateA=${gateAPassed ? 'PASS' : 'FAIL'}`);

      return {
        chunks: results,
        topScore,
        gateAPassed,
        source: 'library',
      };
    }

    // ✅ Level 2: If intent restricts source but mode doesn't match, return empty
    if (!canSearchLibrary && sp !== SearchPriority.PRODUCTS_ONLY) {
      this.logger.log('🚫 Intent restricts library search but mode requires it');
      return { chunks: [], topScore: 0, gateAPassed: false, source: 'library' };
    }
    if (!canSearchProducts && sp !== SearchPriority.LIBRARY_ONLY) {
      this.logger.log('🚫 Intent restricts product search but mode requires it');
      return { chunks: [], topScore: 0, gateAPassed: false, source: 'library' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MODE 3: LIBRARY_THEN_PRODUCTS — بحث هجين في المكتبة أولاً، ثم المنتجات
    // ═══════════════════════════════════════════════════════════════════════════
    this.logger.log('📚🛒 Search mode: LIBRARY_THEN_PRODUCTS');

    // 1. محاولة البحث في المكتبة (semantic + keyword hybrid)
    const queryEmbedding = await this.generateEmbedding(message);
    let libraryResults: Array<{ title: string; content: string; score: number; answer?: string }> = [];
    
    if (canSearchLibrary && queryEmbedding) {
      libraryResults = await this.semanticSearch(queryEmbedding, context.tenantId);
      
      // ✅ FIX: إذا semantic score ضعيف أو صفر → جرب keyword وادمج
      const semanticTop = libraryResults[0]?.score || 0;
      if (semanticTop < SIMILARITY_THRESHOLD) {
        this.logger.log(`📚 Semantic score low (${semanticTop.toFixed(3)}) — trying hybrid with keyword search`);
        const keywordResult = await this.fallbackKeywordSearch(message, context.tenantId);
        if (keywordResult.chunks.length > 0) {
          libraryResults = this.mergeSearchResults(libraryResults, keywordResult.chunks);
          this.logger.log(`📚 Hybrid: merged to ${libraryResults.length} chunks, topScore=${libraryResults[0]?.score.toFixed(3)}`);
        }
      }
    } else if (canSearchLibrary) {
      this.logger.warn('Failed to generate query embedding — trying keyword search');
      const fallback = await this.fallbackKeywordSearch(message, context.tenantId);
      libraryResults = fallback.chunks;
    }

    // 2. إذا وجدنا نتائج جيدة في المكتبة → نستخدمها
    if (libraryResults.length > 0) {
      const topScore = libraryResults[0].score;
      const gateAPassed = topScore >= SIMILARITY_THRESHOLD;

      if (gateAPassed) {
        this.logger.log(`📚 Library match found: topScore=${topScore.toFixed(3)}`);
        return {
          chunks: libraryResults,
          topScore,
          gateAPassed: true,
          source: 'library',
        };
      } else {
        this.logger.log(`📚 Library score too low (${topScore.toFixed(3)} < ${SIMILARITY_THRESHOLD}), trying products...`);
      }
    } else {
      this.logger.log('📚 No results in library, trying products...');
    }

    // 3. المكتبة لم تنجح → نبحث في المنتجات
    if (!canSearchProducts) {
      this.logger.log('🚫 Products search not allowed by intent');
      return {
        chunks: libraryResults,
        topScore: libraryResults.length > 0 ? libraryResults[0].score : 0,
        gateAPassed: false,
        source: 'library',
      };
    }
    
    if (!context.storeId) {
      this.logger.warn('🚫 No storeId available for product search — returning library results (if any)');
      return {
        chunks: libraryResults,
        topScore: libraryResults.length > 0 ? libraryResults[0].score : 0,
        gateAPassed: false,
        source: 'library',
      };
    }

    const productResult = await this.searchProducts(message, context.storeId, settings);
    
    if (productResult.gateAPassed) {
      this.logger.log(`🛒 Product match found: ${productResult.chunks.length} products`);
      return { ...productResult, source: 'product' };
    }

    // 4. كلا المصدرين فشلا → نرجع أفضل ما لدينا
    this.logger.log('🚫 No matches in library or products');
    return {
      chunks: libraryResults.length > 0 ? libraryResults : productResult.chunks,
      topScore: libraryResults.length > 0 ? libraryResults[0].score : productResult.topScore,
      gateAPassed: false,
      source: libraryResults.length > 0 ? 'library' : 'product',
    };
  }

  /**
   * ✅ FIX: بحث كلمات مفتاحية محسّن (يشمل keywords و answer)
   * 
   * المشكلة السابقة: كان يبحث فقط في title و content
   * حقل keywords موجود بالـ entity بس ما يُستخدم أبداً!
   * 
   * الحل: يبحث في title + content + answer + keywords array
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

    // ✅ FIX: بحث OR في كل الحقول المهمة (title + content + answer + keywords)
    const conditions = words.map((_, i) => 
      `(kb.title ILIKE :w${i} OR kb.content ILIKE :w${i} OR kb.answer ILIKE :w${i} OR kb.keywords::text ILIKE :w${i})`
    );
    const params: Record<string, string> = {};
    words.forEach((w, i) => { params[`w${i}`] = `%${w}%`; });

    qb.andWhere(`(${conditions.join(' OR ')})`, params);
    qb.orderBy('kb.priority', 'ASC').take(RAG_TOP_K);

    const entries = await qb.getMany();

    if (entries.length === 0) {
      return { chunks: [], topScore: 0, gateAPassed: false };
    }

    // ✅ FIX: حساب score حسب عدد الكلمات المطابقة (أدق من score ثابت)
    const chunks = entries.map((e) => {
      const fullText = `${e.title} ${e.content} ${e.answer || ''} ${(e.keywords || []).join(' ')}`.toLowerCase();
      const matchCount = words.filter(w => fullText.includes(w.toLowerCase())).length;
      const matchRatio = matchCount / words.length;
      // Score بين 0.65 و 0.80 حسب نسبة التطابق
      const score = 0.65 + (matchRatio * 0.15);
      
      return {
        title: e.title,
        content: e.content,
        answer: e.answer || undefined,
        score,
      };
    }).sort((a, b) => b.score - a.score);

    return {
      chunks,
      topScore: chunks[0]?.score || 0,
      gateAPassed: chunks[0]?.score >= 0.72,
    };
  }

  /**
   * ✅ دمج نتائج البحث الدلالي والكلمات المفتاحية
   * 
   * إذا نفس المقال ظهر في كلا البحثين → boost score بـ 15%
   * هذا يحل مشكلة: semantic يلقى المقال بـ 0.60، keyword يلقاه بـ 0.70
   * → المدمج يعطيه 0.75+ فيعبر العتبة
   */
  private mergeSearchResults(
    semanticResults: Array<{ title: string; content: string; score: number; answer?: string }>,
    keywordResults: Array<{ title: string; content: string; score: number; answer?: string }>,
  ): Array<{ title: string; content: string; score: number; answer?: string }> {
    const merged = new Map<string, { title: string; content: string; score: number; answer?: string; sources: number }>();

    // أضف نتائج semantic
    for (const r of semanticResults) {
      const key = r.title.trim().toLowerCase();
      merged.set(key, { ...r, sources: 1 });
    }

    // ادمج نتائج keyword
    for (const r of keywordResults) {
      const key = r.title.trim().toLowerCase();
      const existing = merged.get(key);
      
      if (existing) {
        // ✅ نفس المقال في كلا البحثين → boost 15%
        existing.score = Math.min(existing.score * 1.15, 0.95);
        existing.sources = 2;
      } else {
        merged.set(key, { ...r, sources: 1 });
      }
    }

    // رتّب حسب score ثم عدد المصادر
    return Array.from(merged.values())
      .sort((a, b) => {
        if (b.sources !== a.sources) return b.sources - a.sources;
        return b.score - a.score;
      })
      .slice(0, RAG_TOP_K)
      .map(({ title, content, score, answer }) => ({ title, content, score, answer }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 PRODUCT SEARCH — البحث في منتجات سلة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ البحث في منتجات سلة
   * يستخدم Salla API للبحث عن المنتجات بالكلمات المفتاحية
   * يرجع نتائج منسقة كـ chunks للـ RAG
   */
  private async searchProducts(
    message: string,
    storeId: string,
    settings?: AISettings,
  ): Promise<{
    chunks: Array<{ title: string; content: string; score: number }>;
    topScore: number;
    gateAPassed: boolean;
  }> {
    // ✅ Level 2: Check cache first if enabled
    const enableCache = settings?.enableProductCache ?? true;
    const cacheTTL = (settings?.productCacheTTL ?? 300) * 1000; // Convert to ms
    
    if (enableCache) {
      // Generate cache key
      const words = message.split(/\s+/).filter((w) => w.length > 2);
      const keyword = words.slice(0, 3).join(' ').toLowerCase();
      const cacheKey = `${storeId}:${keyword}`;
      
      // Check if cache entry exists and is still valid
      const cached = this.productCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
        this.logger.log(`💾 Product cache HIT for key "${cacheKey}"`);
        return cached.result;
      }
      
      // Cache miss - fetch from API
      this.logger.log(`🔍 Product cache MISS for key "${cacheKey}"`);
    }
    
    try {
      // جلب معلومات المتجر مع access token
      const store = await this.storeRepo.findOne({
        where: { id: storeId },
        select: ['id', 'platform', 'status', 'accessToken'],
      });

      // التحقق من أن المتجر موجود ومتصل بسلة
      if (!store) {
        this.logger.warn(`🛒 Product search: store ${storeId} not found`);
        return { chunks: [], topScore: 0, gateAPassed: false };
      }

      if (store.platform !== StorePlatform.SALLA) {
        this.logger.debug(`🛒 Product search: store ${storeId} is not Salla (platform: ${store.platform})`);
        return { chunks: [], topScore: 0, gateAPassed: false };
      }

      if (store.status !== StoreStatus.ACTIVE) {
        this.logger.warn(`🛒 Product search: store ${storeId} is not active (status: ${store.status})`);
        return { chunks: [], topScore: 0, gateAPassed: false };
      }

      if (!store.accessToken) {
        this.logger.warn(`🛒 Product search: store ${storeId} has no access token`);
        return { chunks: [], topScore: 0, gateAPassed: false };
      }

      // فك تشفير الـ access token
      const accessToken = decrypt(store.accessToken);
      if (!accessToken) {
        this.logger.error(`🛒 Product search: failed to decrypt access token for store ${storeId}`);
        return { chunks: [], topScore: 0, gateAPassed: false };
      }

      // استخراج كلمات مفتاحية من السؤال
      const words = message.split(/\s+/).filter((w) => w.length > 2);
      const keyword = words.slice(0, 3).join(' '); // أخذ أول 3 كلمات كـ keyword

      this.logger.log(`🛒 Searching products: "${keyword}" in store ${storeId}`);

      // ✅ Level 2: Apply timeout to product search
      const searchTimeout = settings?.productSearchTimeout ?? 10000;
      const response = await this.withTimeout(
        this.sallaApiService.getProducts(accessToken, {
          keyword,
          perPage: RAG_TOP_K,
          status: 'active',
        }),
        searchTimeout,
        'Product search'
      );

      if (!response.data || response.data.length === 0) {
        this.logger.log(`🛒 No products found for keyword "${keyword}"`);
        const emptyResult = { chunks: [], topScore: 0, gateAPassed: false };
        
        // Cache empty results too (to avoid repeated API calls)
        if (enableCache) {
          const cacheKey = `${storeId}:${keyword.toLowerCase()}`;
          this.productCache.set(cacheKey, { result: emptyResult, timestamp: Date.now() });
        }
        
        return emptyResult;
      }

      // تحويل المنتجات إلى chunks
      const chunks = response.data.map((product: SallaProduct) => {
        const price = product.sale_price?.amount || product.price?.amount || 0;
        const currency = product.price?.currency || 'SAR';
        const inStock = product.quantity > 0 ? 'متوفر' : 'غير متوفر';
        
        return {
          title: product.name,
          content: `${product.description || 'لا يوجد وصف'}

السعر: ${price} ${currency}
الحالة: ${inStock}
رمز المنتج: ${product.sku || 'غير محدد'}`,
          score: 0.80, // نقاط ثابتة للمنتجات
        };
      });

      this.logger.log(`🛒 Found ${chunks.length} products`);

      const result = {
        chunks,
        topScore: chunks.length > 0 ? 0.80 : 0,
        gateAPassed: chunks.length > 0,
      };
      
      // ✅ Level 2: Store result in cache
      if (enableCache) {
        const cacheKey = `${storeId}:${keyword.toLowerCase()}`;
        this.productCache.set(cacheKey, { result, timestamp: Date.now() });
        this.logger.log(`💾 Product result cached for key "${cacheKey}"`);
        
        // ✅ Improved: Efficient cache cleanup with throttling
        // Clean up old cache entries periodically (at most once per minute)
        const now = Date.now();
        if (this.productCache.size > this.MAX_CACHE_SIZE && 
            (now - this.lastCacheCleanup) > this.CACHE_CLEANUP_INTERVAL) {
          this.lastCacheCleanup = now;
          
          // Remove oldest 20% of entries to reduce cleanup frequency
          const entriesToRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
          const keysToRemove: string[] = [];
          
          // Map maintains insertion order, so first entries are oldest
          for (const key of this.productCache.keys()) {
            keysToRemove.push(key);
            if (keysToRemove.length >= entriesToRemove) break;
          }
          
          for (const key of keysToRemove) {
            this.productCache.delete(key);
          }
          
          this.logger.log(`🧹 Cache cleanup: removed ${keysToRemove.length} oldest entries, size: ${this.productCache.size}`);
        }
      }

      return result;
    } catch (error) {
      this.logger.error('🛒 Product search failed', {
        error: error instanceof Error ? error.message : 'Unknown',
        storeId,
      });
      return { chunks: [], topScore: 0, gateAPassed: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎯 LEVEL 2: UNIFIED CONFIDENCE & GROUNDING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ Level 2: Calculate unified confidence score
   * Combines: similarity (40%) + intent (20%) + verifier (30%) + coverage (10%)
   */
  private calculateUnifiedConfidence(params: {
    similarityScore: number;
    intentConfidence: number;
    verifierPassed: boolean;
    retrievedChunks: number;
    targetChunks?: number;
  }): {
    finalConfidence: number;
    breakdown: {
      similarity_weight: number;
      intent_weight: number;
      verifier_weight: number;
      coverage_weight: number;
      final_confidence: number;
    };
  } {
    const targetChunks = params.targetChunks || RAG_TOP_K;
    
    // Normalize similarity to 0-1 range
    const normalizedSimilarity = Math.min(1, Math.max(0, params.similarityScore));
    
    // Verifier score: 1 if passed, 0 if failed
    const verifierScore = params.verifierPassed ? 1.0 : 0.0;
    
    // Coverage score: ratio of retrieved chunks to target
    const coverageScore = Math.min(1, params.retrievedChunks / targetChunks);
    
    // Calculate weighted confidence
    const similarityWeight = normalizedSimilarity * CONFIDENCE_WEIGHTS.SIMILARITY;
    const intentWeight = params.intentConfidence * CONFIDENCE_WEIGHTS.INTENT;
    const verifierWeight = verifierScore * CONFIDENCE_WEIGHTS.VERIFIER;
    const coverageWeight = coverageScore * CONFIDENCE_WEIGHTS.COVERAGE;
    
    const finalConfidence = similarityWeight + intentWeight + verifierWeight + coverageWeight;
    
    return {
      finalConfidence,
      breakdown: {
        similarity_weight: similarityWeight,
        intent_weight: intentWeight,
        verifier_weight: verifierWeight,
        coverage_weight: coverageWeight,
        final_confidence: finalConfidence,
      },
    };
  }

  /**
   * ✅ Level 2: Answer Grounding Validator
   * Post-generation validation to ensure answer is fully supported by sources
   * Returns true if answer is grounded, false otherwise
   */
  private async validateAnswerGrounding(
    answer: string,
    chunks: Array<{ title: string; content: string; answer?: string }>,
    timeout: number = 15000,
  ): Promise<{ isGrounded: boolean; citations: Array<{ chunkId: string; claim: string }> }> {
    if (!this.isApiKeyConfigured || chunks.length === 0) {
      return { isGrounded: true, citations: [] }; // Skip if no API or no chunks
    }

    try {
      const chunkTexts = chunks.map((c, i) => 
        `[${i}] ${c.title}\n${c.content}${c.answer ? `\n${c.answer}` : ''}`
      ).join('\n\n---\n\n');

      const prompt = `أنت مدقق صرامة. هل الجواب التالي مدعوم بالكامل من المصادر؟

المصادر:
${chunkTexts}

الجواب المقترح:
${answer}

قواعد:
- كل ادّعاء يجب أن يكون مدعوم مباشرة من المصادر
- إذا الجواب يضيف معلومات خارج المصادر = رد NO
- إذا الجواب صحيح ومدعوم كاملاً = رد YES

رد بـ JSON فقط:
{"grounded": true/false, "citations": [{"chunkId": "0", "claim": "النص المدعوم"}]}`;

      // ✅ Level 2: Apply timeout to grounding validator
      const response = await this.withTimeout(
        this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 300,
        }),
        timeout,
        'Grounding validation'
      );

      const raw = (response.choices[0]?.message?.content || '').trim();
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const result = JSON.parse(cleaned) as { grounded: boolean; citations: Array<{ chunkId: string; claim: string }> };

      this.logger.log(`🛡️ Grounding validation: ${result.grounded ? 'PASS' : 'FAIL'}, citations: ${result.citations.length}`);

      return {
        isGrounded: result.grounded,
        citations: result.citations || [],
      };
    } catch (error) {
      this.logger.error('Grounding validation error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      // ✅ Level 2: STRICT grounding - BLOCK on error (no auto-accept)
      // If validation fails due to error, assume NOT grounded to enforce "Zero خارج المصادر"
      this.logger.warn('⚠️ Grounding validator failed - BLOCKING answer due to validation error (strict mode)');
      return { isGrounded: false, citations: [] };
    }
  }

  /**
   * ✅ Level 2: Enhanced Intent Router
   * Routes messages to appropriate strategy based on intent and store settings
   */
  private async routeIntent(
    message: string,
    settings: AISettings,
  ): Promise<IntentResult> {
    // First, classify the intent
    const intentResult = await this.classifyIntent(message, settings);
    
    // Determine strategy and allowed sources based on intent
    let strategy: SearchPriority | undefined;
    let allowedSources: ('library' | 'products')[] | undefined;
    
    switch (intentResult.intent) {
      case IntentType.PRODUCT_QUESTION:
        // Product questions should prioritize products
        strategy = settings.searchPriority === SearchPriority.LIBRARY_ONLY 
          ? SearchPriority.LIBRARY_ONLY 
          : SearchPriority.PRODUCTS_ONLY;
        allowedSources = strategy === SearchPriority.LIBRARY_ONLY ? ['library'] : ['products'];
        break;
        
      case IntentType.POLICY_SUPPORT_FAQ:
        // Policy/FAQ should prioritize library
        strategy = settings.searchPriority === SearchPriority.PRODUCTS_ONLY
          ? SearchPriority.PRODUCTS_ONLY
          : SearchPriority.LIBRARY_ONLY;
        allowedSources = strategy === SearchPriority.PRODUCTS_ONLY ? ['products'] : ['library'];
        break;
        
      case IntentType.COMPLAINT_ESCALATION:
        // Complaints should trigger handoff
        strategy = undefined;
        allowedSources = [];
        break;
        
      case IntentType.OUT_OF_SCOPE:
        // Out of scope - no search needed
        strategy = undefined;
        allowedSources = [];
        break;
        
      default:
        // Use store default for other intents
        strategy = settings.searchPriority;
        allowedSources = ['library', 'products'];
        break;
    }
    
    return {
      ...intentResult,
      strategy,
      allowedSources,
    };
  }

  /**
   * ✅ Level 2: Unified Ranking for Mixed Sources
   * Fetches top-K from both KB and products, reranks, respects priority
   * ✅ Level 2: Enforces allowed sources from intent routing
   */
  private async unifiedRanking(
    message: string,
    context: ConversationContext,
    settings: AISettings,
    intentResult?: IntentResult,
  ): Promise<{
    chunks: Array<{ title: string; content: string; score: number; answer?: string }>;
    topScore: number;
    source: 'library' | 'product' | 'mixed';
  }> {
    const storeId = context.storeId;
    const searchPriority = intentResult?.strategy || settings.searchPriority || SearchPriority.LIBRARY_THEN_PRODUCTS;

    // ✅ Level 2: Respect intent-based allowed sources
    const allowedSources = intentResult?.allowedSources || ['library', 'products'];
    const canSearchLibrary = allowedSources.includes('library');
    const canSearchProducts = allowedSources.includes('products');
    
    this.logger.log(`🔍 Unified Ranking: allowedSources=${allowedSources.join(', ')}, priority=${searchPriority}`);
    
    if (allowedSources.length === 0) {
      return { chunks: [], topScore: 0, source: 'library' };
    }

    // Parallel search if enabled
    const enableParallel = settings.enableParallelSearch ?? true;
    
    // Generate embedding for library search
    const queryEmbedding = canSearchLibrary ? await this.generateEmbedding(message) : null;
    
    let libraryResults: Array<{ title: string; content: string; score: number; id: string; answer?: string }> = [];
    let productResults: { chunks: Array<{ title: string; content: string; score: number }>; topScore: number; gateAPassed: boolean } | null = null;

    if (enableParallel && searchPriority === SearchPriority.LIBRARY_THEN_PRODUCTS && storeId && canSearchLibrary && canSearchProducts && queryEmbedding) {
      // Parallel fetch
      [libraryResults, productResults] = await Promise.all([
        this.semanticSearch(queryEmbedding, context.tenantId),
        this.searchProducts(message, storeId, settings),
      ]);
    } else {
      // Sequential fetch
      if (canSearchLibrary && searchPriority !== SearchPriority.PRODUCTS_ONLY && queryEmbedding) {
        libraryResults = await this.semanticSearch(queryEmbedding, context.tenantId);
      }
      if (canSearchProducts && searchPriority !== SearchPriority.LIBRARY_ONLY && storeId) {
        productResults = await this.searchProducts(message, storeId, settings);
      }
    }

    // Collect all chunks with source tagging
    const allChunks: Array<{ title: string; content: string; score: number; source: 'library' | 'product'; answer?: string }> = [];
    
    if (canSearchLibrary && libraryResults && libraryResults.length > 0) {
      allChunks.push(...libraryResults.map(c => ({ 
        title: c.title, 
        content: c.content, 
        score: c.score, 
        answer: c.answer, 
        source: 'library' as const 
      })));
    }
    
    if (canSearchProducts && productResults && productResults.chunks.length > 0) {
      allChunks.push(...productResults.chunks.map(c => ({ ...c, source: 'product' as const })));
    }

    if (allChunks.length === 0) {
      return { chunks: [], topScore: 0, source: 'library' };
    }

    // Sort by score descending
    allChunks.sort((a, b) => b.score - a.score);

    // Respect priority by boosting scores
    if (searchPriority === SearchPriority.LIBRARY_THEN_PRODUCTS) {
      // Boost library scores by 10%
      allChunks.forEach(c => {
        if (c.source === 'library') c.score *= 1.1;
      });
      allChunks.sort((a, b) => b.score - a.score);
    } else if (searchPriority === SearchPriority.PRODUCTS_ONLY) {
      // Filter to products only
      const productChunks = allChunks.filter(c => c.source === 'product');
      return {
        chunks: productChunks.slice(0, RAG_TOP_K),
        topScore: productChunks[0]?.score || 0,
        source: 'product',
      };
    } else if (searchPriority === SearchPriority.LIBRARY_ONLY) {
      // Filter to library only
      const libraryChunks = allChunks.filter(c => c.source === 'library');
      return {
        chunks: libraryChunks.slice(0, RAG_TOP_K),
        topScore: libraryChunks[0]?.score || 0,
        source: 'library',
      };
    }

    // Take top K
    const topChunks = allChunks.slice(0, RAG_TOP_K);
    const hasBothSources = topChunks.some(c => c.source === 'library') && topChunks.some(c => c.source === 'product');

    return {
      chunks: topChunks.map(({ source, ...rest }) => rest), // Remove source tag from final output
      topScore: topChunks[0]?.score || 0,
      source: hasBothSources ? 'mixed' : topChunks[0]?.source || 'library',
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
        ? `أنت محلل نوايا متقدم لمتجر إلكتروني. صنّف رسالة العميل إلى واحد فقط من الأنواع التالية.
أجب فقط بـ JSON بدون أي نص آخر.

الأنواع:
- GREETING: تحية بسيطة فقط (مثل: مرحبا، السلام عليكم، هلا، صباح الخير) بدون أي سؤال
- SMALLTALK: كلام اجتماعي (مثل: كيفك، اخبارك، شلونك) بدون سؤال محدد
- PRODUCT_QUESTION: سؤال عن منتج معين، سعر، توفر، مواصفات (مثل: كم سعر المنتج X، هل متوفر، مواصفات)
- POLICY_SUPPORT_FAQ: سؤال عن سياسات المتجر، التوصيل، الإرجاع، ساعات العمل، معلومات عامة، أو سؤال عن خدمة/منتج بشكل عام (مثل: متى دوري، كم المدة، اذا طلبت/اشتريت)
- COMPLAINT_ESCALATION: شكوى أو طلب تصعيد أو استياء (مثل: غير راضي، مشكلة، اشتكي)
- ORDER_QUERY: استفسار عن حالة طلب موجود فعلياً، بوجود رقم طلب أو طلب تتبع حقيقي (مثل: وين طلبي رقم 1234، حالة الطلب، رقم التتبع)
- HUMAN_REQUEST: طلب صريح للتحدث مع موظف أو شخص بشري
- OUT_OF_SCOPE: سؤال خارج نطاق المتجر تماماً (مثل: سياسة، رياضة، طبخ)
- UNKNOWN: لا يمكن تحديد النوع

⚠️ قواعد مهمة:
- ORDER_QUERY فقط عند وجود رقم طلب أو استفسار عن حالة طلب فعلي (وين طلبي، رقم التتبع)
- "اذا طلبت/اشتريت X متى..." = POLICY_SUPPORT_FAQ (سؤال عام عن الخدمة وليس استفسار طلب)
- "متى دوري" أو "كم المدة" = POLICY_SUPPORT_FAQ
- إذا الرسالة تسأل عن معلومة محددة = ليست GREETING/SMALLTALK
- أسئلة المنتجات المحددة (سعر، مواصفات) = PRODUCT_QUESTION
- أسئلة السياسات العامة = POLICY_SUPPORT_FAQ`
        : `You are an advanced intent classifier for an online store. Classify the customer message into exactly one type.
Respond ONLY with JSON, no other text.

Types:
- GREETING: Simple greeting only (e.g., hi, hello, good morning) without any question
- SMALLTALK: Social talk (e.g., how are you, what's up) without specific question
- PRODUCT_QUESTION: Question about a specific product, price, availability, specs
- POLICY_SUPPORT_FAQ: Question about store policies, shipping, returns, hours, general info, or general service questions (e.g., if I buy X when will it arrive, how long does it take)
- COMPLAINT_ESCALATION: Complaint, escalation request, dissatisfaction
- ORDER_QUERY: ONLY for tracking an existing order with order number or explicit tracking request (e.g., where is my order #1234, tracking number, order status)
- HUMAN_REQUEST: Explicit request to speak to a human agent
- OUT_OF_SCOPE: Question completely outside store scope (politics, sports, cooking)
- UNKNOWN: Cannot determine

⚠️ Important rules:
- ORDER_QUERY is ONLY for existing order tracking (order number, "where is my order", tracking)
- "If I order/buy X when will..." = POLICY_SUPPORT_FAQ (general service question, NOT order query)
- "When is my turn" or "how long" = POLICY_SUPPORT_FAQ
- If message asks for specific info = NOT GREETING/SMALLTALK
- Specific product questions = PRODUCT_QUESTION
- General policy questions = POLICY_SUPPORT_FAQ`;

      const response = await this.withTimeout(
        this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `رسالة العميل: "${message}"\n\nأجب بـ JSON:\n{"intent":"...","confidence":0.00}` },
          ],
          temperature: 0,
          max_tokens: 50,
        }),
        10000, // 10 second timeout for intent classification
        'Intent classification'
      );

      const raw = (response.choices[0]?.message?.content || '').trim();
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { intent: string; confidence: number };

      // Map old intent names to new enum if needed
      let mappedIntent: IntentType;
      switch (parsed.intent) {
        case 'GREETING':
          mappedIntent = IntentType.GREETING;
          break;
        case 'SMALLTALK':
          mappedIntent = IntentType.SMALLTALK;
          break;
        case 'PRODUCT_QUESTION':
          mappedIntent = IntentType.PRODUCT_QUESTION;
          break;
        case 'POLICY_SUPPORT_FAQ':
        case 'SUPPORT_QUERY':
          mappedIntent = IntentType.POLICY_SUPPORT_FAQ;
          break;
        case 'COMPLAINT_ESCALATION':
          mappedIntent = IntentType.COMPLAINT_ESCALATION;
          break;
        case 'ORDER_QUERY':
          mappedIntent = IntentType.ORDER_QUERY;
          break;
        case 'HUMAN_REQUEST':
          mappedIntent = IntentType.HUMAN_REQUEST;
          break;
        case 'OUT_OF_SCOPE':
          mappedIntent = IntentType.OUT_OF_SCOPE;
          break;
        default:
          mappedIntent = IntentType.UNKNOWN;
      }

      this.logger.log(`🧠 Intent: ${mappedIntent} (${parsed.confidence}) for: "${message.substring(0, 50)}"`);
      return { intent: mappedIntent, confidence: parsed.confidence };

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

    // ✅ FIX: كلمات استفهام تعني إن الرسالة سؤال وليست تحية
    const QUESTION_INDICATORS = [
      'وش', 'ايش', 'ويش', 'إيش', 'ليش', 'ليه', 'كم', 'متى', 'وين', 'كيف',
      'هل', 'عندكم', 'عندك', 'فيه', 'اسم', 'سعر', 'منتج', 'توصيل', 'شحن',
      'ارجاع', 'إرجاع', 'استبدال', 'ضمان', 'دفع', 'تخفيض', 'عرض',
      'what', 'how', 'where', 'when', 'which', 'do you', 'can i', 'is there',
    ];
    const hasQuestion = QUESTION_INDICATORS.some((q) => lower.includes(q));

    // ✅ FIX: إذا في كلمة استفهام → ليست SMALLTALK أبداً (حتى لو فيها تحية)
    // مثال: "هلا وش اسم المتجر" → SUPPORT_QUERY مش SMALLTALK
    if (hasQuestion) {
      // طلب بشري واضح (أولوية أعلى)
      const humanKeywords = settings.handoffKeywords || AI_DEFAULTS.handoffKeywords;
      for (const kw of humanKeywords) {
        if (lower.includes(kw.toLowerCase())) {
          return { intent: IntentType.HUMAN_REQUEST, confidence: 0.95 };
        }
      }

      // استفسار طلب
      if (this.isOrderInquiry(message)) {
        return { intent: IntentType.ORDER_QUERY, confidence: 0.90 };
      }

      // فيه سؤال → لا نصنّف كـ SMALLTALK — نترك التصنيف للـ LLM
      return null;
    }

    // تحية فقط إذا الرسالة قصيرة (أقل من 30 حرف) وبدون سؤال
    if (lower.length < 30) {
      for (const p of GREETING_PATTERNS) {
        if (lower.includes(p.toLowerCase())) {
          return { intent: IntentType.SMALLTALK, confidence: 0.95 };
        }
      }
      for (const p of THANKS_PATTERNS) {
        if (lower.includes(p.toLowerCase())) {
          return { intent: IntentType.SMALLTALK, confidence: 0.95 };
        }
      }
    }

    // طلب بشري واضح
    const humanKeywords = settings.handoffKeywords || AI_DEFAULTS.handoffKeywords;
    for (const kw of humanKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { intent: IntentType.HUMAN_REQUEST, confidence: 0.95 };
      }
    }

    // استفسار طلب واضح
    if (this.isOrderInquiry(message)) {
      return { intent: IntentType.ORDER_QUERY, confidence: 0.90 };
    }

    return null; // لا يمكن التحديد بـ pattern → يحتاج LLM
  }

  /**
   * ✅ Fallback: تصنيف بدائي بدون LLM (إذا فشل API)
   */
  private fallbackIntentClassification(message: string): IntentResult {
    const lower = message.toLowerCase();

    // ✅ FIX: فحص كلمات الاستفهام أولاً — قبل فحص الطول
    const questionWords = ['وش', 'ايش', 'كم', 'هل', 'وين', 'متى', 'كيف', 'ليش', 'اسم', 'سعر',
      'what', 'how', 'where', 'when', 'which', 'price', 'name'];
    const hasQuestion = questionWords.some((q) => lower.includes(q));

    if (hasQuestion) {
      // ✅ FIX: استفسار طلب حقيقي فقط (باستخدام isOrderInquiry المحدّث)
      if (this.isOrderInquiry(message)) {
        return { intent: IntentType.ORDER_QUERY, confidence: 0.7 };
      }
      
      // فيه سؤال → Check if product or policy question
      const productWords = ['منتج', 'سعر', 'product', 'price', 'buy', 'purchase'];
      if (productWords.some(w => lower.includes(w))) {
        return { intent: IntentType.PRODUCT_QUESTION, confidence: 0.7 };
      }
      return { intent: IntentType.POLICY_SUPPORT_FAQ, confidence: 0.7 };
    }

    // ✅ FIX: استفسار طلب حقيقي (بدون كلمة استفهام — مثل "#12345")
    if (this.isOrderInquiry(message)) {
      return { intent: IntentType.ORDER_QUERY, confidence: 0.7 };
    }

    // فقط إذا الرسالة قصيرة جداً وبدون أي سؤال → SMALLTALK
    if (lower.length < 15) return { intent: IntentType.SMALLTALK, confidence: 0.6 };

    // افتراضي: سؤال دعم
    return { intent: IntentType.POLICY_SUPPORT_FAQ, confidence: 0.6 };
  }

  /**
   * ✅ FIX-ORDER: كشف استفسارات الطلبات بدقة
   * 
   * المشكلة السابقة: "طلب" كـ substring يطابق "طلبت"، "اطلب"، "مطلوب" — كلها ليست استفسار طلب!
   * 
   * الحل: 
   * 1. استخدام عبارات دقيقة (exact phrases) بدل كلمات مفردة
   * 2. التمييز بين "طلبي"/"الطلب" (استفسار) و"طلبت"/"اطلب" (فعل شراء عام)
   * 3. التحقق من وجود رقم طلب أو سياق تتبع واضح
   */
  private isOrderInquiry(message: string): boolean {
    const lower = message.toLowerCase();

    // ✅ عبارات تدل على استفسار طلب حقيقي (status inquiry)
    const exactOrderPatterns = [
      'طلبي',          // "وين طلبي" — استفسار واضح
      'رقم الطلب',     // "رقم الطلب 1234"
      'حالة الطلب',    // "حالة الطلب"
      'حالة طلبي',     // "حالة طلبي"
      'تتبع الطلب',    // "تتبع الطلب"
      'تتبع طلبي',     // "تتبع طلبي"
      'وين طلبي',      // "وين طلبي"
      'وين الطلب',     // "وين الطلب"
      'متى يوصل',      // "متى يوصل طلبي"
      'متى توصل',      // "متى توصل الشحنة"
      'أين طلبي',      // فصحى
      'أين الطلب',     // فصحى
      'رقم التتبع',    // "اعطني رقم التتبع"
      'رقم الشحنة',    // "رقم الشحنة"
      'order status',
      'track order',
      'tracking number',
      'where is my order',
      'my order',
    ];

    if (exactOrderPatterns.some((p) => lower.includes(p))) {
      return true;
    }

    // ✅ وجود رقم طلب (#1234 أو "طلب 1234" أو "order 1234")
    const hasOrderNumber = /(?:#\d{3,}|طلب\s*(?:رقم\s*)?\d{3,}|order\s*#?\d{3,})/i.test(lower);
    if (hasOrderNumber) {
      return true;
    }

    return false;
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
      customerPhone: context.customerPhone,
      channel: context.channel,
      reason,
      handoffAt: now,
      dashboardLink: `/dashboard/inbox/${context.conversationId}`,
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

  /**
   * ✅ FIX-B: محاولة الإجابة من إعدادات المتجر عندما يفشل RAG
   * 
   * أسئلة مثل:
   * - "وش اسم المتجر؟" → storeName
   * - "وش ساعات العمل؟" → workingHours
   * - "كيف الشحن؟" → shippingInfo
   * - "وش سياسة الإرجاع؟" → returnPolicy
   * 
   * هذه المعلومات موجودة في الإعدادات ولا تحتاج RAG
   */
  private async tryAnswerFromSettings(
    message: string,
    settings: AISettings,
    _context: ConversationContext,
  ): Promise<AIResponse | null> {
    const lower = message.toLowerCase();
    const isAr = settings.language !== 'en';

    // مطابقة الأنماط مع إعدادات المتجر
    const settingsPatterns: Array<{
      patterns: string[];
      settingKey: keyof AISettings;
      labelAr: string;
      labelEn: string;
    }> = [
      {
        patterns: ['اسم المتجر', 'اسم المحل', 'اسم الشركة', 'وش اسمكم', 'ايش اسمكم', 'store name', 'company name', 'what is your name', 'who are you'],
        settingKey: 'storeName',
        labelAr: 'اسم المتجر',
        labelEn: 'Store name',
      },
      {
        patterns: ['ساعات العمل', 'أوقات العمل', 'الدوام', 'متى تفتحون', 'متى تقفلون', 'وقت الدوام', 'working hours', 'open hours', 'business hours', 'when do you open'],
        settingKey: 'workingHours',
        labelAr: 'ساعات العمل',
        labelEn: 'Working hours',
      },
      {
        patterns: ['الشحن', 'توصيل', 'كم يوم التوصيل', 'رسوم الشحن', 'مجاني', 'shipping', 'delivery', 'how long'],
        settingKey: 'shippingInfo',
        labelAr: 'معلومات الشحن',
        labelEn: 'Shipping info',
      },
      {
        patterns: ['إرجاع', 'ارجاع', 'استرجاع', 'استبدال', 'ترجيع', 'return', 'refund', 'exchange'],
        settingKey: 'returnPolicy',
        labelAr: 'سياسة الإرجاع',
        labelEn: 'Return policy',
      },
      {
        patterns: ['وش تبيعون', 'ايش عندكم', 'وصف المتجر', 'عن المتجر', 'ايش يميزكم', 'about', 'what do you sell', 'describe'],
        settingKey: 'storeDescription',
        labelAr: 'عن المتجر',
        labelEn: 'About the store',
      },
    ];

    for (const sp of settingsPatterns) {
      const matched = sp.patterns.some((p) => lower.includes(p.toLowerCase()));
      if (!matched) continue;

      const value = settings[sp.settingKey];
      if (!value || (typeof value === 'string' && !value.trim())) continue;

      this.logger.log(`✅ FIX-B: Answering from settings (${sp.settingKey}) for: "${message.substring(0, 40)}"`);

      // بناء رد طبيعي باستخدام LLM
      try {
        const prompt = isAr
          ? `أنت مساعد متجر "${settings.storeName || ''}". العميل سأل: "${message}"\n\nالمعلومة المتوفرة (${sp.labelAr}): ${value}\n\nاكتب رد طبيعي ومختصر بالعربية يجيب على سؤال العميل. لا تضف معلومات غير موجودة.`
          : `You're a store assistant for "${settings.storeName || ''}". Customer asked: "${message}"\n\nAvailable info (${sp.labelEn}): ${value}\n\nWrite a natural, concise reply answering the customer's question. Don't add info that isn't provided.`;

        const completion = await this.openai.chat.completions.create({
          model: settings.model || AI_DEFAULTS.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: message },
          ],
          temperature: 0.3,
          max_tokens: 300,
        });

        const reply = completion.choices[0]?.message?.content || '';
        if (reply) {
          return {
            reply,
            confidence: 0.85,
            shouldHandoff: false,
            intent: 'SUPPORT_QUERY',
            ragAudit: {
              answer_source: 'library',
              similarity_score: 0,
              verifier_result: 'SKIPPED',
              final_decision: 'ANSWER',
              retrieved_chunks: 0,
              gate_a_passed: false,
              gate_b_passed: false,
            },
          };
        }
      } catch (error) {
        this.logger.warn(`FIX-B: LLM failed for settings answer, using raw value`);
        // Fallback: إرجاع القيمة مباشرة
        const label = isAr ? sp.labelAr : sp.labelEn;
        return {
          reply: `${label}: ${value}`,
          confidence: 0.80,
          shouldHandoff: false,
          intent: 'SUPPORT_QUERY',
          ragAudit: {
            answer_source: 'library',
            similarity_score: 0,
            verifier_result: 'SKIPPED',
            final_decision: 'ANSWER',
            retrieved_chunks: 0,
            gate_a_passed: false,
            gate_b_passed: false,
          },
        };
      }
    }

    return null; // لا يوجد مطابقة → استمر بالسلوك العادي
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
      customerPhone: conv?.customerPhone || undefined,
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

    // ✅ FIX: استخدام isOrderInquiry بدل substring match
    if (this.isOrderInquiry(message)) {
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
