/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - AI Learning Service v2                               ║
 * ║                                                                                ║
 * ║  ✅ v2: رصد شامل — يسجّل كل رسائل العملاء + ردود البوت                      ║
 * ║                                                                                ║
 * ║  التدفق:                                                                      ║
 * ║  1. ai.message_processed event → كل رسالة معالجة                             ║
 * ║  2. يفلتر (يتجاهل تحيات قصيرة)                                               ║
 * ║  3. يولّد embedding + يبحث عن مشابه                                           ║
 * ║  4. إذا موجود → يزيد العداد + يحدّث رد البوت                                ║
 * ║  5. إذا جديد → يسجّله                                                        ║
 * ║  6. التاجر يراجع → يعدّل الرد → يضيف للمكتبة                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';

import {
  UnansweredQuestion,
  UnansweredStatus,
  CaptureSource,
} from './entities/unanswered-question.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const SIMILARITY_MERGE_THRESHOLD = 0.85;
const MAX_SAMPLE_VARIATIONS = 5;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MIN_QUESTION_LENGTH = 5;

/** كلمات قصيرة نتجاهلها — تحيات/شكر لا تحتاج تعلم */
const SKIP_PATTERNS = [
  /^(سلام|هلا|هاي|مرحبا|أهلا|الو|هلو)$/,
  /^(شكرا|شكراً|مشكور|تسلم|يعطيك العافية)$/,
  /^(hi|hey|hello|thanks|thank you|ok|okay)$/i,
  /^(صباح الخير|مساء الخير|السلام عليكم)$/,
];

// ═══════════════════════════════════════════════════════════════════════════════
// Event Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** حدث قديم — أسئلة بدون إجابة فقط */
interface UnansweredEvent {
  tenantId: string;
  storeId?: string;
  conversationId?: string;
  message: string;
  intent?: string;
  attempt?: number;
  maxAttempts?: number;
  knowledgeEntriesChecked?: number;
  timestamp: Date;
}

/** ✅ v2: حدث جديد — كل رسالة معالجة مع رد البوت */
interface MessageProcessedEvent {
  tenantId: string;
  storeId?: string;
  conversationId?: string;
  message: string;
  botResponse: string;
  intent?: string;
  confidence: number;
  knowledgeEntriesUsed: number;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AILearningService {
  private readonly logger = new Logger(AILearningService.name);
  private openai: OpenAI;
  private readonly isApiKeyConfigured: boolean;

  /** ✅ Dedup: منع تسجيل نفس الرسالة مرتين (ai.message_processed + ai.unanswered_question) */
  private readonly recentMessages = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 60_000; // 60 ثانية

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UnansweredQuestion)
    private readonly unansweredRepo: Repository<UnansweredQuestion>,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.isApiKeyConfigured = !!apiKey && apiKey.length > 10;
    this.openai = new OpenAI({ apiKey: apiKey || 'not-configured' });

