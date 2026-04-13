/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - AI Learning Service                                  ║
 * ║                                                                                ║
 * ║  ✅ التعلم الذاتي — يسجّل الأسئلة بدون إجابة ويجمّعها بالمعنى               ║
 * ║                                                                                ║
 * ║  التدفق:                                                                      ║
 * ║  1. ai.unanswered_question event → recordUnanswered()                         ║
 * ║  2. يولّد embedding للسؤال                                                    ║
 * ║  3. يبحث عن أسئلة مشابهة (cosine > 0.85)                                     ║
 * ║  4. إذا موجود → يزيد العداد + يضيف الصياغة                                   ║
 * ║  5. إذا جديد → يسجّله كسؤال جديد                                             ║
 * ║  6. التاجر يشوف القائمة → يضيف الجواب → البوت يتعلم                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';

import { UnansweredQuestion, UnansweredStatus } from './entities/unanswered-question.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const SIMILARITY_MERGE_THRESHOLD = 0.85; // أسئلة أعلى من 85% تشابه = نفس السؤال
const MAX_SAMPLE_VARIATIONS = 5;         // أقصى عدد صياغات محفوظة
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MIN_QUESTION_LENGTH = 5;           // أقل طول سؤال يُسجّل

// ═══════════════════════════════════════════════════════════════════════════════
// Event Interface
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AILearningService {
  private readonly logger = new Logger(AILearningService.name);
  private openai: OpenAI;
  private readonly isApiKeyConfigured: boolean;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UnansweredQuestion)
    private readonly unansweredRepo: Repository<UnansweredQuestion>,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.isApiKeyConfigured = !!apiKey && apiKey.length > 10;
    this.openai = new OpenAI({ apiKey: apiKey || 'not-configured' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 EVENT LISTENER — يستلم أسئلة بدون إجابة
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('ai.unanswered_question', { async: true })
  async handleUnansweredQuestion(event: UnansweredEvent): Promise<void> {
    try {
      if (!event.tenantId || !event.message) return;

      // تجاهل الأسئلة القصيرة جداً
      const question = event.message.trim();
      if (question.length < MIN_QUESTION_LENGTH) return;

      await this.recordUnanswered(
        event.tenantId,
        question,
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
  // 📝 RECORD — تسجيل أو دمج سؤال بدون إجابة
  // ═══════════════════════════════════════════════════════════════════════════

  private async recordUnanswered(
    tenantId: string,
    question: string,
    storeId?: string,
    intent?: string,
  ): Promise<void> {
    // ✅ Step 1: توليد embedding للسؤال الجديد
    const embedding = await this.generateEmbedding(question);

    // ✅ Step 2: جلب كل الأسئلة المعلّقة لهذا التاجر
    const existing = await this.unansweredRepo.find({
      where: { tenantId, status: UnansweredStatus.PENDING },
    });

    // ✅ Step 3: البحث عن سؤال مشابه (تجميع ذكي)
    if (embedding && existing.length > 0) {
      const match = this.findSimilarQuestion(embedding, existing);

      if (match) {
        // ✅ MERGE: نفس الموضوع — زيادة العداد + إضافة الصياغة
        match.hitCount += 1;
        match.lastAskedAt = new Date();

        // إضافة الصياغة الجديدة (إذا مختلفة) — نحتفظ بآخر 5
        const variations = match.sampleVariations || [];
        if (!variations.includes(question) && question !== match.representativeQuestion) {
          variations.push(question);
          if (variations.length > MAX_SAMPLE_VARIATIONS) {
            variations.shift(); // حذف الأقدم
          }
          match.sampleVariations = variations;
        }

        // تحديث intent إذا أدق
        if (intent && !match.detectedIntent) {
          match.detectedIntent = intent;
        }

        await this.unansweredRepo.save(match);

        this.logger.log(
          `📝 Learning: merged question (hits: ${match.hitCount}) — "${question.slice(0, 50)}..."`,
        );
        return;
      }
    }

    // ✅ Step 4: سؤال جديد — إنشاء سجل
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
    });

    await this.unansweredRepo.save(newEntry);

    this.logger.log(
      `📝 Learning: new unanswered question recorded — "${question.slice(0, 50)}..."`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔍 FIND SIMILAR — بحث عن سؤال مشابه بالمعنى
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
   * جلب الأسئلة بدون إجابة — مرتبة بالتكرار (الأكثر أولاً)
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
    totalHits: number;
    topQuestion: string | null;
  }> {
    const pending = await this.unansweredRepo.find({
      where: { tenantId, status: UnansweredStatus.PENDING },
      order: { hitCount: 'DESC' },
    });

    const totalHits = pending.reduce((sum, q) => sum + q.hitCount, 0);

    return {
      pendingCount: pending.length,
      totalHits,
      topQuestion: pending[0]?.representativeQuestion || null,
    };
  }

  /**
   * تحديث حالة سؤال (resolved أو dismissed)
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
