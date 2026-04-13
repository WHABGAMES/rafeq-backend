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
import axios from 'axios';
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
import { ZidApiService, ZidAuthTokens } from '../stores/zid-api.service';

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
  cancellationPolicy: string;

  // Custom Messages
  welcomeMessage: string;
  fallbackMessage: string;
  handoffMessage: string;

  // Response delay (seconds)
  responseDelay?: number;

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
  
  // ✅ Product Source — مصدر بيانات المنتجات
  productSource?: 'salla_api' | 'website_scrape' | 'none'; // Default: 'salla_api'
  productActiveOnly?: boolean; // Default: true — المنتجات المعروضة فقط
  websiteUrl?: string; // URL for website scraping mode
  websiteScrapedAt?: string; // Last scrape timestamp
  websiteProducts?: Array<{ name: string; price: string; available: boolean; url: string; description?: string }>; // Cached scraped products
  
  // ✅ Level 2: Timeouts and Rate Limits
  openaiTimeout?: number; // Default: 30000 ms (30 seconds)
  productSearchTimeout?: number; // Default: 10000 ms (10 seconds)
  maxRetries?: number; // Default: 2
  retryDelay?: number; // Default: 1000 ms

  // ✅ وضع المالك — Owner/Merchant Mode
  ownerModeEnabled?: boolean; // Default: false
  ownerPhones?: string[]; // أرقام هواتف المالك والموظفين (حتى 5)
  ownerWelcomeMessage?: string; // رسالة ترحيب خاصة بالتاجر
  ownerCapabilities?: {
    orderLookup: boolean; // استعلام عن الطلبات وبيانات العملاء
    createCoupons: boolean; // إنشاء أكواد خصم
    modifyOrders: boolean; // تعديل حالة طلبات (إلغاء/استرجاع)
  };

  // ✅ وضع الاختبار — Test/Sandbox Mode
  testMode?: boolean; // Default: false — عند التفعيل البوت يرد فقط على أرقام الاختبار
  testPhones?: string[]; // أرقام اختبار البوت (حتى 10)

  // ✅ تجميع الرسائل — Message Batching
  messageBatchingEnabled?: boolean; // Default: true — ينتظر قبل الرد
  messageBatchingSeconds?: number; // Default: 30 ثانية | المدى: 30-300
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
  isOwnerMode?: boolean; // ✅ وضع المالك — الرقم من أرقام التاجر المعتمدة
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

/** عدد المقاطع المسترجعة من البحث الدلالي */
const RAG_TOP_K = 5;

/** نموذج الـ Embedding من OpenAI */
const EMBEDDING_MODEL = 'text-embedding-3-small';

/** رسالة عدم التطابق — إلزامية بدون تعديل */
const NO_MATCH_MESSAGE = 'عذرًا، هذا السؤال خارج نطاق المعلومات المتوفرة لدي حاليًا.\nإذا رغبت، أستطيع تحويلك إلى الدعم البشري لمساعدتك.';