    // Cleanup dedup map every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, ts] of this.recentMessages) {
        if (now - ts > this.DEDUP_WINDOW_MS) this.recentMessages.delete(key);
      }
    }, 300_000);
  }

  /** ✅ Dedup: check if message was already processed recently */
  private isDuplicate(tenantId: string, message: string): boolean {
    const key = `${tenantId}:${message.trim().slice(0, 100)}`;
    if (this.recentMessages.has(key)) return true;
    this.recentMessages.set(key, Date.now());
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 EVENT: ai.learning_capture — رصد كل رسالة (حتى لو البوت مطفي)
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('ai.learning_capture', { async: true })
  async handleLearningCapture(event: {
    tenantId: string;
    storeId?: string;
    conversationId?: string;
    message: string;
    aiEnabled: boolean;
    timestamp: Date;
  }): Promise<void> {
    try {
      if (!event.tenantId || !event.message) return;

      const question = event.message.trim();
      if (question.length < MIN_QUESTION_LENGTH) return;

      // ✅ Dedup
      if (this.isDuplicate(event.tenantId, question)) return;

      // ✅ لا نتجاهل أي رسالة — التاجر يبي يشوف كل شي (حتى التحيات)

      // ✅ إذا البوت شغّال → ai.message_processed سيتكفّل بالتسجيل (مع رد البوت)
      // نسجّل هنا فقط إذا البوت مطفي — عشان التاجر يشوف الرسائل ويجهّز المكتبة
      if (event.aiEnabled) return;

      await this.recordMessage(
        event.tenantId,
        question,
        undefined, // لا رد بوت — البوت مطفي
        CaptureSource.ALL,
        event.storeId,
        undefined,
      );

      this.logger.log(`📝 Learning (AI off): captured "${question.slice(0, 40)}..."`);
    } catch (error) {
      this.logger.error('Failed to capture learning message', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 EVENT: ai.message_processed — كل رسالة معالجة (v2)
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('ai.message_processed', { async: true })
  async handleMessageProcessed(event: MessageProcessedEvent): Promise<void> {
    try {
      if (!event.tenantId || !event.message || !event.botResponse) return;

      const question = event.message.trim();

      // تجاهل الرسائل القصيرة جداً
      if (question.length < MIN_QUESTION_LENGTH) return;

      // ✅ Dedup: نفس الرسالة ممكن تطلق ai.message_processed + ai.unanswered_question
      if (this.isDuplicate(event.tenantId, question)) return;

      // تجاهل التحيات والشكر البسيطة — ما تحتاج تعلم
      if (SKIP_PATTERNS.some(p => p.test(question.trim()))) return;

      // تحديد مصدر الرصد
      let captureSource = CaptureSource.ALL;
      if (event.confidence < 0.5 && event.knowledgeEntriesUsed === 0) {
        captureSource = CaptureSource.LOW_CONFIDENCE;
      }

      await this.recordMessage(
        event.tenantId,
        question,
        event.botResponse,
        captureSource,
        event.storeId,
        event.intent,
      );
    } catch (error) {
      this.logger.error('Failed to record processed message', {
        error: error instanceof Error ? error.message : 'Unknown',
        tenantId: event.tenantId,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 EVENT: ai.unanswered_question — أسئلة بدون إجابة (backward compat)
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('ai.unanswered_question', { async: true })
  async handleUnansweredQuestion(event: UnansweredEvent): Promise<void> {
    try {
      if (!event.tenantId || !event.message) return;

      const question = event.message.trim();
      if (question.length < MIN_QUESTION_LENGTH) return;

      // ✅ Dedup: skip if ai.message_processed already recorded this
      if (this.isDuplicate(event.tenantId, question)) return;

      await this.recordMessage(
        event.tenantId,
        question,
        undefined, // ما فيه رد بوت
        CaptureSource.NO_MATCH,
        event.storeId,
        event.intent,
      );
    } catch (error) {
      this.logger.error('Failed to record unanswered question', {
        error: error instanceof Error ? error.message : 'Unknown',
        tenantId: event.tenantId,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📝 RECORD — تسجيل أو دمج رسالة
  // ═══════════════════════════════════════════════════════════════════════════

  private async recordMessage(
    tenantId: string,
    question: string,
    botResponse?: string,
    captureSource: CaptureSource = CaptureSource.ALL,
    storeId?: string,
    intent?: string,
  ): Promise<void> {
    // ✅ Step 1: توليد embedding
    const embedding = await this.generateEmbedding(question);

    // ✅ Step 2: جلب الأسئلة المعلّقة
    const existing = await this.unansweredRepo.find({
      where: { tenantId, status: UnansweredStatus.PENDING },
    });

    // ✅ Step 3: بحث عن مشابه
    if (embedding && existing.length > 0) {
      const match = this.findSimilarQuestion(embedding, existing);

      if (match) {
        // ✅ MERGE: نفس الموضوع
        match.hitCount += 1;
        match.lastAskedAt = new Date();

        // إضافة صياغة جديدة
        const variations = match.sampleVariations || [];
        if (!variations.includes(question) && question !== match.representativeQuestion) {
          variations.push(question);
          if (variations.length > MAX_SAMPLE_VARIATIONS) variations.shift();
          match.sampleVariations = variations;
        }

        // ✅ v2: تحديث رد البوت (آخر رد)
        if (botResponse) {
          match.botResponse = botResponse;
        }

        // ترقية مصدر الرصد (no_match أهم من all)
        if (captureSource === CaptureSource.NO_MATCH) {
          match.captureSource = CaptureSource.NO_MATCH;
        } else if (captureSource === CaptureSource.LOW_CONFIDENCE &&
                   match.captureSource === CaptureSource.ALL) {
          match.captureSource = CaptureSource.LOW_CONFIDENCE;
        }

        if (intent && !match.detectedIntent) {
          match.detectedIntent = intent;
        }

        await this.unansweredRepo.save(match);

        this.logger.log(
          `📝 Learning: merged (hits: ${match.hitCount}) — "${question.slice(0, 40)}..."`,
        );
        return;
      }
    }

    // ✅ Step 4: سؤال جديد
    const newEntry = this.unansweredRepo.create({
      tenantId,
      storeId,
      representativeQuestion: question,
      sampleVariations: [],
      hitCount: 1,
      lastAskedAt: new Date(),
      detectedIntent: intent,
      status: UnansweredStatus.PENDING,
      embedding: embedding || undefined,
      botResponse: botResponse || undefined,
      captureSource,
    });

    await this.unansweredRepo.save(newEntry);

    this.logger.log(
      `📝 Learning: new message recorded — "${question.slice(0, 40)}..." [${captureSource}]`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔍 FIND SIMILAR
  // ═══════════════════════════════════════════════════════════════════════════

  private findSimilarQuestion(
    embedding: number[],
    existing: UnansweredQuestion[],
  ): UnansweredQuestion | null {
    let bestMatch: UnansweredQuestion | null = null;
    let bestScore = 0;

    for (const q of existing) {
      if (!q.embedding || !Array.isArray(q.embedding) || q.embedding.length === 0) continue;

      const similarity = this.cosineSimilarity(embedding, q.embedding);
      if (similarity > SIMILARITY_MERGE_THRESHOLD && similarity > bestScore) {
        bestScore = similarity;
        bestMatch = q;
      }
    }

    return bestMatch;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 API METHODS — للداشبورد
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * جلب الأسئلة — مرتبة بالتكرار (الأكثر أولاً)
   */
  async getUnanswered(
    tenantId: string,
    status: UnansweredStatus = UnansweredStatus.PENDING,
    limit: number = 50,
  ): Promise<UnansweredQuestion[]> {
    return this.unansweredRepo.find({
      where: { tenantId, status },
      order: { hitCount: 'DESC', lastAskedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * جلب إحصائيات سريعة
   */
  async getStats(tenantId: string): Promise<{
    pendingCount: number;
    resolvedCount: number;
    totalHits: number;
    topQuestion: string | null;
  }> {
    const pending = await this.unansweredRepo.find({
      where: { tenantId, status: UnansweredStatus.PENDING },
      order: { hitCount: 'DESC' },
    });

    const resolvedCount = await this.unansweredRepo.count({
      where: { tenantId, status: UnansweredStatus.RESOLVED },
    });

    const totalHits = pending.reduce((sum, q) => sum + q.hitCount, 0);

    return {
      pendingCount: pending.length,
      resolvedCount,
      totalHits,
      topQuestion: pending[0]?.representativeQuestion || null,
    };
  }

  /**
   * ✅ v2: تحديث جواب التاجر (المعدّل)
   */
  async setMerchantAnswer(
    tenantId: string,
    questionId: string,
    answer: string,
  ): Promise<UnansweredQuestion | null> {
    const question = await this.unansweredRepo.findOne({
      where: { id: questionId, tenantId },
    });
    if (!question) return null;

    question.merchantAnswer = answer;
    return this.unansweredRepo.save(question);
  }

  /**
   * تحديث حالة سؤال
   */
  async updateStatus(
    tenantId: string,
    questionId: string,
    status: UnansweredStatus,
    resolvedKnowledgeId?: string,
  ): Promise<UnansweredQuestion | null> {
    const question = await this.unansweredRepo.findOne({
      where: { id: questionId, tenantId },
    });
    if (!question) return null;

    question.status = status;
    if (resolvedKnowledgeId) {
      question.resolvedKnowledgeId = resolvedKnowledgeId;
    }

    return this.unansweredRepo.save(question);
  }

  /**
   * حذف سؤال (dismiss)
   */
  async dismiss(tenantId: string, questionId: string): Promise<boolean> {
    const result = await this.updateStatus(tenantId, questionId, UnansweredStatus.DISMISSED);
    return !!result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛠️ HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.isApiKeyConfigured) return null;

    try {
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text.substring(0, 8000),
      });
      return response.data[0]?.embedding || null;
    } catch (error) {
      this.logger.warn('Embedding generation failed for learning', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }
}
