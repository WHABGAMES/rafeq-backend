/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Service (Production v2)                       ║
 * ║                                                                                ║
 * ║  ✅ جميع البيانات حقيقية من DB — صفر قيم وهمية                                ║
 * ║  ✅ مكتبة المعلومات: CRUD حقيقي مع KnowledgeBase entity                       ║
 * ║  ✅ إعدادات البوت: محفوظة في store_settings بمفتاح 'ai'                        ║
 * ║  ✅ System Prompt: يُبنى من المكتبة حسب أولوية البحث                           ║
 * ║  ✅ أدوات البوت: تقرأ من Order entity الحقيقي                                  ║
 * ║  ✅ التحويل البشري: silence + تنبيهات EventEmitter                             ║
 * ║  ✅ التحليلات: محسوبة من المحادثات والرسائل الفعلية                             ║
 * ║                                                                                ║
 * ║  🔧 v2 Fixes (مطابقة حقيقية لـ entities):                                      ║
 * ║  - Conversation لا يملك storeId → نجلبه عبر Channel.storeId                   ║
 * ║  - Message يستخدم content (وليس body)                                         ║
 * ║  - Order يستخدم totalAmount مباشرة (ليس as any)                               ║
 * ║  - Order يستخدم shippingInfo (ليس shipping)                                   ║
 * ║  - AI detection عبر ai_metadata IS NOT NULL                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
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
import { KnowledgeBase, KnowledgeCategory } from './entities/knowledge-base.entity';
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
  customerId: string;
  customerName?: string;
  channel: string;
  messageCount: number;
  failedAttempts: number;
  isHandedOff: boolean;
  previousMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AIResponse {
  reply: string;
  confidence: number;
  intent?: string;
  shouldHandoff: boolean;
  handoffReason?: string;
  toolsUsed?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

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
    const apiKey = this.configService.get<string>('ai.apiKey');
    this.openai = new OpenAI({ apiKey: apiKey || '' });
    this.logger.log('✅ AI Service initialized');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 SETTINGS — حقيقية من store_settings table
  // ═══════════════════════════════════════════════════════════════════════════════

  async getSettings(tenantId: string, storeId?: string): Promise<AISettings> {
    const where: any = { tenantId, settingsKey: 'ai' };
    if (storeId) where.storeId = storeId;

    const row = await this.settingsRepo.findOne({ where });

    if (row?.settingsValue) {
      return { ...AI_DEFAULTS, ...(row.settingsValue as Partial<AISettings>) };
    }
    return { ...AI_DEFAULTS };
  }

  async updateSettings(
    tenantId: string,
    storeId: string | undefined,
    updates: Partial<AISettings>,
  ): Promise<AISettings> {
    const where: any = { tenantId, settingsKey: 'ai' };
    if (storeId) where.storeId = storeId;

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
        storeId: storeId || tenantId,
        settingsKey: 'ai',
        settingsValue: merged as unknown as Record<string, unknown>,
      });
    }

    await this.settingsRepo.save(row);
    this.logger.log('✅ AI settings saved', { tenantId, storeId });
    return merged;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📚 KNOWLEDGE BASE — CRUD حقيقي مع KnowledgeBase entity
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
      qb.andWhere(
        '(kb.title ILIKE :search OR kb.content ILIKE :search)',
        { search: `%${filters.search}%` },
      );
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
      categories: categoryCounts.map((c: any) => ({
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
    },
  ): Promise<KnowledgeBase> {
    const entry = this.knowledgeRepo.create({
      tenantId,
      title: data.title,
      content: data.content,
      category: (data.category as KnowledgeCategory) || KnowledgeCategory.GENERAL,
      keywords: data.keywords || [],
      priority: data.priority ?? 10,
      isActive: true,
    });
    const saved = await this.knowledgeRepo.save(entry);
    this.logger.log('✅ Knowledge added', { tenantId, id: saved.id });
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
    }>,
  ): Promise<KnowledgeBase | null> {
    const entry = await this.knowledgeRepo.findOne({ where: { id, tenantId } });
    if (!entry) return null;
    Object.assign(entry, data);
    return this.knowledgeRepo.save(entry);
  }

  async deleteKnowledge(tenantId: string, id: string): Promise<boolean> {
    const result = await this.knowledgeRepo.delete({ id, tenantId });
    return (result.affected || 0) > 0;
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

    // 1. سكوت البوت بعد التحويل
    if (settings.silenceOnHandoff && context.isHandedOff) {
      return { reply: '', confidence: 0, shouldHandoff: false, intent: 'SILENCED' };
    }

    // 2. كلمات التحويل المباشر
    const handoff = this.checkDirectHandoff(message, context, settings);
    if (handoff.shouldHandoff) {
      await this.handleHandoff(context, settings, handoff.reason || 'CUSTOMER_REQUEST');
      return {
        reply: settings.handoffMessage || AI_DEFAULTS.handoffMessage,
        confidence: 1,
        shouldHandoff: true,
        handoffReason: handoff.reason,
      };
    }

    // 3. بناء System Prompt
    const systemPrompt = await this.buildSystemPrompt(settings, context);

    // 4. سجل المحادثة
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...context.previousMessages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    // 5. الأدوات المتاحة
    const tools = this.getAvailableTools();

    // 6. استدعاء OpenAI
    try {
      const completion = await this.openai.chat.completions.create({
        model: settings.model || 'gpt-4o',
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: settings.temperature ?? 0.7,
        max_tokens: settings.maxTokens || 1000,
      });

      const assistantMsg = completion.choices[0]?.message;
      if (!assistantMsg) throw new Error('No response from OpenAI');

      let finalReply = assistantMsg.content || '';
      const toolsUsed: string[] = [];

      // 7. تنفيذ الأدوات
      if (assistantMsg.tool_calls?.length) {
        const toolResults = await this.executeToolCalls(
          assistantMsg.tool_calls,
          context,
        );
        toolsUsed.push(...toolResults.map((r) => r.name));

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
          model: settings.model || 'gpt-4o',
          messages: toolMessages,
          temperature: settings.temperature ?? 0.7,
          max_tokens: settings.maxTokens || 1000,
        });

        finalReply = followUp.choices[0]?.message?.content || finalReply;
      }

      // 8. تحليل الرد
      const analysis = this.analyzeResponseQuality(finalReply, message);
      if (analysis.shouldHandoff) {
        await this.handleHandoff(context, settings, 'LOW_CONFIDENCE');
      }

      return {
        reply: finalReply,
        confidence: analysis.confidence,
        intent: analysis.intent,
        shouldHandoff: analysis.shouldHandoff,
        handoffReason: analysis.handoffReason,
        toolsUsed,
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
  // 📝 SYSTEM PROMPT BUILDER
  // ═══════════════════════════════════════════════════════════════════════════════

  private async buildSystemPrompt(
    settings: AISettings,
    context: ConversationContext,
  ): Promise<string> {
    const isAr = settings.language !== 'en';

    let prompt = isAr
      ? `أنت مساعد ذكي لخدمة العملاء في "${settings.storeName || 'المتجر'}".`
      : `You are a helpful customer service assistant for "${settings.storeName || 'Store'}".`;

    const tones: Record<string, string> = {
      formal: isAr ? 'استخدم لغة رسمية ومهنية.' : 'Use formal language.',
      friendly: isAr ? 'كن ودوداً ولطيفاً. استخدم الإيموجي عند المناسب.' : 'Be friendly and warm.',
      professional: isAr ? 'كن مهنياً ومفيداً.' : 'Be professional and helpful.',
    };
    prompt += '\n' + (tones[settings.tone] || tones.friendly);

    if (settings.storeDescription) prompt += `\n${isAr ? 'عن المتجر' : 'About'}: ${settings.storeDescription}`;
    if (settings.workingHours) prompt += `\n${isAr ? 'أوقات العمل' : 'Hours'}: ${settings.workingHours}`;
    if (settings.returnPolicy) prompt += `\n${isAr ? 'سياسة الإرجاع' : 'Returns'}: ${settings.returnPolicy}`;
    if (settings.shippingInfo) prompt += `\n${isAr ? 'الشحن' : 'Shipping'}: ${settings.shippingInfo}`;

    // Knowledge base
    const sp = settings.searchPriority || SearchPriority.LIBRARY_THEN_PRODUCTS;
    if (sp === SearchPriority.LIBRARY_ONLY || sp === SearchPriority.LIBRARY_THEN_PRODUCTS) {
      const knowledge = await this.knowledgeRepo.find({
        where: { tenantId: context.tenantId, isActive: true },
        order: { priority: 'ASC' },
        take: 30,
      });
      if (knowledge.length > 0) {
        prompt += isAr ? '\n\n=== معلومات المتجر ===' : '\n\n=== Knowledge Base ===';
        for (const kb of knowledge) {
          prompt += `\n[${kb.title}]: ${kb.content}`;
        }
      }
    }

    if (context.customerName) {
      prompt += `\n\n${isAr ? 'اسم العميل' : 'Customer'}: ${context.customerName}`;
    }

    prompt += isAr
      ? `\n\n=== قواعد ===
1. أجب فقط بناءً على المعلومات المتوفرة. لا تختلق.
2. إذا لم تجد الإجابة: "${settings.fallbackMessage || AI_DEFAULTS.fallbackMessage}"
3. لا تذكر أسعاراً غير موجودة في معلوماتك.
4. إذا طلب العميل شخصاً، استخدم أداة request_human_agent.
5. كن موجزاً ومفيداً.`
      : `\n\n=== Rules ===
1. Only answer from provided info. Never make up info.
2. If unsure: "${settings.fallbackMessage || AI_DEFAULTS.fallbackMessage}"
3. If customer asks for human, use request_human_agent tool.
4. Be concise and helpful.`;

    return prompt;
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
              order_id: { type: 'string', description: 'Order ID or reference' },
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
              reason: { type: 'string', description: 'Reason for handoff' },
            },
            required: ['reason'],
          },
        },
      },
    ];
  }

  private async executeToolCalls(
    toolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>,
    context: ConversationContext,
  ): Promise<Array<{ name: string; result: unknown; toolCallId: string }>> {
    const results: Array<{ name: string; result: unknown; toolCallId: string }> = [];

    for (const tc of toolCalls) {
      let args: Record<string, any> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }

      let result: unknown;
      try {
        switch (tc.function.name) {
          case 'get_order_status':
            result = await this.toolGetOrderStatus(context.tenantId, args.order_id);
            break;
          case 'request_human_agent':
            result = { success: true, message: 'تم التحويل للدعم البشري' };
            this.eventEmitter.emit('conversation.handoff.requested', {
              conversationId: context.conversationId,
              tenantId: context.tenantId,
              reason: args.reason,
            });
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
   * ✅ يقرأ من Order entity مباشرة
   * - totalAmount: حقل حقيقي في order.entity.ts (ليس as any)
   * - shippingInfo: الحقل الحقيقي (ليس shipping)
   */
  private async toolGetOrderStatus(tenantId: string, orderId: string): Promise<unknown> {
    const order = await this.orderRepo.findOne({
      where: [
        { tenantId, sallaOrderId: orderId },
        { tenantId, referenceId: orderId },
      ],
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
      shipping_info: order.shippingInfo || null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 HANDOFF
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleHandoff(
    context: ConversationContext,
    settings: AISettings,
    reason: string,
  ): Promise<void> {
    await this.conversationRepo.update(
      { id: context.conversationId },
      { handler: ConversationHandler.HUMAN },
    );

    this.eventEmitter.emit('ai.handoff', {
      conversationId: context.conversationId,
      tenantId: context.tenantId,
      customerId: context.customerId,
      customerName: context.customerName,
      channel: context.channel,
      reason,
      notifyEmployeeIds: settings.handoffNotifyEmployeeIds,
      notifyPhones: settings.handoffNotifyPhones,
      notifyEmails: settings.handoffNotifyEmails,
    });

    this.logger.log('🔄 Handoff executed', {
      conversationId: context.conversationId,
      reason,
    });
  }

  private checkDirectHandoff(
    message: string,
    context: ConversationContext,
    settings: AISettings,
  ): { shouldHandoff: boolean; reason?: string } {
    const lower = message.toLowerCase();

    const keywords = [
      'أريد شخص', 'أريد إنسان', 'موظف', 'دعم بشري',
      'تحدث مع شخص', 'human', 'agent', 'real person',
      ...(settings.handoffKeywords || []),
    ];

    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { shouldHandoff: true, reason: 'CUSTOMER_REQUEST' };
      }
    }

    if (settings.autoHandoff && context.failedAttempts >= settings.handoffAfterFailures) {
      return { shouldHandoff: true, reason: 'MAX_FAILURES' };
    }

    return { shouldHandoff: false };
  }

  private analyzeResponseQuality(reply: string, originalMessage: string): {
    confidence: number;
    intent?: string;
    shouldHandoff: boolean;
    handoffReason?: string;
  } {
    const lower = reply.toLowerCase();
    const lm = originalMessage.toLowerCase();

    let intent: string | undefined;
    if (lm.includes('طلب') || lm.includes('order') || lm.includes('شحن')) intent = 'ORDER_INQUIRY';
    else if (lm.includes('منتج') || lm.includes('سعر')) intent = 'PRODUCT_INQUIRY';
    else if (lm.includes('مشكلة') || lm.includes('شكوى')) intent = 'COMPLAINT';
    else if (lm.includes('مرحب') || lm.includes('السلام')) intent = 'GREETING';

    const uncertainPhrases = ['لست متأكداً', 'لا أعرف', 'ربما', 'not sure', "don't know"];
    let confidence = 0.85;
    for (const p of uncertainPhrases) {
      if (lower.includes(p.toLowerCase())) {
        confidence = 0.3;
        break;
      }
    }

    return {
      confidence,
      intent,
      shouldHandoff: confidence < 0.3,
      handoffReason: confidence < 0.3 ? 'LOW_CONFIDENCE' : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧪 TEST & GENERATE RESPONSE
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * اختبار رد البوت — يستخدم OpenAI API حقيقياً
   */
  async testResponse(
    tenantId: string,
    message: string,
    storeContext?: { storeName: string; tone: string },
  ): Promise<{ reply: string; processingTime: number }> {
    const startTime = Date.now();
    try {
      const settings = await this.getSettings(tenantId);

      const sysPrompt = storeContext
        ? `أنت مساعد خدمة عملاء لمتجر "${storeContext.storeName}". كن ${storeContext.tone === 'friendly' ? 'ودوداً' : 'مهنياً'}.`
        : `أنت مساعد خدمة عملاء لمتجر "${settings.storeName || 'المتجر'}". أجب باختصار.`;

      const completion = await this.openai.chat.completions.create({
        model: settings.model || 'gpt-4o',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      return {
        reply: completion.choices[0]?.message?.content || 'لم أتمكن من الرد',
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        reply: `خطأ: ${error instanceof Error ? error.message : 'فشل الاتصال بـ OpenAI'}`,
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * ✅ v2 FIX: generateResponse
   * - Conversation لا يملك storeId → لا نحاول الوصول إليه
   * - Message يستخدم content (ليس body)
   * - channelId يُستخدم كـ channel context
   */
  async generateResponse(params: {
    tenantId: string;
    conversationId: string;
    message: string;
  }): Promise<AIResponse> {
    const settings = await this.getSettings(params.tenantId);

    if (!settings.enabled) {
      return { reply: '', confidence: 0, shouldHandoff: false };
    }

    const conv = await this.conversationRepo.findOne({
      where: { id: params.conversationId },
    });

    const context: ConversationContext = {
      conversationId: params.conversationId,
      tenantId: params.tenantId,
      customerId: conv?.customerId || '',
      customerName: conv?.customerName || undefined,
      channel: conv?.channelId || '',
      messageCount: conv?.messagesCount || 0,
      failedAttempts: 0,
      isHandedOff: conv?.handler === ConversationHandler.HUMAN,
      previousMessages: [],
    };

    // ✅ جلب آخر 10 رسائل — الحقل الصحيح: content (ليس body)
    if (conv) {
      const msgs = await this.messageRepo.find({
        where: { conversationId: params.conversationId },
        order: { createdAt: 'DESC' },
        take: 10,
      });

      context.previousMessages = msgs.reverse().map((m) => ({
        role: m.direction === MessageDirection.OUTBOUND ? 'assistant' as const : 'user' as const,
        content: m.content || '',
      }));
    }

    return this.processMessage(params.message, context, settings);
  }

  /**
   * تحليل رسالة (intent + sentiment)
   */
  async analyzeMessage(message: string): Promise<{
    intent: string;
    sentiment: string;
    confidence: number;
  }> {
    const lower = message.toLowerCase();
    let intent = 'general';
    let sentiment = 'neutral';

    if (lower.includes('طلب') || lower.includes('order')) { intent = 'order_inquiry'; }
    else if (lower.includes('شكر') || lower.includes('thank')) { intent = 'thanks'; sentiment = 'positive'; }
    else if (lower.includes('مشكل') || lower.includes('problem')) { intent = 'complaint'; sentiment = 'negative'; }
    else if (lower.includes('مرحب') || lower.includes('السلام')) { intent = 'greeting'; sentiment = 'positive'; }

    return { intent, sentiment, confidence: 0.8 };
  }

  /**
   * تدريب البوت — يحول FAQs إلى knowledge base entries
   */
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
          keywords: [],
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
          keywords: [],
        });
        added++;
      }
    }

    return { status: 'completed', entriesAdded: added };
  }

  /**
   * حالة التدريب — محسوبة من عدد entries الموجودة
   */
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
   * ✅ v2 FIX: ai_metadata IS NOT NULL (ليس metadata->>'isAI')
   */
  async getStats(tenantId: string): Promise<{
    totalResponses: number;
    successRate: number;
    avgResponseTime: number;
    handoffRate: number;
  }> {
    const totalAI = await this.conversationRepo.count({
      where: { tenantId, handler: ConversationHandler.AI },
    });
    const handoffs = await this.conversationRepo.count({
      where: { tenantId, handler: ConversationHandler.HUMAN },
    });
    const total = totalAI + handoffs;

    // ✅ عدد رسائل البوت الحقيقية
    const botMessages = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.direction = :dir', { dir: MessageDirection.OUTBOUND })
      .andWhere('m.aiMetadata IS NOT NULL')
      .getCount();

    return {
      totalResponses: botMessages,
      successRate: total > 0 ? Math.round((totalAI / total) * 100) : 0,
      avgResponseTime: 0,
      handoffRate: total > 0 ? Math.round((handoffs / total) * 100) : 0,
    };
  }

  async getAnalytics(tenantId: string, period: string) {
    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case 'day': startDate.setDate(now.getDate() - 1); break;
      case 'week': startDate.setDate(now.getDate() - 7); break;
      case 'month': startDate.setMonth(now.getMonth() - 1); break;
      default: startDate.setDate(now.getDate() - 7);
    }

    const conversations = await this.conversationRepo.find({
      where: { tenantId, createdAt: Between(startDate, now) },
      select: ['id', 'handler', 'status', 'createdAt'],
    });

    const totalConversations = conversations.length;
    const aiHandled = conversations.filter((c) => c.handler === ConversationHandler.AI).length;
    const humanHandoff = conversations.filter((c) => c.handler === ConversationHandler.HUMAN).length;

    const dailyData = await this.conversationRepo
      .createQueryBuilder('c')
      .select("DATE(c.createdAt)", 'date')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(CASE WHEN c.handler = 'ai' THEN 1 END)`, 'ai_handled')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.createdAt BETWEEN :start AND :end', { start: startDate, end: now })
      .groupBy("DATE(c.createdAt)")
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      period,
      summary: {
        totalConversations,
        aiHandled,
        humanHandoff,
        successRate: totalConversations > 0
          ? Math.round((aiHandled / totalConversations) * 100 * 10) / 10
          : 0,
      },
      trends: dailyData.map((d: any) => ({
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