/** رسائل طلب التوضيح (حسب اللغة) — تُستخدم قبل الوصول للحد الأقصى */
const CLARIFICATION_MESSAGES: Record<string, Record<string, string[]>> = {
  formal: {
    ar: [
      'نعتذر، لم نتمكن من تحديد طلبك بدقة. هل بإمكانك إعادة صياغته؟',
      'يرجى توضيح استفسارك بشكل أدق حتى نتمكن من مساعدتك.',
      'لم أتمكن من فهم طلبك. هل يمكنك تقديم تفاصيل إضافية؟',
    ],
    en: [
      'We apologize, but we could not identify your request precisely. Could you rephrase it?',
      'Please clarify your inquiry so we can assist you better.',
      'I was unable to understand your request. Could you provide more details?',
    ],
  },
  friendly: {
    ar: [
      'ممكن توضح أكثر عشان أقدر أساعدك؟ 🙏',
      'ما فهمت طلبك بالضبط، ممكن تعيد صياغته بطريقة ثانية؟',
      'أبي أساعدك بس أحتاج تفاصيل أكثر شوي 😊',
      'ممكن تقول لي بالضبط وش تبي عشان أقدر أخدمك؟',
    ],
    en: [
      'Could you clarify that a bit more? I want to help! 🙏',
      'I didn\'t quite get that. Could you rephrase it?',
      'I\'d love to help — can you give me a bit more detail? 😊',
    ],
  },
  professional: {
    ar: [
      'أحتاج توضيح أكثر لسؤالك حتى أتمكن من مساعدتك.',
      'لم أستطع تحديد طلبك. هل يمكنك إعادة صياغته؟',
      'ممكن توضح سؤالك بشكل أدق؟ أريد أن أساعدك بأفضل طريقة.',
    ],
    en: [
      'I need more clarification to assist you properly.',
      'Could you rephrase your question? I want to help effectively.',
      'I couldn\'t determine your request. Could you provide more detail?',
    ],
  },
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
  cancellationPolicy: '',
  welcomeMessage: 'أهلاً وسهلاً! كيف يمكنني مساعدتك؟ 😊',
  fallbackMessage: 'عذراً، لم أتمكن من فهم طلبك. هل ترغب بتحويلك لأحد موظفينا؟',
  handoffMessage: 'سأحولك الآن لأحد أفراد فريقنا. سيتواصل معك قريباً! 🙋‍♂️',
  responseDelay: 0,
  // ✅ Level 2: Dynamic Thresholds
  highSimilarityThreshold: 0.85,
  mediumSimilarityThreshold: 0.72,
  lowSimilarityThreshold: 0.5,
  answerConfidenceThreshold: 0.75,
  clarifyConfidenceThreshold: 0.5,
  // ✅ Level 2: Performance Settings
  enableParallelSearch: true,
  enableProductCache: true,
  productSource: 'salla_api',
  productActiveOnly: true,
  productCacheTTL: 300,
  skipVerifierOnHighConfidence: true,
  // ✅ Level 2: Timeouts and Rate Limits
  openaiTimeout: 30000,
  productSearchTimeout: 10000,
  maxRetries: 2,
  retryDelay: 1000,
  // ✅ وضع الاختبار
  testMode: false,
  testPhones: [],
  // ✅ تجميع الرسائل
  messageBatchingEnabled: true,
  messageBatchingSeconds: 30, // 30 ثانية
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
    private readonly zidApiService: ZidApiService,

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

    // ✅ SECURITY: تنظيف وتحقق من ownerPhones
    if (merged.ownerPhones) {
      merged.ownerPhones = merged.ownerPhones
        .map((p: string) => String(p || '').replace(/[^0-9]/g, '')) // أرقام فقط
        .filter((p: string) => p.length >= 9) // حد أدنى 9 أرقام
        .slice(0, 5); // حد أقصى 5 أرقام
    }

    // ✅ SECURITY: تنظيف وتحقق من testPhones
    if (merged.testPhones) {
      merged.testPhones = merged.testPhones
        .map((p: string) => String(p || '').replace(/[^0-9]/g, ''))
        .filter((p: string) => p.length >= 9)
        .slice(0, 10); // حد أقصى 10 أرقام اختبار
    }

    // ✅ VALIDATION: تجميع الرسائل — clamp بين 30 و 300 ثانية
    if (merged.messageBatchingSeconds !== undefined) {
      merged.messageBatchingSeconds = Math.max(30, Math.min(300, Number(merged.messageBatchingSeconds) || 30));
    }

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
        reply: this.getHandoffMessage(settings),
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
    //     ⚠️ حماية: إذا LLM قال SMALLTALK بس ما فيه أي pattern اجتماعي حقيقي
    //     → يروح لـ Smart RAG بدل ما يرد رد عشوائي
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.SMALLTALK || intentResult.intent === IntentType.GREETING) {
      const lowerMsg = message.trim().toLowerCase();
      
      // ✅ تحقق: هل الرسالة فيها pattern اجتماعي/تحية حقيقي؟
      const isRealSocial = SOCIAL_PATTERNS.some((p) => lowerMsg.includes(p.toLowerCase()));
      const isRealGreeting = PURE_GREETING_PATTERNS.some((p) => lowerMsg.includes(p.toLowerCase()));
      const isRealThanks = THANKS_PATTERNS.some((p) => lowerMsg.includes(p.toLowerCase()));
      
      if (isRealSocial || isRealGreeting || isRealThanks) {
        // ✅ فعلاً كلام اجتماعي → رد اجتماعي
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
      } else {
        // ⚠️ LLM قال SMALLTALK بس ما فيه pattern حقيقي
        // مثال: "وش اسمك" — مش تحية ولا كلام اجتماعي → نكمل لـ Smart RAG
        this.logger.log(`⚠️ LLM said ${intentResult.intent} but no social pattern matched "${message}" — forwarding to Smart RAG`);
      }
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
        reply: this.getHandoffMessage(settings),
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
    // 3e. ✅ OUT_OF_SCOPE → يروح لـ Smart RAG — GPT يقرر مع المكتبة الكاملة
    //     مثال: "وش اسمك" → GPT يشوف المكتبة، ما يلقى شي → يرفض
    //     مثال: "هل فيه ضمان" → GPT يشوف المكتبة، يلقى الجواب → يجاوب
    //     السابق: كان يرفض مباشرة بدون ما يشيك المكتبة!
    // ──────────────────────────────────────────────────────────────────────────

    // ──────────────────────────────────────────────────────────────────────────
    // 3f. ✅ ORDER_QUERY → أدوات مباشرة (مع Smart RAG)
    // ──────────────────────────────────────────────────────────────────────────
    if (intentResult.intent === IntentType.ORDER_QUERY) {
      return this.handleOrderQuery(message, context, settings);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3g. ✅ SMART RAG: كل الأسئلة تروح هنا
    //     GPT يقرأ المكتبة كاملة ويقرر:
    //     - إذا الجواب موجود → يجاوب
    //     - إذا مش موجود → يقول "خارج النطاق"
    //     لا نحتاج OUT_OF_SCOPE أو UNKNOWN يقتلون السؤال قبل ما يوصل لهنا
    // ──────────────────────────────────────────────────────────────────────────

    try {
      // ✅ Step 1: Smart Retrieve — جلب المقالات المناسبة
      const knowledgeChunks = await this.smartRetrieve(message, context, settings, intentResult);

      this.logger.log(`📚 Smart Retrieve: ${knowledgeChunks.length} entries loaded for GPT`);

      // ✅ Step 2: بناء System Prompt مع كل المقالات
      const systemPrompt = this.buildStrictSystemPrompt(settings, context, knowledgeChunks);

      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...context.previousMessages.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: message },
      ];

      const tools = this.getAvailableTools();

      // ✅ Step 3: GPT يجاوب (call واحد بدل 5-6)
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

      // تنفيذ الأدوات (request_human_agent, get_order_status)
      if (assistantMsg.tool_calls?.length) {
        const toolResults = await this.executeToolCalls(assistantMsg.tool_calls, context, settings);
        toolsUsed.push(...toolResults.map((r) => r.name));

        const handoffTool = toolResults.find((r) => r.name === 'request_human_agent');
        if (handoffTool) {
          return {
            reply: this.getHandoffMessage(settings),
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
      }

      // ✅ Step 4: فحص بسيط — هل GPT قال "خارج النطاق"?
      const isNoMatch = finalReply.includes('خارج نطاق المعلومات') || 
                         finalReply.includes('outside the scope') ||
                         finalReply.includes(NO_MATCH_MESSAGE);

      if (isNoMatch) {
        this.logger.log(`🚫 GPT says no match — checking settings fallback`);

        // Emit analytics event
        this.eventEmitter.emit('ai.unanswered_question', {
          tenantId: context.tenantId,
          storeId: context.storeId,
          conversationId: context.conversationId,
          message,
          intent: intentResult.intent,
          knowledgeEntriesChecked: knowledgeChunks.length,
          timestamp: new Date(),
        });

        // جرب الإجابة من إعدادات المتجر
        const settingsAnswer = await this.tryAnswerFromSettings(message, settings, context);
        if (settingsAnswer) {
          await this.resetFailedAttempts(context);
          return settingsAnswer;
        }

        return this.handleNoMatch(context, settings, lang, intentResult.intent);
      }

      // ✅ Step 5: Trust GPT — الذكاء الاصطناعي هو المحرك الأساسي
      // GPT استلم كل المعلومات (مكتبة + منتجات + إعدادات) وفهم السياق
      // إذا أجاب → نثق فيه (لأنه فهم المعنى مش الكلمات)
      // الفحص الحرفي القديم كان يقتل ردود صحيحة لأن GPT يصيغ بأسلوبه
      
      // ✅ مراقبة فقط (log بدون block) — للتعلم المستقبلي
      const groundingCheck = this.lightweightGroundingCheck(finalReply, knowledgeChunks);
      if (!groundingCheck.passed) {
        // نسجل للمراقبة فقط — لا نمنع الرد
        this.logger.log(`📊 Grounding monitor (NOT blocking): ${groundingCheck.reason}`);
        this.eventEmitter.emit('ai.grounding_monitor', {
          tenantId: context.tenantId,
          storeId: context.storeId,
          conversationId: context.conversationId,
          message,
          answer: finalReply,
          reason: groundingCheck.reason,
          intent: intentResult.intent,
          timestamp: new Date(),
          blocked: false, // ✅ لم يُمنع — للمراقبة فقط
        });
      }

      // ✅ نجح الرد
      await this.resetFailedAttempts(context);

      return {
        reply: finalReply,
        confidence: knowledgeChunks.length > 0 ? 0.85 : 0.7,
        intent: intentResult.intent,
        shouldHandoff: false,
        toolsUsed,
        ragAudit: {
          answer_source: knowledgeChunks.length > 0 ? 'library' : 'none',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: knowledgeChunks.length,
          gate_a_passed: true,
          gate_b_passed: true,
          detected_intent: intentResult.intent,
        },
      };
    } catch (error) {
      this.logger.error('Smart RAG failed', {
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
      // ✅ ردود ترحيب متنوعة حسب النبرة — بدون رسالة ثابتة
      const greetings: Record<string, Record<string, string[]>> = {
        formal: {
          ar: ['مرحبًا بك. كيف يمكنني مساعدتك اليوم؟', 'أهلاً وسهلاً. كيف أستطيع خدمتك؟', 'حيّاك الله. تفضل بطلبك.'],
          en: ['Welcome. How may I assist you today?', 'Hello. How can I help you?', 'Good day. Please go ahead with your request.'],
        },
        friendly: {
          ar: ['أهلين! كيف أقدر أساعدك؟ 😊', 'حيّاك! وش أقدر أسوي لك اليوم؟', 'هلا وغلا! كيف أخدمك؟ 😊', 'يا هلا فيك! تفضل كيف أساعدك؟'],
          en: ['Hi there! How can I help you? 😊', 'Hey! What can I do for you today?', 'Welcome! How can I assist you? 😊'],
        },
        professional: {
          ar: ['مرحبًا بك. أنا هنا لمساعدتك، تفضل بسؤالك.', 'أهلاً. كيف أستطيع مساعدتك؟', 'حياك الله. تفضل بطلبك وسأساعدك.'],
          en: ['Hello. I\'m here to help. Please go ahead with your question.', 'Welcome. How can I assist you?', 'Hi. What can I help you with today?'],
        },
      };
      const greetArr = greetings[tone]?.[isAr ? 'ar' : 'en'] || greetings.friendly[isAr ? 'ar' : 'en'];
      return greetArr[Math.floor(Math.random() * greetArr.length)];
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
    const currentAttempts = context.failedAttempts || 1;

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

    // ✅ لم يصل للحد → اطلب توضيح (حسب النبرة)
    if (currentAttempts < maxAttempts) {
      const tone = settings.tone || 'friendly';
      const toneMessages = CLARIFICATION_MESSAGES[tone] || CLARIFICATION_MESSAGES.friendly;
      const clarifyMsgs = toneMessages[lang] || toneMessages.ar;
      const clarifyMsg = clarifyMsgs[Math.floor(Math.random() * clarifyMsgs.length)];

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
        reply: this.getHandoffMessage(settings),
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
    const lower = message.trim().toLowerCase();

    // ✅ كشف: هل في رقم طلب في الرسالة؟
    const hasNumber = /\d{4,}/.test(lower);

    if (!hasNumber) {
      // ✅ ما في رقم طلب → اطلب الرقم مباشرة (بدون GPT ولا Smart RAG)
      const tone = settings.tone || 'friendly';
      const isAr = settings.language !== 'en';

      const askForNumberMessages: Record<string, Record<string, string[]>> = {
        formal: {
          ar: [
            'لمساعدتك في متابعة طلبك، يرجى تزويدنا برقم الطلب.',
            'نحتاج رقم الطلب حتى نتمكن من التحقق من حالته. يمكنك إيجاده في صفحة طلباتك.',
          ],
          en: [
            'To assist you with your order, please provide your order number.',
            'We need the order number to check its status. You can find it in your orders page.',
          ],
        },
        friendly: {
          ar: [
            'أقدر أساعدك! بس أحتاج رقم الطلب عشان أشيّك لك على حالته 📦',
            'تمام! عطني رقم الطلب وأشوف لك وش صار فيه 😊',
            'حياك! ممكن تعطيني رقم الطلب عشان أقدر أتابعه لك؟',
          ],
          en: [
            'I can help! Just give me the order number so I can check it for you 📦',
            'Sure! What\'s your order number? I\'ll look it up right away 😊',
          ],
        },
        professional: {
          ar: [
            'لأستطيع مساعدتك، يمكنك إعطائي رقم الطلب؟',
            'أحتاج رقم الطلب للتحقق من حالته. تجده في صفحة طلباتك.',
          ],
          en: [
            'Could you provide the order number so I can check its status?',
            'I need the order number to look it up. You can find it in your orders page.',
          ],
        },
      };

      const msgs = askForNumberMessages[tone]?.[isAr ? 'ar' : 'en'] || askForNumberMessages.friendly[isAr ? 'ar' : 'en'];
      const reply = msgs[Math.floor(Math.random() * msgs.length)];

      this.logger.log(`📦 ORDER_QUERY without number: "${message}" → asking for order number`);

      return {
        reply,
        confidence: 0.9,
        intent: 'ORDER_QUERY',
        shouldHandoff: false,
      };
    }

    // ✅ في رقم طلب → نبحث الطلب مباشرة (بدون انتظار GPT يقرر)
    // هذا يحل مشكلة: GPT أحياناً ما يستخدم get_order_status لأن المحادثة فيها رد سابق
    const orderNumberMatch = message.match(/\d{4,}/);
    const orderNumber = orderNumberMatch ? orderNumberMatch[0] : '';

    this.logger.log(`📦 ORDER_QUERY with number: "${orderNumber}" → direct lookup`);

    try {
      // ✅ STEP 1: بحث مباشر عن الطلب — بدون GPT
      const orderResult = await this.toolGetOrderStatus(
        context.tenantId,
        orderNumber,
        context.storeId,
        context.customerPhone,
      ) as Record<string, unknown>;

      // ✅ STEP 2: إذا ما لقى الطلب → نخبر العميل
      if (!orderResult || orderResult.found === false) {
        this.logger.log(`📦 Order ${orderNumber} not found → informing customer`);
        const isAr = settings.language !== 'en';
        const notFoundMsg = isAr
          ? `لم نتمكن من العثور على طلب برقم ${orderNumber}. يرجى التأكد من الرقم والمحاولة مرة أخرى.`
          : `We couldn't find an order with number ${orderNumber}. Please verify the number and try again.`;
        return {
          reply: notFoundMsg,
          confidence: 0.8,
          intent: 'ORDER_QUERY',
          shouldHandoff: false,
          toolsUsed: ['get_order_status'],
        };
      }

      // ✅ STEP 3: لقينا الطلب → نرسل بيانات الطلب لـ GPT ليصيغ الرد بأسلوب المتجر
      const orderData = JSON.stringify(orderResult);
      const knowledgeChunks = await this.smartRetrieve(message, context, settings, {
        intent: IntentType.ORDER_QUERY,
        confidence: 1,
        allowedSources: ['library'],
      });
      const systemPrompt = this.buildStrictSystemPrompt(settings, context, knowledgeChunks);

      const formatMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...context.previousMessages.slice(-6).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: message },
        { role: 'assistant', content: '', tool_calls: [{ id: 'direct_order_lookup', type: 'function' as const, function: { name: 'get_order_status', arguments: JSON.stringify({ order_id: orderNumber }) } }] },
        { role: 'tool', tool_call_id: 'direct_order_lookup', content: orderData },
      ];

      const completion = await this.openai.chat.completions.create({
        model: settings.model || AI_DEFAULTS.model,
        messages: formatMessages,
        temperature: 0.3,
        max_tokens: settings.maxTokens || 1000,
      });

      const finalReply = completion.choices[0]?.message?.content || '';

      if (!finalReply) {
        const status = (orderResult as any).status || (orderResult as any).statusAr || 'unknown';
        const isAr = settings.language !== 'en';
        return {
          reply: isAr ? `طلبك برقم ${orderNumber} حالته: ${status}.` : `Your order #${orderNumber} status: ${status}.`,
          confidence: 0.9,
          intent: 'ORDER_QUERY',
          shouldHandoff: false,
          toolsUsed: ['get_order_status'],
        };
      }

      await this.resetFailedAttempts(context);

      return {
        reply: finalReply,
        confidence: 0.95,
        intent: 'ORDER_QUERY',
        shouldHandoff: false,
        toolsUsed: ['get_order_status'],
        ragAudit: {
          answer_source: 'tool',
          similarity_score: 0,
          verifier_result: 'SKIPPED',
          final_decision: 'ANSWER',
          retrieved_chunks: knowledgeChunks.length,
          gate_a_passed: true,
          gate_b_passed: true,
        },
      };
    } catch (error) {
      this.logger.error(`📦 Direct order lookup failed for ${orderNumber}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return {
        reply: settings.fallbackMessage || AI_DEFAULTS.fallbackMessage,
        confidence: 0,
        shouldHandoff: true,
        handoffReason: 'ORDER_LOOKUP_FAILED',
        intent: 'ORDER_QUERY',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛡️ LIGHTWEIGHT GROUNDING — كشف الهلوسة بدون API call
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ فحص خفيف لكشف الهلوسة — بدون استدعاء API
   * 
   * الفكرة: إذا GPT جاوب بمعلومات محددة (أرقام، أسعار، مواعيد)
   * ولكن ما فيه أي تقاطع مع محتوى المكتبة → على الأغلب هلوسة
   * 
   * مثال هلوسة: العميل يسأل "كم سعر آيفون 15" والمكتبة ما فيها آيفون
   *   → GPT يرد "سعر آيفون 15 هو 3999 ريال" ← هلوسة من معرفته العامة!
   *   → الفحص: "آيفون" و "3999" مش موجودين في أي مقال → FAIL
   * 
   * مثال صحيح: العميل يسأل "متى تدخلوني" والمكتبة فيها "يوصل خلال 3-5 ايام"
   *   → GPT يرد "يوصلك خلال 3 إلى 5 أيام" ← صحيح
   *   → الفحص: "3" و "5" و "أيام" موجودين في المكتبة → PASS
   */
  private lightweightGroundingCheck(
    answer: string,
    knowledgeChunks: Array<{ title: string; content: string; score: number; answer?: string }>,
  ): { passed: boolean; reason?: string } {
    // إذا ما فيه مقالات أصلاً — ما نقدر نحكم
    if (knowledgeChunks.length === 0) {
      return { passed: false, reason: 'No knowledge entries to ground against' };
    }

    // ✅ FIX: إذا المكتبة فيها مقالات بأجوبة صريحة (Q&A) → الفحص أخف
    // لأن التاجر حدد الجواب بنفسه — ما نحتاج نشك فيه
    const hasExplicitAnswers = knowledgeChunks.some(c => c.answer && c.answer.trim().length > 0);
    
    // ✅ FIX: مكتبة صغيرة (≤5 مقالات) → GPT شاف كل شي → الفحص أخف
    const isSmallKB = knowledgeChunks.length <= 5;

    // نجمع كل محتوى المكتبة في نص واحد
    const allKBContent = knowledgeChunks
      .map((c) => `${c.title} ${c.content} ${c.answer || ''}`)
      .join(' ')
      .toLowerCase();

    // ✅ فحص 1: استخراج الأرقام والأسعار من الرد
    const numbersInAnswer = answer.match(/\d+/g) || [];
    const suspiciousNumbers = numbersInAnswer.filter((n) => {
      const num = parseInt(n);
      if (num <= 2) return false;
      return !allKBContent.includes(n);
    });

    // ✅ FIX: رفع الحد من 2 إلى 4 للمكتبات الصغيرة/Q&A
    const maxSuspicious = (hasExplicitAnswers || isSmallKB) ? 5 : 2;
    if (suspiciousNumbers.length > maxSuspicious) {
      return {
        passed: false,
        reason: `Answer contains ${suspiciousNumbers.length} numbers not found in KB: ${suspiciousNumbers.slice(0, 3).join(', ')}`,
      };
    }

    // ✅ فحص 2: كلمات محتوى مهمة
    const answerWords = answer
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (answerWords.length === 0) {
      return { passed: true };
    }

    const matchedWords = answerWords.filter((w) => allKBContent.includes(w.toLowerCase()));
    const matchRatio = matchedWords.length / answerWords.length;

    // ✅ FIX: للمكتبات الصغيرة/Q&A → حد أقل (5% بدل 15%)
    // لأن GPT يصيغ الجواب بأسلوبه — الكلمات مختلفة لكن المعنى صحيح
    const minMatchRatio = (hasExplicitAnswers || isSmallKB) ? 0.05 : 0.15;
    const minWords = (hasExplicitAnswers || isSmallKB) ? 8 : 5;
    
    if (matchRatio < minMatchRatio && answerWords.length > minWords) {
      return {
        passed: false,
        reason: `Only ${Math.round(matchRatio * 100)}% of answer words found in KB (${matchedWords.length}/${answerWords.length})`,
      };
    }

    return { passed: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧠 SMART RETRIEVE — جلب المقالات بطريقة ذكية
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ Smart Retrieve: بديل ذكي عن Embedding + Cosine Similarity
   * 
   * الفكرة: بدل ما نحوّل السؤال لـ vector ونقارنه رياضياً — نخلي GPT يفهم السؤال مباشرة
   * 
   * الاستراتيجية:
   * - إذا المكتبة ≤ 50 مقال → نجلب كلهم ونرسلهم لـ GPT (أضمن طريقة)
   * - إذا المكتبة > 50 → نبحث بالكلمات المفتاحية أولاً ونرسل Top-20
   * - نضيف منتجات سلة إذا مطلوب
   * 
   * الميزة: GPT يفهم "تدخلوني" = "يوصل" بدون أي embedding
   * التكلفة: 0 API calls إضافية (المقالات تنحط في System Prompt)
   */
  private async smartRetrieve(
    message: string,
    context: ConversationContext,
    settings: AISettings,
    intentResult?: IntentResult,
  ): Promise<Array<{ title: string; content: string; score: number; answer?: string }>> {
    
    const allowedSources = intentResult?.allowedSources || ['library', 'products'];
    const canSearchLibrary = allowedSources.includes('library');
    const canSearchProducts = allowedSources.includes('products');
    
    let chunks: Array<{ title: string; content: string; score: number; answer?: string }> = [];

    // ═══ 1. جلب مقالات المكتبة ═══
    if (canSearchLibrary) {
      try {
        // كم مقال عند هذا التاجر؟
        const totalEntries = await this.knowledgeRepo.count({
          where: { tenantId: context.tenantId, isActive: true },
        });

        this.logger.log(`📚 Smart Retrieve: tenant has ${totalEntries} active KB entries`);

        const SMALL_KB_LIMIT = 50;

        if (totalEntries <= SMALL_KB_LIMIT) {
          // ✅ مكتبة صغيرة: جلب الكل — GPT يختار المناسب
          const allEntries = await this.knowledgeRepo.find({
            where: { tenantId: context.tenantId, isActive: true },
            order: { priority: 'ASC' },
          });

          chunks = allEntries.map((e) => ({
            title: e.title,
            content: e.content,
            answer: e.answer || undefined,
            score: 1.0, // كل المقالات متاحة — GPT يقرر الأنسب
          }));

          this.logger.log(`📚 Loaded ALL ${chunks.length} entries (small KB mode)`);
        } else {
          // ✅ مكتبة كبيرة: بحث كلمات مفتاحية أولاً
          this.logger.log(`📚 Large KB (${totalEntries}) — using keyword search`);
          
          const words = message.split(/\s+/).filter((w) => w.length > 2);
          
          if (words.length > 0) {
            const qb = this.knowledgeRepo
              .createQueryBuilder('kb')
              .where('kb.tenantId = :tenantId', { tenantId: context.tenantId })
              .andWhere('kb.isActive = true');

            // بحث في كل الحقول
            const conditions = words.map((_, i) => 
              `(kb.title ILIKE :w${i} OR kb.content ILIKE :w${i} OR kb.answer ILIKE :w${i} OR kb.keywords::text ILIKE :w${i})`
            );
            const params: Record<string, string> = {};
            words.forEach((w, i) => { params[`w${i}`] = `%${w}%`; });
            qb.andWhere(`(${conditions.join(' OR ')})`, params);
            qb.orderBy('kb.priority', 'ASC').take(20);

            const entries = await qb.getMany();
            
            chunks = entries.map((e) => ({
              title: e.title,
              content: e.content,
              answer: e.answer || undefined,
              score: 0.8,
            }));

            this.logger.log(`📚 Keyword search found ${chunks.length} entries`);
          }

          // إذا ما لقى الكلمات المفتاحية — جلب آخر 20 مقال (أفضل من لا شيء)
          if (chunks.length === 0) {
            const recentEntries = await this.knowledgeRepo.find({
              where: { tenantId: context.tenantId, isActive: true },
              order: { priority: 'ASC', createdAt: 'DESC' },
              take: 20,
            });

            chunks = recentEntries.map((e) => ({
              title: e.title,
              content: e.content,
              answer: e.answer || undefined,
              score: 0.5,
            }));
            
            this.logger.log(`📚 No keyword matches — loaded top ${chunks.length} by priority`);
          }
        }
      } catch (error) {
        this.logger.error('Smart Retrieve: KB fetch failed', {
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    }

    // ═══ 2. جلب المنتجات (حسب إعداد مصدر المنتجات) ═══
    const productSource = settings?.productSource || 'salla_api';
    if (canSearchProducts && context.storeId && productSource !== 'none') {
      try {
        if (productSource === 'website_scrape' && settings?.websiteProducts?.length) {
          // ✅ MODE: Website Scrape — استخدم المنتجات المحفوظة من scraping
          const query = message.toLowerCase();
          const words = query.split(/\s+/).filter((w: string) => w.length > 2);
          const matchedProducts = (settings.websiteProducts || []).filter((p: any) => {
            const pName = (p.name || '').toLowerCase();
            const pDesc = (p.description || '').toLowerCase();
            return pName.includes(query) || query.includes(pName) || words.some((w: string) => pName.includes(w) || pDesc.includes(w));
          });

          if (matchedProducts.length > 0) {
            chunks.push(...matchedProducts.slice(0, 5).map((p: any) => ({
              title: `منتج: ${p.name}`,
              content: `المنتج: ${p.name}\nالسعر: ${p.price}\nالحالة: ${p.available ? 'متوفر ✅' : 'غير متوفر ❌'}${p.description ? '\nالوصف: ' + p.description : ''}${p.url ? '\nالرابط: ' + p.url : ''}`,
              score: 0.8,
            })));
            this.logger.log(`🌐 Website products: found ${matchedProducts.length} matches`);
          } else {
            // لم يجد تطابق → أرسل أول 10 منتجات لـ GPT يقرر
            chunks.push(...(settings.websiteProducts || []).slice(0, 10).map((p: any) => ({
              title: `منتج: ${p.name}`,
              content: `${p.name} — ${p.price} — ${p.available ? 'متوفر' : 'غير متوفر'}`,
              score: 0.5,
            })));
            this.logger.log(`🌐 Website products: loaded ${Math.min(10, (settings.websiteProducts||[]).length)} for GPT evaluation`);
          }
        } else {
          // ✅ MODE: Salla/Zid API — البحث المباشر
          const productResult = await this.searchProducts(message, context.storeId, settings);
          if (productResult.chunks.length > 0) {
            chunks.push(...productResult.chunks);
            this.logger.log(`🛒 Salla API: ${productResult.chunks.length} products found`);
          }
        }
      } catch (error) {
        this.logger.warn('Smart Retrieve: Product search failed — continuing with library only');
      }
    }

    // ═══ 3. حد أقصى للحجم ═══
    // نقطع عند MAX_KNOWLEDGE_CHARS عشان ما نتجاوز context window
    let totalChars = 0;
    const limitedChunks: typeof chunks = [];
    for (const chunk of chunks) {
      const chunkSize = chunk.title.length + chunk.content.length + (chunk.answer?.length || 0);
      if (totalChars + chunkSize > MAX_KNOWLEDGE_CHARS) break;
      limitedChunks.push(chunk);
      totalChars += chunkSize;
    }

    if (limitedChunks.length < chunks.length) {
      this.logger.log(`📚 Trimmed from ${chunks.length} to ${limitedChunks.length} entries (MAX_KNOWLEDGE_CHARS=${MAX_KNOWLEDGE_CHARS})`);
    }

    return limitedChunks;
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

    // معلومات المتجر + RAG: كلها في قسم واحد حتى GPT يعتبرها مصدر إجابة
    prompt += isAr
      ? '\n\n=== معلومات متوفرة (مصدرك الوحيد للإجابة) ==='
      : '\n\n=== Available Information (your ONLY source for answers) ===';

    // معلومات المتجر الأساسية — داخل قسم المعلومات المتوفرة
    if (settings.storeIntroduction)
      prompt += `\n[${isAr ? 'نبذة تعريفية عن المتجر' : 'Store Introduction'}]: ${settings.storeIntroduction}`;
    if (settings.storeDescription)
      prompt += `\n[${isAr ? 'وصف المتجر' : 'About'}]: ${settings.storeDescription}`;
    if (settings.workingHours) {
      let hoursText = settings.workingHours;
      try {
        const parsed = JSON.parse(settings.workingHours);
        if (parsed.readableText) hoursText = parsed.readableText;
      } catch { /* plain text — use as-is */ }
      prompt += `\n[${isAr ? 'أوقات العمل' : 'Hours'}]: ${hoursText}`;
    }
    if (settings.returnPolicy)
      prompt += `\n[${isAr ? 'سياسة الإرجاع والاستبدال' : 'Returns & Exchange'}]: ${settings.returnPolicy}`;
    if (settings.shippingInfo)
      prompt += `\n[${isAr ? 'الشحن' : 'Shipping'}]: ${settings.shippingInfo}`;
    if (settings.cancellationPolicy)
      prompt += `\n[${isAr ? 'سياسة الإلغاء والتعديل' : 'Cancellation & Modification'}]: ${settings.cancellationPolicy}`;

    // ✅ RAG: المقاطع المسترجعة — في نفس القسم
    if (retrievedChunks.length > 0) {
      let charsUsed = 0;
      for (const chunk of retrievedChunks) {
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

    // ✅ القواعد الصارمة — منع الهلوسة مع ذكاء سياقي
    prompt += isAr
      ? `\n\n=== قواعد ذكية (إلزامية) ===
1. أنت تفهم المعنى والسياق — لست محرك بحث كلمات. إذا فهمت أن سؤال العميل يتعلق بمعلومة متوفرة أعلاه (حتى لو بصياغة مختلفة تماماً) → أجب منها مباشرة.
2. ✅ أولوية مصادر الإجابة (بالترتيب):
   أ) المكتبة (الأسئلة والأجوبة أعلاه) — أعلى أولوية
   ب) معلومات المتجر (النبذة، الوصف، الشحن، الإرجاع، الإلغاء، أوقات العمل)
   ج) المنتجات (إن وُجدت أعلاه)
   إذا الجواب في أي مصدر من هذه المصادر → أجب فوراً.
3. ✅ افهم نية العميل وليس كلماته الحرفية:
   - "عندكم X" = "متوفر X" = "فيه X" = "يوجد X" = "تقدرون توفرون X" = "أبي X" → كلها سؤال واحد: هل X متوفر؟
   - "كم سعره" = "بكم" = "السعر" = "أسعاركم" → سؤال عن السعر
   - "وين طلبي" = "طلبي تأخر" = "متى يوصل" = "حالة الطلب" → استفسار طلب
   - "ارجاع" = "استرداد" = "أبي أرجع" = "استبدال" → سياسة الإرجاع
   - "إلغاء" = "ألغي" = "تعديل" = "غيّر" → سياسة الإلغاء
   - أي صياغة أخرى بنفس المعنى → افهمها بذكاء وأجب
4. ✅ قاعدة ذهبية: إذا سؤال العميل عن نفس الموضوع الموجود في المكتبة (حتى بكلمات مختلفة 100%) → هذا تطابق ويجب أن تجيب. لا تطلب توضيح أبداً إذا الجواب متوفر.
5. ❌ لا تختلق معلومات جديدة. لا تذكر أسعاراً أو منتجات غير مذكورة أعلاه.
6. ❌ لا تستخدم معرفتك العامة أبداً. لا تقدم نصائح طبية أو صحية.
7. إذا فعلاً لا يوجد أي معلومة متعلقة بسؤال العميل في جميع المصادر أعلاه، أجب حرفياً:
"${NO_MATCH_MESSAGE}"
8. إذا طلب العميل شخصاً بشرياً، استخدم أداة request_human_agent.
9. عند استعلام الطلب: استخدم أداة get_order_status ثم اشرح الحالة بأسلوبك الطبيعي. إذا كان الطلب رقمي ووجدت digital_content → أرسل الأكواد للعميل. إذا وجدت digital_note → اتبع التعليمات فيها بالضبط.
10. إذا ذكر العميل طلبه بدون رقم → اطلب رقم الطلب.
11. كن موجزاً ومفيداً.`
      : `\n\n=== Smart Rules (mandatory) ===
1. You understand meaning and context — you are NOT a keyword search engine. If you understand the customer's question relates to available information above (even with completely different wording) → answer directly.
2. ✅ Answer source priority (in order):
   a) Knowledge base (Q&A above) — highest priority
   b) Store info (description, shipping, returns, cancellation, hours)
   c) Products (if listed above)
   If the answer exists in any source → answer immediately.
3. ✅ Understand customer intent, not literal words:
   - "do you have X" = "is X available" = "can I get X" = "I want X" → all mean: is X available?
   - "how much" = "price" = "cost" → price question
   - "where is my order" = "order is late" = "when will it arrive" → order inquiry
   - Any other phrasing with same meaning → understand intelligently and answer
4. ✅ Golden rule: If the customer's question is about the same topic in the knowledge base (even with 100% different words) → this IS a match and you MUST answer. NEVER ask for clarification if the answer is available.
5. ❌ Do NOT fabricate information. Do NOT mention prices or products not listed above.
6. ❌ NEVER use general knowledge. No medical, health, or cultural advice.
7. If truly NO information relates to the customer's question in ALL sources above, respond EXACTLY with:
"${NO_MATCH_MESSAGE}"
8. If customer asks for a human, use request_human_agent tool.
9. For order queries: use get_order_status tool. For digital orders with digital_content → send codes. If digital_note exists → follow its instructions.
10. If customer mentions order without number → ask for order number.
11. Be concise and helpful.`;

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
    // ✅ FIX: Skip product search if the message is purely numeric (likely order number)
    // Salla API returns 422 for numeric-only keywords
    const cleanMsg = message.replace(/\s+/g, '');
    if (/^\d+$/.test(cleanMsg) && cleanMsg.length >= 4) {
      this.logger.log(`⏭️ Skipping product search: "${message}" looks like an order number, not a product query`);
      return { chunks: [], topScore: 0, gateAPassed: false };
    }
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

      // ✅ FIX: فلترة المنتجات حسب الكمية (productActiveOnly)
      let filteredProducts = response.data;
      const activeOnly = settings?.productActiveOnly ?? true;
      if (activeOnly) {
        filteredProducts = response.data.filter((p: SallaProduct) => p.quantity > 0);
        if (filteredProducts.length < response.data.length) {
          this.logger.log(`🛒 Filtered: ${response.data.length} → ${filteredProducts.length} products (removed out-of-stock)`);
        }
      }

      if (filteredProducts.length === 0) {
        this.logger.log(`🛒 No in-stock products found for keyword "${keyword}"`);
        const emptyResult = { chunks: [], topScore: 0, gateAPassed: false };
        if (enableCache) {
          const cacheKey = `${storeId}:${keyword.toLowerCase()}`;
          this.productCache.set(cacheKey, { result: emptyResult, timestamp: Date.now() });
        }
        return emptyResult;
      }

      // تحويل المنتجات إلى chunks
      const chunks = filteredProducts.map((product: SallaProduct) => {
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
        // ✅ FIX: حتى لو Intent classifier قال "خارج النطاق"
        // نحمّل المكتبة ونخلي GPT يقرر — Intent classifier ممكن يغلط
        strategy = settings.searchPriority;
        allowedSources = ['library', 'products'];
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
- ORDER_QUERY: أي استفسار عن طلب العميل — سواء بوجود رقم طلب (مثل: وين طلبي رقم 1234) أو بدون رقم (مثل: طلبي تأخر، وين طلبي، متى يوصل طلبي، ابي اتتبع طلبي)
- HUMAN_REQUEST: طلب صريح للتحدث مع موظف أو شخص بشري
- OUT_OF_SCOPE: سؤال خارج نطاق المتجر تماماً (مثل: سياسة، رياضة، طبخ)
- UNKNOWN: لا يمكن تحديد النوع

⚠️ قواعد مهمة:
- ORDER_QUERY: أي ذكر لطلب العميل (بوجود رقم أو بدونه) — مثل: طلبي تأخر، وين طلبي، ابي اتتبع الطلب
- "اذا طلبت/اشتريت X متى..." = POLICY_SUPPORT_FAQ (سؤال عام عن الخدمة وليس استفسار طلب)
- "متى دوري" أو "كم المدة" = POLICY_SUPPORT_FAQ
- إذا الرسالة تسأل عن معلومة محددة = ليست GREETING/SMALLTALK
- أسئلة المنتجات المحددة (سعر، مواصفات) = PRODUCT_QUESTION
- أسئلة السياسات العامة = POLICY_SUPPORT_FAQ
- SMALLTALK فقط للكلام الاجتماعي الحقيقي (كيفك، اخبارك) — أي سؤال يطلب معلومة (وش اسمك، من أنت، وش تسوي) = POLICY_SUPPORT_FAQ وليس SMALLTALK
- أي رسالة فيها علامة استفهام أو تبدأ بـ "وش/ايش/شو/هل/كم/متى/وين/ليش/كيف" = ليست SMALLTALK`
        : `You are an advanced intent classifier for an online store. Classify the customer message into exactly one type.
Respond ONLY with JSON, no other text.

Types:
- GREETING: Simple greeting only (e.g., hi, hello, good morning) without any question
- SMALLTALK: Social talk (e.g., how are you, what's up) without specific question
- PRODUCT_QUESTION: Question about a specific product, price, availability, specs
- POLICY_SUPPORT_FAQ: Question about store policies, shipping, returns, hours, general info, or general service questions (e.g., if I buy X when will it arrive, how long does it take)
- COMPLAINT_ESCALATION: Complaint, escalation request, dissatisfaction
- ORDER_QUERY: Any mention of customer's order — with or without order number (e.g., where is my order #1234, my order is late, track my order, when will my order arrive)
- HUMAN_REQUEST: Explicit request to speak to a human agent
- OUT_OF_SCOPE: Question completely outside store scope (politics, sports, cooking)
- UNKNOWN: Cannot determine

⚠️ Important rules:
- ORDER_QUERY: any mention of customer's order (with or without number) — e.g., my order is late, where is my order, track my order
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

    // ✅ رقم صرف طويل (6+ أرقام) — على الأغلب رقم طلب
    const isPureOrderNumber = /^\d{6,}$/.test(lower.trim());
    if (isPureOrderNumber) {
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
          description: 'البحث عن حالة طلب بالرقم. يُرجع بيانات الطلب مع status_context. للطلبات الرقمية المكتملة: إذا وُجد digital_content أرسل الأكواد للعميل. إذا وُجد digital_note اتبع تعليماته.',
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
            // ✅ نمرر storeId + customerPhone للتحقق من المحتوى الرقمي
            result = await this.toolGetOrderStatus(
              context.tenantId,
              args.order_id as string,
              context.storeId,
              context.customerPhone,
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
    customerPhone?: string,
  ): Promise<unknown> {
    // ─── 1. البحث في DB المحلي ───
    const whereConditions: Record<string, unknown>[] = [
      { tenantId, sallaOrderId: orderId },
      { tenantId, referenceId: orderId },
    ];
    if (storeId) {
      whereConditions.push(
        { storeId, sallaOrderId: orderId },
        { storeId, referenceId: orderId },
        { storeId, zidOrderId: orderId },
      );
    }

    const localOrder = await this.orderRepo.findOne({ where: whereConditions });
    if (localOrder) {
      return this.formatOrderResponse(localOrder);
    }

    // ─── 2. البحث في API سلة/زد ───
    if (!storeId) {
      return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم. يرجى التأكد من الرقم.' };
    }

    try {
      const store = await this.storeRepo
        .createQueryBuilder('store')
        .addSelect('store.accessToken')
        .where('store.id = :storeId', { storeId })
        .andWhere('store.deletedAt IS NULL')
        .getOne();

      if (!store?.accessToken) {
        return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم.' };
      }

      const accessToken = decrypt(store.accessToken);
      if (!accessToken) {
        return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم.' };
      }

      if (store.platform === 'salla') {
        return this.lookupSallaOrder(accessToken, orderId, customerPhone);
      }

      if (store.platform === 'zid') {
        return this.lookupZidOrder(accessToken, orderId);
      }

      return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم.' };
    } catch (error) {
      this.logger.warn(`⚠️ Order lookup failed for ${orderId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return { found: false, message: 'حدث خطأ أثناء البحث عن الطلب. يرجى المحاولة لاحقاً.' };
    }
  }

  /**
   * ✅ بحث في سلة API مع دعم المحتوى الرقمي
   */
  private async lookupSallaOrder(accessToken: string, orderId: string, customerPhone?: string): Promise<unknown> {
    try {
      // بحث بالرقم المرجعي أولاً
      let sallaOrder = await this.sallaApiService.searchOrderByReference(accessToken, orderId);

      // fallback: بحث بالـ ID المباشر
      if (!sallaOrder) {
        const orderNum = parseInt(orderId, 10);
        if (!isNaN(orderNum)) {
          try {
            const directResponse = await this.sallaApiService.getOrder(accessToken, orderNum);
            if (directResponse?.data) sallaOrder = directResponse.data;
          } catch { /* 404 */ }
        }
      }

      if (!sallaOrder) {
        return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم. يرجى التأكد من الرقم.' };
      }

      const statusSlug = sallaOrder.status?.slug || sallaOrder.status?.name || 'unknown';
      const statusName = sallaOrder.status?.name || sallaOrder.status?.customized?.name || statusSlug;

      // ✅ كشف المنتج الرقمي
      const isDigital = this.isDigitalOrder(sallaOrder);
      const isCompleted = ['completed', 'delivered', 'in_progress'].includes(statusSlug);

      // ✅ تحقق من رقم الجوال للمحتوى الرقمي
      let digitalContent: unknown = null;
      let phoneVerified = false;
      let phoneHint = '';

      if (isDigital && isCompleted && customerPhone) {
        const orderPhone = this.normalizePhone(
          (sallaOrder.customer?.mobile_code || '') + (sallaOrder.customer?.mobile || ''),
        );
        const whatsappPhone = this.normalizePhone(customerPhone);

        phoneVerified = orderPhone === whatsappPhone;

        if (phoneVerified) {
          // ✅ نفس الرقم → نرسل المحتوى الرقمي
          digitalContent = await this.fetchDigitalContent(accessToken, sallaOrder);
        } else {
          // ❌ رقم مختلف → نعطيه تلميح
          const last4 = orderPhone.slice(-4);
          phoneHint = last4;
        }
      }

      const result: Record<string, unknown> = {
        found: true,
        order_id: String(sallaOrder.reference_id || sallaOrder.id),
        reference_id: sallaOrder.reference_id,
        status: statusSlug,
        status_ar: statusName,
        status_context: this.getStatusContext(statusSlug),
        total: sallaOrder.amounts?.total?.amount,
        currency: sallaOrder.amounts?.total?.currency || 'SAR',
        payment_status: sallaOrder.payment?.status,
        payment_method: sallaOrder.payment?.method?.name,
        items_count: sallaOrder.items?.length || 0,
        items: sallaOrder.items?.map((i: any) => i.name).join(', ') || '',
        shipping_company: sallaOrder.shipping?.company?.name || null,
        order_date: sallaOrder.date?.date || null,
        is_digital: isDigital,
        source: 'salla_api',
      };

      if (isDigital && isCompleted) {
        if (phoneVerified && digitalContent) {
          const dc = digitalContent as any;
          if (dc.type === 'digital_codes' && dc.codes?.length) {
            // ✅ أكواد فعلية متاحة (تطبيقات قديمة)
            result.digital_content = digitalContent;
            result.phone_verified = true;
            result.digital_note = 'تم التحقق من هوية العميل. الأكواد الرقمية مرفقة — أرسلها للعميل مباشرة.';
          } else if (dc.type === 'digital_url' && dc.url) {
            // ✅ رابط المحتوى الرقمي من سلة
            result.digital_content_url = dc.url;
            result.phone_verified = true;
            result.digital_note = `تم التحقق من هوية العميل. أرسل للعميل رابط استلام المحتوى الرقمي: ${dc.url} — وأخبره يشيّك على إيميله المسجّل بعد لأن الكود وصله هناك أيضاً.`;
          } else {
            // ✅ ما في أكواد ولا رابط — وجّه للإيميل والمتجر
            result.phone_verified = true;
            result.digital_note = 'تم التحقق من هوية العميل. أخبره إن المحتوى الرقمي تم إرساله لإيميله المسجّل ويقدر يلاقيه في صفحة طلباته بالمتجر. إذا ما وصله، اعرض عليه التحويل للدعم البشري.';
          }
        } else if (!phoneVerified && phoneHint) {
          result.phone_verified = false;
          result.phone_hint = phoneHint;
          result.digital_note = `الطلب رقمي ومكتمل، لكن رقم الواتساب الحالي مختلف عن الرقم المسجّل في الطلب. اطلب من العميل التواصل من الرقم اللي آخره ${phoneHint} أو حوّله للدعم البشري.`;
        }
      }

      return result;
    } catch (sallaError) {
      this.logger.warn(`⚠️ Salla order lookup failed for ${orderId}`, {
        error: sallaError instanceof Error ? sallaError.message : 'Unknown',
      });
      return { found: false, message: 'حدث خطأ أثناء البحث عن الطلب.' };
    }
  }

  /**
   * ✅ بحث في زد API
   */
  private async lookupZidOrder(accessToken: string, orderId: string): Promise<unknown> {
    const orderNum = parseInt(orderId, 10);
    if (isNaN(orderNum)) {
      return { found: false, message: 'رقم الطلب غير صالح.' };
    }

    try {
      const zidTokens: ZidAuthTokens = { managerToken: accessToken };
      const zidOrder = await this.zidApiService.getOrder(zidTokens, orderNum);

      if (!zidOrder) {
        return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم.' };
      }

      return {
        found: true,
        order_id: String(zidOrder.id),
        reference_id: zidOrder.order_number,
        status: zidOrder.status,
        status_ar: this.getStatusArabic(zidOrder.status),
        status_context: this.getStatusContext(zidOrder.status),
        total: zidOrder.total,
        currency: zidOrder.currency || 'SAR',
        payment_status: zidOrder.payment_status,
        payment_method: zidOrder.payment_method,
        items_count: zidOrder.items?.length || 0,
        order_date: zidOrder.created_at || null,
        source: 'zid_api',
      };
    } catch (zidError) {
      this.logger.warn(`⚠️ Zid order lookup failed for ${orderId}`, {
        error: zidError instanceof Error ? zidError.message : 'Unknown',
      });
      return { found: false, message: 'لم يتم العثور على طلب بهذا الرقم.' };
    }
  }

  /**
   * ✅ كشف المنتج الرقمي — لا يحتاج شحن
   */
  private isDigitalOrder(order: any): boolean {
    // لا يوجد شحن
    if (!order.shipping?.company && !order.shipping?.address) {
      return true;
    }
    // طريقة الشحن رقمية
    const shippingMethod = order.shipping?.method?.toLowerCase?.() || '';
    if (shippingMethod.includes('digital') || shippingMethod.includes('رقمي')) {
      return true;
    }
    return false;
  }

  /**
   * ✅ تطبيع رقم الجوال — استخراج آخر 9 أرقام (الرقم المحلي)
   * يتعامل مع كل الصيغ: +971561667877, 0561667877, 971561667877, etc.
   */
  private normalizePhone(phone: string): string {
    // إزالة كل شي غير الأرقام
    const digits = phone.replace(/\D/g, '');
    // آخر 9 أرقام = الرقم المحلي بدون كود الدولة أو الصفر
    if (digits.length >= 9) {
      return digits.slice(-9);
    }
    return digits;
  }

  /**
   * ✅ جلب المحتوى الرقمي — أكواد البطاقات من سلة
   */
  private async fetchDigitalContent(accessToken: string, order: any): Promise<unknown> {
    try {
      const orderId = order.id;
      const response = await this.sallaApiService.getOrder(accessToken, orderId);
      const fullOrder = response?.data as any;

      if (!fullOrder) return null;

      // ✅ أولاً: جرّب جلب الأكواد مباشرة (للتطبيقات القديمة قبل أغسطس 2024)
      const codes: Array<{ product: string; code: string }> = [];
      for (const item of (fullOrder.items || [])) {
        const itemAny = item as any;
        if (itemAny.codes?.length) {
          for (const code of itemAny.codes) {
            codes.push({ product: item.name, code: String(code.code || code) });
          }
        }
      }

      if (codes.length > 0) {
        return { type: 'digital_codes', codes };
      }

      // ✅ ثانياً: جلب رابط المحتوى الرقمي من سلة
      const digitalUrl = fullOrder.urls?.digital_content || null;

      return {
        type: 'digital_url',
        url: digitalUrl,
        message: digitalUrl
          ? `رابط استلام المحتوى الرقمي: ${digitalUrl}`
          : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * ✅ تنسيق بيانات الطلب المحلي
   */
  private formatOrderResponse(order: any): unknown {
    return {
      found: true,
      order_id: order.sallaOrderId || order.zidOrderId || order.referenceId,
      status: order.status,
      status_ar: this.getStatusArabic(order.status),
      status_context: this.getStatusContext(order.status),
      total: order.totalAmount,
      currency: order.currency,
      payment_status: order.paymentStatus,
      payment_method: order.paymentMethod,
      items_count: order.items?.length || 0,
      shipping_company: order.shippingInfo?.carrierName || null,
      tracking_number: order.shippingInfo?.trackingNumber || null,
      order_date: order.orderedAt || order.createdAt,
      source: 'local_db',
    };
  }

  private getStatusArabic(status: string): string {
    const map: Record<string, string> = {
      created: 'تم الإنشاء', processing: 'قيد التجهيز', under_review: 'قيد المراجعة',
      pending_payment: 'بانتظار الدفع', paid: 'تم الدفع', ready_to_ship: 'جاهز للشحن',
      shipped: 'تم الشحن', delivered: 'تم التوصيل', completed: 'مكتمل',
      cancelled: 'ملغي', refunded: 'مسترد', restoring: 'قيد الاسترجاع',
      failed: 'فشل', on_hold: 'معلّق', in_transit: 'في الطريق',
      in_progress: 'قيد التنفيذ',
    };
    return map[status] || status;
  }

  private getStatusContext(status: string): string {
    const contexts: Record<string, string> = {
      created: 'الطلب تم استلامه وسيتم معالجته قريباً',
      processing: 'الطلب قيد التجهيز والتحضير',
      under_review: 'الطلب قيد المراجعة من الفريق',
      pending_payment: 'الطلب ينتظر إتمام عملية الدفع',
      paid: 'تم الدفع بنجاح والطلب سيتم تجهيزه',
      ready_to_ship: 'الطلب جاهز وسيتم تسليمه لشركة الشحن',
      shipped: 'الطلب في الطريق مع شركة الشحن وسيصل قريباً',
      in_transit: 'الطلب في الطريق إليك',
      delivered: 'الطلب تم توصيله بنجاح',
      completed: 'الطلب مكتمل وتم إنهاؤه',
      cancelled: 'الطلب تم إلغاؤه',
      refunded: 'تم استرداد المبلغ',
      restoring: 'جاري معالجة طلب الاسترجاع',
      failed: 'حدثت مشكلة في الطلب',
      on_hold: 'الطلب معلّق مؤقتاً',
      in_progress: 'جاري تنفيذ الطلب',
    };
    return contexts[status] || 'حالة الطلب: ' + status;
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

  /**
   * ✅ التحقق من أوقات العمل — يُستخدم لتحديد رسالة التحويل البشري
   * إذا خارج الأوقات → يُرجع رسالة خاصة بدل التحويل العادي
   */
  getHandoffMessage(settings: AISettings): string {
    const defaultMsg = settings.handoffMessage || AI_DEFAULTS.handoffMessage;

    if (!settings.workingHours) return defaultMsg;

    try {
      const parsed = JSON.parse(settings.workingHours);
      if (!parsed._schedule) return defaultMsg;
      if (parsed.is24h) return defaultMsg;

      const tz = parsed.timezone || 'Asia/Riyadh';
      const schedule = parsed.schedule;
      if (!schedule) return defaultMsg;

      // ─── الوقت الحالي في المنطقة الزمنية ───
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      const currentMinutes = hour * 60 + minute;

      // ─── ترتيب الأيام + أسماء عربية ───
      const dayOrder = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
      const dayNames: Record<string, string> = {
        sat: 'السبت', sun: 'الأحد', mon: 'الإثنين', tue: 'الثلاثاء',
        wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة',
      };
      const dayKey = weekday; // already lowercase short: sat, sun, mon...

      const todaySchedule = schedule[dayKey];

      // ─── هل نحن داخل أوقات العمل؟ ───
      if (todaySchedule?.enabled) {
        const [fromH, fromM] = (todaySchedule.from || '09:00').split(':').map(Number);
        const [toH, toM] = (todaySchedule.to || '21:00').split(':').map(Number);
        if (currentMinutes >= fromH * 60 + fromM && currentMinutes <= toH * 60 + toM) {
          return defaultMsg; // ✅ داخل الأوقات — تحويل عادي
        }
      }

      // ─── خارج الأوقات — نبحث عن أقرب يوم/وقت متاح ───
      const todayIndex = dayOrder.indexOf(dayKey);

      // هل باقي وقت اليوم؟ (العميل أرسل قبل بداية الدوام)
      if (todaySchedule?.enabled) {
        const [fromH, fromM] = (todaySchedule.from || '09:00').split(':').map(Number);
        if (currentMinutes < fromH * 60 + fromM) {
          // اليوم فيه دوام بس لسه ما بدأ
          return `عذراً، فريق الدعم البشري غير متاح حالياً.\n\n🕐 الدعم البشري متاح اليوم (${dayNames[dayKey]}) من الساعة ${todaySchedule.from} إلى ${todaySchedule.to}`;
        }
      }

      // ابحث عن أقرب يوم عمل قادم (خلال 7 أيام)
      for (let offset = 1; offset <= 7; offset++) {
        const nextIndex = (todayIndex + offset) % 7;
        const nextDay = dayOrder[nextIndex];
        const nextSched = schedule[nextDay];

        if (nextSched?.enabled) {
          let whenLabel: string;
          if (offset === 1) {
            whenLabel = `غداً (${dayNames[nextDay]})`;
          } else if (offset === 2) {
            whenLabel = `بعد غد (${dayNames[nextDay]})`;
          } else {
            whenLabel = `يوم ${dayNames[nextDay]}`;
          }

          return `عذراً، فريق الدعم البشري غير متاح حالياً.\n\n🕐 الدعم البشري متاح ${whenLabel} من الساعة ${nextSched.from} إلى ${nextSched.to}`;
        }
      }

      // لا يوجد أي يوم متاح (كل الأيام إجازة)
      return parsed.offHoursMsg || 'عذراً، فريق الدعم البشري غير متاح حالياً.';
    } catch {
      return defaultMsg;
    }
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
      context.failedAttempts = current + 1;

      this.logger.log(`📊 Failed attempts: ${current} → ${current + 1} for conversation ${context.conversationId}`);
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
      const conv = await this.conversationRepo.findOne({
        where: { id: context.conversationId },
      });
      if (!conv) return;

      const aiContext = (conv.aiContext || {}) as Record<string, unknown>;
      const dbAttempts = (aiContext.failedAttempts as number) || 0;

      if (dbAttempts > 0) {
        conv.aiContext = { ...aiContext, failedAttempts: 0 };
        await this.conversationRepo.save(conv);
        context.failedAttempts = 0;
        this.logger.log(`🔄 Reset failed attempts: ${dbAttempts} → 0 for conversation ${context.conversationId}`);
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
      isOwnerMode: false,
      previousMessages: [],
    };

    // ✅ وضع المالك — كشف أرقام التاجر المعتمدة
    // FIX: دعم @lid — نفس الرقم أحياناً يوصل كـ @lid بدل @s.whatsapp.net
    let ownerCheckPhone = context.customerPhone;
    const currentExternalId = conv?.customerExternalId || '';
    const isLidConversation = currentExternalId.includes('@lid');

    // ═══ LAYER 1: @lid → phone resolution (3 طرق) ═══
    if (!ownerCheckPhone && isLidConversation && conv?.channelId && settings.ownerModeEnabled) {
      try {
        // طريقة 1: ownerLids — LIDs محفوظة مسبقاً (أسرع)
        const knownLids = (settings as any).ownerLids as string[] | undefined;
        if (knownLids?.includes(currentExternalId)) {
          // هذا LID معروف → نجيب أول رقم مالك
          ownerCheckPhone = settings.ownerPhones?.[0];
          this.logger.log(`🔑 @lid matched from ownerLids: ${currentExternalId.slice(0, 8)}...`);
        }

        // طريقة 2: مطابقة بالاسم مع محادثة سابقة
        if (!ownerCheckPhone && conv.customerName) {
          const matchConv = await this.conversationRepo
            .createQueryBuilder('c')
            .select(['c.id', 'c.customerPhone'])
            .where('c.channelId = :channelId', { channelId: conv.channelId })
            .andWhere('c.customerName = :name', { name: conv.customerName })
            .andWhere('c.customerPhone IS NOT NULL')
            .andWhere("LENGTH(c.customerPhone) >= 9")
            .andWhere('c.id != :currentId', { currentId: conv.id })
            .orderBy('c.updatedAt', 'DESC')
            .getOne();

          if (matchConv?.customerPhone) {
            ownerCheckPhone = matchConv.customerPhone;
            this.logger.log(`🔑 @lid resolved via name match: ${conv.customerName} → ****${ownerCheckPhone.slice(-4)}`);
            await this.conversationRepo.update({ id: conv.id }, { customerPhone: ownerCheckPhone });
          }
        }

        // طريقة 3: البحث في الطلبات — هل اسم المحادثة يطابق اسم عميل مرتبط برقم مالك؟
        if (!ownerCheckPhone && conv.customerName && context.storeId) {
          const validOwnerPhones = (settings.ownerPhones || [])
            .map(p => p.replace(/[^0-9]/g, ''))
            .filter(p => p.length >= 9);

          if (validOwnerPhones.length > 0) {
            const orders = await this.orderRepo.find({
              where: { storeId: context.storeId },
              relations: ['customer'],
              take: 100,
              order: { createdAt: 'DESC' },
            });

            const ownerOrder = orders.find(o => {
              const custPhone = (o.customer?.phone || '').replace(/[^0-9]/g, '');
              return custPhone.length >= 9 && validOwnerPhones.some(op => {
                const lastNine = (n: string) => n.slice(-9);
                return lastNine(custPhone) === lastNine(op);
              });
            });

            if (ownerOrder?.customer?.phone) {
              ownerCheckPhone = ownerOrder.customer.phone;
              this.logger.log(`🔑 @lid resolved via order customer: → ****${ownerCheckPhone.slice(-4)}`);
              await this.conversationRepo.update({ id: conv.id }, { customerPhone: ownerCheckPhone });
            }
          }
        }
      } catch (e) {
        this.logger.warn(`🔑 @lid resolution failed: ${(e as Error).message}`);
      }
    }

    // ═══ LAYER 2: Owner phone matching ═══
    if (settings.ownerModeEnabled && settings.ownerPhones?.length && ownerCheckPhone) {
      const normalizedPhone = ownerCheckPhone.replace(/[^0-9]/g, '');
      const validOwnerPhones = settings.ownerPhones
        .map(p => p.replace(/[^0-9]/g, ''))
        .filter(p => p.length >= 9);
      
      const isOwner = validOwnerPhones.some(ownerPhone => {
        if (normalizedPhone === ownerPhone) return true;
        const lastNine = (n: string) => n.slice(-9);
        return lastNine(normalizedPhone) === lastNine(ownerPhone);
      });
      if (isOwner) {
        context.isOwnerMode = true;
        context.customerPhone = ownerCheckPhone;
        this.logger.log(`🔑 Owner mode activated for: ****${normalizedPhone.slice(-4)}${isLidConversation ? ' (from @lid)' : ''}`);

        // ═══ LAYER 3: Auto-discover — حفظ LID للمستقبل ═══
        if (isLidConversation && currentExternalId) {
          try {
            const existingLids = ((settings as any).ownerLids || []) as string[];
            if (!existingLids.includes(currentExternalId)) {
              (settings as any).ownerLids = [...existingLids, currentExternalId].slice(-10);
              // حفظ الإعدادات المحدّثة
              await this.updateSettings(params.tenantId, storeId, { ownerLids: (settings as any).ownerLids } as any);
              this.logger.log(`🔑 Auto-discovered owner LID: ${currentExternalId.slice(0, 12)}... → saved`);
            }
          } catch (e) {
            this.logger.warn(`🔑 Failed to save owner LID: ${(e as Error).message}`);
          }
        }
      }
    }

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

    // ✅ تأخير الرد (إذا مفعّل) — يجعل المحادثة تبدو طبيعية
    const delaySeconds = settings.responseDelay || 0;
    if (delaySeconds > 0) {
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }

    // ✅ وضع المالك — معالجة خاصة بصلاحيات موسعة
    if (context.isOwnerMode) {
      return this.processOwnerMessage(params.message, context, settings);
    }

    return this.processMessage(params.message, context, settings);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ وضع المالك — Owner Mode Processing
  // ═══════════════════════════════════════════════════════════════════════════════

  private async processOwnerMessage(
    message: string,
    context: ConversationContext,
    settings: AISettings,
  ): Promise<AIResponse> {
    this.logger.log('🔑 Processing OWNER MODE message', {
      conversationId: context.conversationId,
      phone: context.customerPhone?.slice(-4),
    });

    if (!this.isApiKeyConfigured) {
      return {
        reply: 'عذراً، خدمة الذكاء الاصطناعي غير مكوّنة حالياً.',
        confidence: 0,
        shouldHandoff: false,
      };
    }

    const caps = settings.ownerCapabilities || { orderLookup: true, createCoupons: false, modifyOrders: false };

    // ✅ جلب بيانات المتجر
    let storeData = '';
    if (context.storeId) {
      try {
        const store = await this.storeRepo.findOne({ where: { id: context.storeId } });
        if (store) {
          storeData = `اسم المتجر: ${store.name || 'غير محدد'}\nالمنصة: ${store.platform || 'غير محدد'}`;
        }
      } catch (e) {
        this.logger.warn(`Owner mode: store fetch failed: ${(e as Error).message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✅ OWNER MODE v2 — Function Calling Architecture
    // GPT يستدعي أدوات بحث → SQL مباشر → لا حد على الطلبات
    // ═══════════════════════════════════════════════════════════════════

    const capsList: string[] = [];
    if (caps.orderLookup) capsList.push('- استعلام كامل عن الطلبات وبيانات العملاء');
    if (caps.createCoupons) capsList.push('- إنشاء أكواد خصم');
    if (caps.modifyOrders) capsList.push('- تعديل حالة الطلبات (إلغاء/استرجاع)');

    // ═══ System Prompt — خفيف بدون بيانات ═══
    const ownerSystemPrompt = `أنت مساعد ذكي خاص بصاحب المتجر "${settings.storeName || ''}".

⚠️ هام: اللي يكلمك هو صاحب المتجر نفسه — مو عميل.

🎯 أسلوبك:
- تكلم بالعامية السعودية/الخليجية — مثل زميل عمل يفهم شغله.
- ردودك مختصرة وعملية — لا تطوّل ولا تكرر.
- إذا سلّم عليك (هلا، السلام، مرحبا) → رد عليه بشكل طبيعي: "أهلين تاجرنا! أمر، وش تبي أساعدك فيه؟"
- لا تعرض خدماتك من نفسك — بس إذا سأل "وش تقدر تسوي؟" أو "عرض خدماتك" → اعرضها.
- ❌ ممنوع أسلوب البوتات: لا تقل "مرحباً عزيزي التاجر" أو "كيف أساعدك" أو "تفضل".

📊 خدماتك (اعرضها بس إذا طلب):
${capsList.join('\n')}

📌 قواعد مهمة:
- عندك أدوات بحث تقدر تستخدمها للوصول لأي طلب أو عميل في المتجر — بدون حد.
- استخدم الأداة المناسبة حسب طلب التاجر.
- إذا التاجر ذكر رقم هاتف → استخدم search_orders مع phone.
- إذا ذكر رقم طلب → استخدم search_orders مع order_id.
- إذا ذكر اسم عميل → استخدم search_orders مع customer_name.
- إذا سأل عن إحصائيات (كم طلب، إجمالي المبيعات) → استخدم get_store_stats.
- إذا بس سلّم ولا طلب شي محدد → رد بشكل طبيعي بدون استدعاء أي أداة.
- رتّب النتائج بشكل واضح ومختصر.
- ❌ لا تقل أبداً "آخر 50 طلب" أو "آخر 1000 طلب" — أنت تبحث في كل الطلبات بدون حد.
- إذا ما لقيت نتائج → قل "ما لقيت هالطلب في النظام. تأكد من الرقم وأرسله مرة ثانية".
- ⚠️ دائماً اعرض محتوى الطلب (المنتجات) — اسم المنتج + الكمية + السعر. لا تخفي المنتجات أبداً.
- إذا طلب معلومات طلب → استخدم get_order_details للتفاصيل الكاملة (منتجات + شحن + دفع).
- إذا search_orders رجع items_count = 0 → استخدم get_order_details تلقائياً عشان تجلب المنتجات من المنصة.

${storeData ? '🏪 ' + storeData : ''}`;

    // ═══ Function Definitions ═══
    const ownerTools: any[] = [];
    if (caps.orderLookup) {
      ownerTools.push(
        {
          type: 'function',
          function: {
            name: 'search_orders',
            description: 'البحث في طلبات المتجر — رقم طلب، رقم هاتف، اسم عميل، حالة، أو آخر الطلبات. يبحث في كل الطلبات بدون حد.',
            parameters: {
              type: 'object',
              properties: {
                order_id: { type: 'string', description: 'رقم الطلب — مثال: 250088344' },
                phone: { type: 'string', description: 'رقم هاتف العميل — مثال: 971526387731' },
                customer_name: { type: 'string', description: 'اسم العميل — مثال: علي الظنداني' },
                email: { type: 'string', description: 'إيميل العميل' },
                status: { type: 'string', description: 'حالة الطلب: completed, pending, under_review, cancelled, refunded' },
                limit: { type: 'number', description: 'عدد النتائج (الافتراضي 20، أقصى 50)' },
              },
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_order_details',
            description: 'جلب تفاصيل طلب محدد مع المنتجات — يعرض: المنتجات (اسم + كمية + سعر)، الشحن، الدفع، العنوان. استخدمها دائماً لما التاجر يبي تفاصيل طلب معين.',
            parameters: {
              type: 'object',
              properties: {
                order_id: { type: 'string', description: 'رقم الطلب (referenceId)' },
              },
              required: ['order_id'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_store_stats',
            description: 'إحصائيات المتجر — عدد الطلبات، إجمالي المبيعات، أكثر العملاء شراءً',
            parameters: {
              type: 'object',
              properties: {
                metric: {
                  type: 'string',
                  enum: ['summary', 'top_customers', 'recent_orders', 'orders_by_status'],
                  description: 'summary=ملخص عام، top_customers=أكثر العملاء، recent_orders=آخر الطلبات، orders_by_status=حسب الحالة',
                },
                days: { type: 'number', description: 'الفترة بالأيام (الافتراضي 30)' },
              },
              required: ['metric'],
            },
          },
        },
      );
    }

    // ═══ GPT + Function Calling Loop ═══
    try {
      this.logger.log(`🔑 Owner v2: Function Calling mode`);

      const cleanPreviousMessages = context.previousMessages
        .slice(-8)
        .filter(m => m.content && m.content.trim().length > 0)
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content.slice(0, 500),
        }));

      const VALID_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];
      const requestedModel = settings.model || 'gpt-4o-mini';
      let safeModel = VALID_MODELS.includes(requestedModel) ? requestedModel : 'gpt-4o-mini';

      const gptMessages: any[] = [
        { role: 'system', content: ownerSystemPrompt },
        ...cleanPreviousMessages,
        { role: 'user', content: message },
      ];

      const callGpt = async (model: string, msgs: any[], tools?: any[]) => {
        const params: any = {
          model,
          temperature: 0.2,
          max_tokens: settings.maxTokens || 1500,
          messages: msgs,
        };
        if (tools && tools.length > 0) params.tools = tools;
        return this.withTimeout(
          this.openai.chat.completions.create(params),
          30000,
          'Owner GPT',
        );
      };

      let completion: any;
      try {
        completion = await callGpt(safeModel, gptMessages, ownerTools);
      } catch (firstError: any) {
        if (firstError?.status === 404 || firstError?.code === 'model_not_found') {
          this.logger.warn(`🔑 Model "${safeModel}" failed, fallback to gpt-4o-mini`);
          safeModel = 'gpt-4o-mini'; // ✅ حدّث الموديل عشان الـ loop يستخدم الصح
          completion = await callGpt('gpt-4o-mini', gptMessages, ownerTools);
        } else {
          throw firstError;
        }
      }

      // ═══ Tool Call Loop — أقصى 3 دورات ═══
      let maxLoops = 3;
      let finalReply = '';

      while (maxLoops > 0) {
        const choice = completion.choices[0];

        if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
          finalReply = choice.message.content?.trim() || '';
          break;
        }

        gptMessages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          const fnName = toolCall.function.name;
          let result = '';
          try {
            const fnArgs = JSON.parse(toolCall.function.arguments || '{}');
            this.logger.log(`🔧 Tool: ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);
            if (!context.storeId) throw new Error('storeId missing');
            result = await this.executeOwnerTool(fnName, fnArgs, context.storeId);
          } catch (e) {
            result = JSON.stringify({ error: (e as Error).message });
            this.logger.error(`🔧 Tool error: ${fnName}`, { error: (e as Error).message });
          }

          gptMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }

        completion = await callGpt(safeModel, gptMessages, ownerTools);
        maxLoops--;
      }

      if (!finalReply) {
        finalReply = completion.choices[0]?.message?.content?.trim() || 'لم أتمكن من معالجة طلبك.';
      }

      this.logger.log(`🔑 Owner v2: replied (${finalReply.length} chars)`);

      return {
        reply: finalReply,
        confidence: 0.95,
        shouldHandoff: false,
        intent: 'owner_request',
        toolsUsed: ['owner_mode', 'function_calling'],
      };
    } catch (error: any) {
      this.logger.error('🔑 Owner mode GPT FAILED', {
        error: error?.message || 'Unknown',
        status: error?.status,
        code: error?.code,
      });

      return {
        reply: 'عذراً، حدث خطأ. حاول مرة أخرى.',
        confidence: 0.3,
        shouldHandoff: true,
        intent: 'owner_error',
        toolsUsed: ['owner_mode', 'error'],
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ✅ Owner Mode v2 — Tool Execution Engine
  // ═══════════════════════════════════════════════════════════════════
  private async executeOwnerTool(fnName: string, args: any, storeId: string): Promise<string> {
    switch (fnName) {
      case 'search_orders': {
        const limit = Math.min(args.limit || 20, 50);
        const qb = this.orderRepo
          .createQueryBuilder('o')
          .leftJoinAndSelect('o.customer', 'c')
          .where('o.storeId = :storeId', { storeId });

        if (args.order_id) {
          const oid = args.order_id.replace(/[^0-9]/g, '');
          qb.andWhere(
            '(o.referenceId LIKE :oid OR o.sallaOrderId LIKE :oid OR o.zidOrderId LIKE :oid)',
            { oid: `%${oid}%` },
          );
        }
        if (args.phone) {
          const phone9 = args.phone.replace(/[^0-9]/g, '').slice(-9);
          qb.andWhere('c.phone LIKE :phone', { phone: `%${phone9}%` });
        }
        if (args.customer_name) {
          qb.andWhere(
            '(c.fullName ILIKE :name OR c.firstName ILIKE :name OR c.lastName ILIKE :name)',
            { name: `%${args.customer_name}%` },
          );
        }
        if (args.email) {
          qb.andWhere('c.email ILIKE :email', { email: `%${args.email}%` });
        }
        if (args.status) {
          qb.andWhere('o.status = :status', { status: args.status });
        }

        // إذا ما فيه أي فلتر → جلب آخر الطلبات
        if (!args.order_id && !args.phone && !args.customer_name && !args.email && !args.status) {
          // no filter = recent orders
        }

        const orders = await qb.orderBy('o.createdAt', 'DESC').take(limit).getMany();

        this.logger.log(`🔧 search_orders: found ${orders.length} results (args: ${JSON.stringify(args).slice(0, 80)})`);

        if (orders.length === 0) {
          return JSON.stringify({ count: 0, message: 'لا توجد نتائج مطابقة. ممكن الطلب قديم أو غير مسجل في النظام.' });
        }

        return JSON.stringify({
          count: orders.length,
          orders: orders.map(o => ({
            order_number: o.referenceId || o.sallaOrderId || o.id?.slice(0, 8),
            salla_id: o.sallaOrderId || '—',
            reference_id: o.referenceId || '—',
            customer: o.customer?.fullName || o.customer?.firstName || (o as any).customerName || 'غير معروف',
            phone: o.customer?.phone || (o as any).customerPhone || '—',
            email: o.customer?.email || '—',
            amount: `${o.totalAmount || 0} ${o.currency || 'SAR'}`,
            status: o.status,
            payment: o.paymentStatus || '—',
            date: o.createdAt ? new Date(o.createdAt).toLocaleDateString('ar-SA') : '—',
            items_count: o.items?.length || 0,
            items: o.items?.length
              ? o.items.map((it: any) => `${it.name || 'منتج'} ×${it.quantity || 1} = ${it.totalPrice || it.price || 0} SAR`).join(' | ')
              : '⚠️ منتجات غير محملة — استخدم get_order_details لجلبها من سلة',
          })),
        });
      }

      case 'get_order_details': {
        const oid = (args.order_id || '').replace(/[^0-9]/g, '');
        const order = await this.orderRepo
          .createQueryBuilder('o')
          .leftJoinAndSelect('o.customer', 'c')
          .where('o.storeId = :storeId', { storeId })
          .andWhere(
            '(o.referenceId LIKE :oid OR o.sallaOrderId LIKE :oid OR o.zidOrderId LIKE :oid)',
            { oid: `%${oid}%` },
          )
          .getOne();

        if (!order) return JSON.stringify({ error: 'الطلب غير موجود' });

        // ✅ Auto-enrich: إذا المنتجات فاضية → جلبها من API المنصة مباشرة
        let items = order.items || [];
        if (!items.length || (Array.isArray(items) && items.length === 0)) {
          this.logger.log(`🔧 Order ${order.sallaOrderId || order.referenceId} has 0 items — attempting API enrichment`);
          try {
            const enriched = await this.enrichOrderItemsFromPlatform(order, storeId);
            if (enriched.length > 0) {
              items = enriched;
              this.logger.log(`🔧 Enriched with ${enriched.length} items from platform API`);
            } else {
              this.logger.warn(`🔧 API enrichment returned 0 items`);
            }
          } catch (e) {
            this.logger.warn(`🔧 Items enrichment failed: ${(e as Error).message}`);
          }
        }

        return JSON.stringify({
          order_number: order.referenceId || order.sallaOrderId,
          salla_id: order.sallaOrderId || '—',
          reference_id: order.referenceId || '—',
          customer: {
            name: order.customer?.fullName || order.customer?.firstName || 'غير معروف',
            phone: order.customer?.phone || '—',
            email: order.customer?.email || '—',
          },
          amount: `${order.totalAmount || 0} ${order.currency || 'SAR'}`,
          status: order.status,
          payment_status: order.paymentStatus || '—',
          payment_method: order.paymentMethod || 'غير محدد',
          items: items.length ? items.map((it: any, idx: number) => ({
            '#': idx + 1,
            product: it.name || it.product_name || 'منتج غير معروف',
            sku: it.sku || '—',
            quantity: it.quantity || 1,
            unit_price: `${it.unitPrice || it.price?.amount || it.price || 0} SAR`,
            total: `${it.totalPrice || it.total || 0} SAR`,
            options: it.options?.map((o: any) => `${o.name}: ${o.value}`).join(', ') || '',
          })) : [{ note: 'لا توجد منتجات مسجلة — ممكن الطلب ما تضمّن تفاصيل المنتجات' }],
          items_count: items.length,
          shipping: {
            carrier: (order as any).shippingInfo?.carrierName || 'غير محدد',
            tracking: (order as any).shippingInfo?.trackingNumber || 'غير متوفر',
          },
          date: order.createdAt ? new Date(order.createdAt).toLocaleDateString('ar-SA') : '—',
        });
      }

      case 'get_store_stats': {
        const days = args.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        switch (args.metric) {
          case 'summary': {
            const [totalOrders, totalRevenue, uniqueCustomers] = await Promise.all([
              this.orderRepo
                .createQueryBuilder('o')
                .where('o.storeId = :storeId AND o.createdAt >= :since', { storeId, since })
                .getCount(),
              this.orderRepo
                .createQueryBuilder('o')
                .select('SUM(o.totalAmount)', 'sum')
                .where('o.storeId = :storeId AND o.createdAt >= :since', { storeId, since })
                .getRawOne(),
              this.orderRepo
                .createQueryBuilder('o')
                .select('COUNT(DISTINCT o.customerId)', 'count')
                .where('o.storeId = :storeId AND o.createdAt >= :since', { storeId, since })
                .getRawOne(),
            ]);
            const allTimeOrders = await this.orderRepo.count({ where: { storeId } });
            return JSON.stringify({
              period: `آخر ${days} يوم`,
              total_orders: totalOrders,
              total_revenue: `${parseFloat(totalRevenue?.sum || '0').toFixed(2)} SAR`,
              unique_customers: parseInt(uniqueCustomers?.count || '0'),
              all_time_orders: allTimeOrders,
            });
          }
          case 'top_customers': {
            const top = await this.orderRepo
              .createQueryBuilder('o')
              .leftJoin('o.customer', 'c')
              .select(['c.fullName AS name', 'c.phone AS phone', 'COUNT(o.id) AS order_count', 'SUM(o.totalAmount) AS total_spent'])
              .where('o.storeId = :storeId AND o.createdAt >= :since', { storeId, since })
              .groupBy('c.id, c.fullName, c.phone')
              .orderBy('order_count', 'DESC')
              .limit(10)
              .getRawMany();
            return JSON.stringify({ period: `آخر ${days} يوم`, top_customers: top });
          }
          case 'recent_orders': {
            const recent = await this.orderRepo.find({
              where: { storeId },
              relations: ['customer'],
              order: { createdAt: 'DESC' },
              take: 10,
            });
            return JSON.stringify({
              orders: recent.map(o => ({
                id: o.referenceId || o.sallaOrderId,
                customer: o.customer?.fullName || 'غير معروف',
                amount: `${o.totalAmount || 0} ${o.currency || 'SAR'}`,
                status: o.status,
                date: o.createdAt ? new Date(o.createdAt).toLocaleDateString('ar-SA') : '—',
              })),
            });
          }
          case 'orders_by_status': {
            const byStatus = await this.orderRepo
              .createQueryBuilder('o')
              .select(['o.status AS status', 'COUNT(o.id) AS count'])
              .where('o.storeId = :storeId AND o.createdAt >= :since', { storeId, since })
              .groupBy('o.status')
              .getRawMany();
            return JSON.stringify({ period: `آخر ${days} يوم`, by_status: byStatus });
          }
          default:
            return JSON.stringify({ error: 'metric غير معروف' });
        }
      }

      default:
        return JSON.stringify({ error: `الأداة ${fnName} غير موجودة` });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ✅ Auto-enrich: جلب منتجات الطلب من API المنصة إذا فاضية بالـ DB
  // ═══════════════════════════════════════════════════════════════════
  private async enrichOrderItemsFromPlatform(order: any, storeId: string): Promise<any[]> {
    // ✅ accessToken is select:false — must use addSelect
    const store = await this.storeRepo
      .createQueryBuilder('store')
      .addSelect('store.accessToken')
      .where('store.id = :storeId', { storeId })
      .andWhere('store.deletedAt IS NULL')
      .getOne();

    if (!store?.accessToken) {
      this.logger.warn(`🔧 Enrich: No access token for store ${storeId}`);
      return [];
    }

    const accessToken = decrypt(store.accessToken);
    if (!accessToken) {
      this.logger.warn(`🔧 Enrich: Failed to decrypt token for store ${storeId}`);
      return [];
    }

    let items: any[] = [];

    // ═══ Salla ═══
    if (store.platform === 'salla') {
      try {
        let sallaOrder: any = null;

        // طريقة 1: جلب بالـ sallaOrderId مباشرة
        if (order.sallaOrderId) {
          this.logger.log(`🔧 Fetching order from Salla API: id=${order.sallaOrderId}`);
          try {
            const resp = await this.sallaApiService.getOrder(accessToken, Number(order.sallaOrderId));
            sallaOrder = resp?.data;
          } catch (e: any) {
            this.logger.warn(`🔧 Salla getOrder(${order.sallaOrderId}) failed: ${e?.message}`);
          }
        }

        // طريقة 2: بحث بالرقم المرجعي إذا الأولى فشلت
        if (!sallaOrder?.items?.length && order.referenceId) {
          this.logger.log(`🔧 Searching Salla by reference: ${order.referenceId}`);
          try {
            sallaOrder = await this.sallaApiService.searchOrderByReference(accessToken, order.referenceId);
          } catch (e: any) {
            this.logger.warn(`🔧 Salla searchByRef(${order.referenceId}) failed: ${e?.message}`);
          }
        }

        // استخراج المنتجات
        if (sallaOrder?.items?.length) {
          items = sallaOrder.items.map((it: any) => ({
            productId: String(it.product_id || it.id || ''),
            name: String(it.name || ''),
            sku: it.sku || undefined,
            quantity: Number(it.quantity || 1),
            unitPrice: it.price?.amount || it.price || 0,
            totalPrice: (it.price?.amount || it.price || 0) * (it.quantity || 1),
            imageUrl: it.thumbnail || it.image?.url || undefined,
          }));

          // حفظ في DB — المرة الجاية ما نحتاج API
          const updateData: any = { items: items as any };

          // إثراء بيانات الدفع
          if (sallaOrder.payment?.method?.name && !order.paymentMethod) {
            updateData.paymentMethod = sallaOrder.payment.method.name;
          }
          if (sallaOrder.payment?.status && (!order.paymentStatus || order.paymentStatus === 'pending')) {
            const pStatus = String(sallaOrder.payment.status).toLowerCase();
            if (pStatus.includes('paid') || pStatus.includes('تم')) updateData.paymentStatus = 'paid';
          }

          // إثراء الرقم المرجعي
          if (!order.referenceId && sallaOrder.reference_id) {
            updateData.referenceId = String(sallaOrder.reference_id);
          }
          if (!order.sallaOrderId && sallaOrder.id) {
            updateData.sallaOrderId = String(sallaOrder.id);
          }

          await this.orderRepo.update({ id: order.id }, updateData);
          this.logger.log(`🔧 ✅ Enriched order ${order.sallaOrderId || order.referenceId} with ${items.length} items + payment/shipping`);
        } else {
          this.logger.warn(`🔧 Salla API returned 0 items for order ${order.sallaOrderId || order.referenceId}`);
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 401) {
          this.logger.warn(`🔧 Salla token expired for store ${storeId}`);
        } else {
          this.logger.warn(`🔧 Salla enrichment error: ${e?.message || 'unknown'}`);
        }
      }
    }

    // ═══ Zid (مستقبلاً) ═══
    // if (store.platform === 'zid') { ... }

    return items;
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

  // ─── Generate Store Info with AI ─────────────────────────────────────────
  async generateStoreInfo(_tenantId: string, description: string): Promise<{
    store_intro: string;
    store_description: string;
    shipping_info: string;
    return_policy: string;
    cancellation_policy: string;
    working_hours: string;
  }> {
    if (!this.isApiKeyConfigured) {
      throw new Error('مفتاح OpenAI API غير مكوّن');
    }

    const systemPrompt = `You are an expert e-commerce content generator.
Your task is to generate complete store information for an online store based on a very short merchant description.

You must generate the following fields in Arabic:
1. store_intro - نبذة تعريفية (2 sentences)
2. store_description - وصف المتجر (3-4 sentences)
3. shipping_info - معلومات الشحن
4. return_policy - سياسة الإرجاع والاستبدال
5. cancellation_policy - سياسة الإلغاء والتعديل
6. working_hours - أوقات العمل (if applicable, otherwise empty)

CRITICAL LANGUAGE RULES:
- You MUST write in Modern Standard Arabic (الفصحى) — formal, professional tone.
- NEVER use colloquial/dialectal Arabic (العامية) — no Gulf dialect, no Egyptian, no Levantine.
- Even if the merchant writes in colloquial Arabic, you MUST respond in formal Arabic (فصحى).
- Use "نحن" not "احنا", "نقدّم" not "نقدم لكم", "يُرجى" not "لا تنسى".
- The text must sound like official corporate communication, not casual conversation.
- Use proper Arabic grammar: إعراب صحيح، تشكيل خفيف إذا لزم، صياغة رسمية.

Business type detection rules:
- If the store sells FOOD → returns should be restricted, cancellation before preparation only.
- If the store sells DIGITAL PRODUCTS → mention instant delivery, limited refunds, no cancellation after delivery.
- If the store sells SERVICES → mention consultation timeline, cancellation with advance notice.
- If the store sells PHYSICAL PRODUCTS → include shipping window, return window, cancellation before shipping.

Additional rules:
- Content must sound natural, trustworthy, and professional.
- Do NOT invent unrealistic claims.
- Do NOT make the text too long.
- Keep sentences concise and clear.

Output ONLY valid JSON with these exact keys: store_intro, store_description, shipping_info, return_policy, cancellation_policy, working_hours. No markdown, no backticks.`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 800,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ],
    });

    const raw = (completion.choices[0]?.message?.content || '').trim();
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      this.logger.warn(`generateStoreInfo: failed to parse JSON: ${cleaned.substring(0, 200)}`);
      return {
        store_intro: '',
        store_description: '',
        shipping_info: '',
        return_policy: '',
        cancellation_policy: '',
        working_hours: '',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🌐 SCRAPE PRODUCTS — قراءة المنتجات من رابط موقع خارجي
  // ═══════════════════════════════════════════════════════════════════════════════

  async scrapeProducts(url: string): Promise<{
    success: boolean;
    products: Array<{ name: string; price: string; available: boolean; url: string; description?: string }>;
    count: number;
    error?: string;
  }> {
    if (!this.isApiKeyConfigured) {
      return { success: false, products: [], count: 0, error: 'مفتاح OpenAI API غير مكوّن' };
    }

    try {
      this.logger.log(`🌐 Scraping products from: ${url}`);

      // ✅ SECURITY: SSRF Protection — منع الوصول لعناوين داخلية
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();
      const blockedPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.', '10.', '192.168.', 'internal', '.local'];
      if (blockedPatterns.some(p => hostname.includes(p)) || hostname.startsWith('172.') || !parsedUrl.protocol.startsWith('http')) {
        return { success: false, products: [], count: 0, error: 'الرابط غير مسموح — يجب أن يكون رابط موقع خارجي' };
      }

      // 1. جلب HTML الصفحة
      const response = await axios.get(url, {
        timeout: 15000,
        maxRedirects: 3,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RafeqBot/1.0)',
          'Accept': 'text/html',
          'Accept-Language': 'ar,en',
        },
        maxContentLength: 2 * 1024 * 1024, // 2MB max
      });

      const html = String(response.data || '');
      if (!html || html.length < 100) {
        return { success: false, products: [], count: 0, error: 'الصفحة فارغة أو غير قابلة للقراءة' };
      }

      // 2. تنظيف HTML — إزالة scripts/styles/nav/footer واستخراج النص المفيد
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<!\-\-[\s\S]*?\-\->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12000); // حد أقصى لحجم النص المرسل لـ GPT

      if (cleaned.length < 50) {
        return { success: false, products: [], count: 0, error: 'لم يتم العثور على محتوى منتجات في الصفحة' };
      }

      // 3. إرسال لـ GPT لاستخراج المنتجات
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are a product data extractor. Extract ALL products from the given webpage text.

For each product, extract:
- name: اسم المنتج
- price: السعر (مع العملة)
- available: هل متوفر (true/false) — if quantity is 0 or "نفذت الكمية" then false
- url: رابط المنتج (if found, otherwise empty)
- description: وصف قصير (if found, otherwise empty)

Rules:
- Extract ONLY actual products — not categories, not banners, not ads.
- If the page is a product listing, extract all visible products.
- If price is not found, use "غير محدد".
- Return ONLY valid JSON array. No markdown, no explanation.
- Maximum 50 products.

Example output:
[{"name":"عباية سوداء","price":"299 ر.س","available":true,"url":"","description":"عباية قطن"}]`,
          },
          {
            role: 'user',
            content: `Extract products from this page:\n\nURL: ${url}\n\nPage content:\n${cleaned}`,
          },
        ],
      });

      const raw = (completion.choices[0]?.message?.content || '').trim();
      const jsonCleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      try {
        const products = JSON.parse(jsonCleaned);
        if (!Array.isArray(products)) {
          return { success: false, products: [], count: 0, error: 'لم يتم استخراج منتجات — تأكد أن الصفحة تحتوي على منتجات' };
        }

        // تنظيف وتوحيد البيانات
        const cleanProducts = products.slice(0, 50).map((p: any) => ({
          name: String(p.name || '').trim().slice(0, 200),
          price: String(p.price || 'غير محدد').trim(),
          available: Boolean(p.available),
          url: String(p.url || '').trim(),
          description: String(p.description || '').trim().slice(0, 300),
        })).filter((p: any) => p.name.length > 0);

        this.logger.log(`🌐 Scraped ${cleanProducts.length} products from ${url}`);
        return { success: true, products: cleanProducts, count: cleanProducts.length };

      } catch {
        this.logger.warn(`🌐 Failed to parse scraped products JSON: ${jsonCleaned.substring(0, 200)}`);
        return { success: false, products: [], count: 0, error: 'فشل تحليل بيانات المنتجات — حاول مرة أخرى' };
      }

    } catch (error: any) {
      const msg = error?.code === 'ECONNREFUSED' ? 'لا يمكن الوصول للموقع'
        : error?.code === 'ENOTFOUND' ? 'الموقع غير موجود'
        : error?.response?.status === 403 ? 'الموقع يرفض الوصول'
        : error?.response?.status === 404 ? 'الصفحة غير موجودة'
        : `خطأ: ${error?.message || 'غير معروف'}`;

      this.logger.warn(`🌐 Scrape failed for ${url}: ${msg}`);
      return { success: false, products: [], count: 0, error: msg };
    }
  }

  detectLanguage(text: string): 'ar' | 'en' {
    return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
  }
}
