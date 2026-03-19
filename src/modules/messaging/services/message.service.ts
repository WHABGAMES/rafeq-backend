/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Message Service                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// Entities
import {
  Message,
  MessageDirection,
  MessageType,
  MessageStatus,
  MessageSender,
} from '../../../database/entities/message.entity';
import {
  Conversation,
  ConversationStatus,
  ConversationHandler,
} from '../../../database/entities/conversation.entity';
import { Channel, ChannelType } from '../../../database/entities/channel.entity';

// ✅ ChannelsService — للإرسال المباشر عبر WhatsApp
import { ChannelsService } from '../../channels/channels.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES & TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface IncomingMessageData {
  channelId: string;
  channelType: ChannelType;
  tenantId: string;
  externalMessageId: string;
  type: MessageType;
  content?: string;
  timestamp: Date;
  senderExternalId: string;
  senderName?: string;
  senderPhone?: string;
  media?: {
    url: string;
    mimeType?: string;
    filename?: string;
    size?: number;
    caption?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  interactiveReply?: {
    type: 'button' | 'list_item';
    id: string;
    title: string;
  };
  metadata?: Record<string, unknown>;
}

export interface OutgoingMessageData {
  conversationId: string;
  type: MessageType;
  content?: string;
  sender: MessageSender;
  agentId?: string;
  media?: {
    url: string;
    mimeType?: string;
    filename?: string;
    caption?: string;
  };
  interactive?: {
    type: 'button' | 'list';
    header?: string;
    body?: string;
    footer?: string;
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
  template?: {
    name: string;
    language: string;
    components?: Array<{
      type: string;
      parameters?: Array<{ type: string; text?: string }>;
    }>;
  };
  aiMetadata?: {
    intent?: string;
    confidence?: number;
    toolsCalled?: string[];
    processingTime?: number;
    ragAudit?: {
      answer_source: string;
      similarity_score: number;
      verifier_result: string;
      final_decision: string;
      retrieved_chunks: number;
      gate_a_passed: boolean;
      gate_b_passed: boolean;
    };
  };
}

export interface MessageFilters {
  tenantId: string;
  conversationId?: string;
  channelId?: string;
  direction?: MessageDirection;
  type?: MessageType;
  status?: MessageStatus;
  sender?: MessageSender;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export interface MessageStatusUpdate {
  channelType: ChannelType;
  externalMessageId: string;
  status: MessageStatus;
  timestamp: Date;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 MESSAGE SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class MessageService implements OnModuleInit {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    
    @InjectQueue('messaging')
    private readonly messagingQueue: Queue,

    // ✅ إرسال مباشر — لا نحفظ إلا بعد تأكيد الوصول
    private readonly channelsService: ChannelsService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚀 Idempotent DB Migration — تُنفَّذ عند كل بدء تشغيل
  //
  //  تُنشئ جداول conversations + messages إذا لم تكن موجودة،
  //  وتُضيف أي أعمدة ناقصة بـ ALTER TABLE ADD COLUMN IF NOT EXISTS
  //  آمن 100%: لا يمسّ بيانات موجودة، لا يفشل إذا الجدول قائم
  // ═══════════════════════════════════════════════════════════════════════════
  async onModuleInit(): Promise<void> {
    await this.ensureConversationsTable();
    await this.ensureMessagesTable();
  }

  private async ensureConversationsTable(): Promise<void> {
    try {
      // ── Step 1: إنشاء الجدول الأساسي ──────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id            UUID        NOT NULL,
          channel_id           UUID        NOT NULL,
          status               VARCHAR(30) NOT NULL DEFAULT 'open',
          priority             VARCHAR(20) NOT NULL DEFAULT 'normal',
          handler              VARCHAR(20) NOT NULL DEFAULT 'ai',
          customer_external_id VARCHAR(255) NOT NULL DEFAULT '',
          messages_count       INTEGER     NOT NULL DEFAULT 0,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at           TIMESTAMPTZ
        );
      `);

      // ── Step 2: أضف أعمدة قد تكون ناقصة ──────────────────────────────────
      const cols = [
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to_id UUID;`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_id UUID;`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS subject VARCHAR(500);`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary TEXT;`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;`,
        `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;`,
      ];
      for (const sql of cols) {
        try { await this.dataSource.query(sql); } catch { /* عمود موجود مسبقاً */ }
      }

      // ── Step 3: indexes ────────────────────────────────────────────────────
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_conv_tenant    ON conversations (tenant_id);`,
        `CREATE INDEX IF NOT EXISTS idx_conv_channel   ON conversations (channel_id);`,
        `CREATE INDEX IF NOT EXISTS idx_conv_status    ON conversations (status);`,
        `CREATE INDEX IF NOT EXISTS idx_conv_ext_id    ON conversations (customer_external_id);`,
        `CREATE INDEX IF NOT EXISTS idx_conv_phone     ON conversations (customer_phone);`,
        `CREATE INDEX IF NOT EXISTS idx_conv_last_msg  ON conversations (last_message_at DESC);`,
      ];
      for (const sql of indexes) {
        try { await this.dataSource.query(sql); } catch { /* index موجود */ }
      }

      this.logger.log('✅ conversations table ready');
    } catch (err) {
      this.logger.error('❌ conversations table init failed', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  private async ensureMessagesTable(): Promise<void> {
    try {
      // ── Step 1: إنشاء الجدول الأساسي ──────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id       UUID        NOT NULL,
          conversation_id UUID        NOT NULL,
          direction       VARCHAR(20) NOT NULL DEFAULT 'inbound',
          type            VARCHAR(30) NOT NULL DEFAULT 'text',
          status          VARCHAR(20) NOT NULL DEFAULT 'pending',
          sender          VARCHAR(20) NOT NULL DEFAULT 'customer',
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at      TIMESTAMPTZ
        );
      `);

      // ── Step 2: أضف أعمدة قد تكون ناقصة ──────────────────────────────────
      const cols = [
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media JSONB;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS interactive JSONB;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to JSONB;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_metadata JSONB;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_message TEXT;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;`,
        `ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;`,
      ];
      for (const sql of cols) {
        try { await this.dataSource.query(sql); } catch { /* عمود موجود */ }
      }

      // ── Step 3: indexes ────────────────────────────────────────────────────
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_msg_tenant       ON messages (tenant_id);`,
        `CREATE INDEX IF NOT EXISTS idx_msg_conversation ON messages (conversation_id);`,
        `CREATE INDEX IF NOT EXISTS idx_msg_direction    ON messages (direction);`,
        `CREATE INDEX IF NOT EXISTS idx_msg_status       ON messages (status);`,
        `CREATE INDEX IF NOT EXISTS idx_msg_created      ON messages (created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_msg_external     ON messages (external_id);`,
      ];
      for (const sql of indexes) {
        try { await this.dataSource.query(sql); } catch { /* index موجود */ }
      }

      this.logger.log('✅ messages table ready');
    } catch (err) {
      this.logger.error('❌ messages table init failed', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 PROCESS INCOMING MESSAGE
  // ═══════════════════════════════════════════════════════════════════════════

  async processIncomingMessage(data: IncomingMessageData): Promise<Message> {
    const startTime = Date.now();
    this.logger.log(`📥 Processing incoming message from ${data.channelType}`);

    // 1️⃣ IDEMPOTENCY CHECK
    const existingMessage = await this.messageRepo.findOne({
      where: {
        tenantId: data.tenantId,
        externalId: data.externalMessageId,
      },
    });

    if (existingMessage) {
      this.logger.warn(`⚠️ Duplicate message detected: ${data.externalMessageId}`);
      return existingMessage;
    }

    // 2️⃣ VALIDATE CHANNEL
    // ✅ البحث بـ id فقط — الـ listener تحقق مسبقاً من ملكية القناة
    // ملاحظة: storeId ≠ tenantId (storeId = Store UUID, tenantId = Tenant UUID)
    const channel = await this.channelRepo.findOne({
      where: {
        id: data.channelId,
      },
    });

    if (!channel) {
      throw new NotFoundException(`Channel not found: ${data.channelId}`);
    }

    // 3️⃣ FIND OR CREATE CONVERSATION
    // ✅ البحث بالـ JID الكامل + الرقم المجرّد لتوافق البيانات القديمة
    // ⚠️  استثناء: إذا كان الـ JID من نوع @lid، فالرقم المجرّد ليس رقم هاتف
    //              (مثل 67173456302225 من 67173456302225@lid) — لا نبحث به
    const isLidSender = data.senderExternalId.includes('@lid');
    const bareNumber = data.senderExternalId.split('@')[0].replace(/\D/g, '');
    const activeStatuses = In([
      ConversationStatus.OPEN,
      ConversationStatus.PENDING,
      ConversationStatus.ASSIGNED,
      ConversationStatus.RESOLVED,  // ✅ إعادة فتح المحادثة بدل إنشاء جديدة
    ]);

    let conversation = await this.conversationRepo.findOne({
      where: [
        // البحث بالـ JID الكامل (الصيغة الجديدة)
        {
          tenantId: data.tenantId,
          channelId: data.channelId,
          customerExternalId: data.senderExternalId,
          status: activeStatuses,
        },
        // البحث بالرقم المجرّد (البيانات القديمة) — backward compatibility
        // ⛔ لا نفعّل هذا لعملاء @lid لأن الرقم المجرّد ليس رقم هاتف
        ...(!isLidSender && bareNumber !== data.senderExternalId ? [{
          tenantId: data.tenantId,
          channelId: data.channelId,
          customerExternalId: bareNumber,
          status: activeStatuses,
        }] : []),
      ],
      order: { lastMessageAt: 'DESC' },
    });

    const isNewConversation = !conversation;

    // ✅ تحديث بيانات العميل في المحادثة الموجودة:
    // - تحديث JID إذا تغيّر (ترحيل من رقم مجرّد لـ JID كامل)
    // - تحديث الاسم إذا كان فارغاً وتوفّر pushName جديد
    // - تحديث الرقم إذا كان فارغاً وتوفّر رقم حقيقي
    if (conversation) {
      let needsUpdate = false;

      if (conversation.customerExternalId !== data.senderExternalId) {
        conversation.customerExternalId = data.senderExternalId;
        needsUpdate = true;
      }
      if (data.senderName && !conversation.customerName) {
        conversation.customerName = data.senderName;
        needsUpdate = true;
      }
      if (data.senderPhone && !conversation.customerPhone) {
        conversation.customerPhone = data.senderPhone;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await this.conversationRepo.save(conversation);
      }
    }

    if (isNewConversation) {
      this.logger.log(`📝 Creating new conversation for ${data.senderExternalId}`);
      
      conversation = this.conversationRepo.create({
        tenantId: data.tenantId,
        channelId: data.channelId,
        customerExternalId: data.senderExternalId,
        customerName: data.senderName,
        customerPhone: data.senderPhone,
        status: ConversationStatus.OPEN,
        handler: ConversationHandler.AI,
        messagesCount: 0,
        aiContext: {},
        metadata: {},
        tags: [],
      });
      
      await this.conversationRepo.save(conversation);
    }

    if (!conversation) {
      throw new Error('Failed to create or find conversation');
    }

    // 4️⃣ CREATE AND SAVE MESSAGE
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const message = this.messageRepo.create({
        tenantId: data.tenantId,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: data.type,
        status: MessageStatus.DELIVERED,
        sender: MessageSender.CUSTOMER,
        externalId: data.externalMessageId,
        content: data.content,
        media: data.media,
        location: data.location,
        metadata: data.metadata || {},
        deliveredAt: data.timestamp,
      });

      await queryRunner.manager.save(Message, message);

      const updateData: Record<string, unknown> = {
        messagesCount: () => '"messages_count" + 1',
        lastMessageAt: data.timestamp,
      };

      if (conversation.status === ConversationStatus.RESOLVED) {
        updateData.status = ConversationStatus.OPEN;
      }

      await queryRunner.manager.update(Conversation, conversation.id, updateData);

      await queryRunner.manager.update(Channel, channel.id, {
        lastActivityAt: data.timestamp,
      });

      await queryRunner.commitTransaction();

      // 5️⃣ EMIT EVENTS
      this.eventEmitter.emit('message.received', {
        message,
        conversation,
        channel,
        isNewConversation,
      });

      await this.messagingQueue.add('process-incoming', {
        messageId: message.id,
        conversationId: conversation.id,
        channelId: channel.id,
        tenantId: data.tenantId,
        isNewConversation,
      }, {
        delay: 15000, // ✅ 15 ثانية — شبكة أمان: يتحقق إذا AI رد (AI + API يأخذ 6-10 ثوانٍ)
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Message saved in ${duration}ms: ${message.id}`);

      return message;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ Failed to save message: ${(error as Error).message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📤 CREATE OUTGOING MESSAGE — أرسل أولاً، احفظ بعدين
  // ═══════════════════════════════════════════════════════════════════════════

  async createOutgoingMessage(data: OutgoingMessageData): Promise<Message> {
    this.logger.log(`📤 Creating outgoing message for conversation: ${data.conversationId}`);

    // 1️⃣ تحميل المحادثة والقناة
    const conversation = await this.conversationRepo.findOne({
      where: { id: data.conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${data.conversationId}`);
    }

    const channel = await this.channelRepo.findOne({
      where: { id: conversation.channelId },
    });

    if (!channel) {
      throw new NotFoundException(`Channel not found: ${conversation.channelId}`);
    }

    // 2️⃣ تحديد المستقبل
    const recipient = conversation.customerExternalId || conversation.customerPhone;
    if (!recipient) {
      throw new Error(`No recipient for conversation: ${data.conversationId}`);
    }

    // 3️⃣ ✅ الإرسال أولاً — لا نحفظ شيء قبل تأكيد واتساب
    const isWhatsApp = channel.type === ChannelType.WHATSAPP_QR || channel.type === ChannelType.WHATSAPP_OFFICIAL;
    let externalId: string | undefined;
    let sendStatus: MessageStatus = MessageStatus.SENT;
    let errorMessage: string | undefined;

    if (isWhatsApp) {
      if (!data.content) {
        // ⚠️ واتساب بدون محتوى نصي — لا نرسل
        sendStatus = MessageStatus.FAILED;
        errorMessage = 'No text content to send via WhatsApp';
        this.logger.warn(`⚠️ WhatsApp message with no content — saving as FAILED`);
      } else {
        try {
          this.logger.log(`📤 SEND FIRST → ${recipient} | "${(data.content || '').substring(0, 50)}..."`);

          // ✅ محاولة 1
          const result = await this.channelsService.sendWhatsAppMessage(
            channel.id,
            recipient,
            data.content,
          );
          externalId = result?.messageId;

          // ✅ تحقق من الاستجابة
          if (!externalId) {
            this.logger.warn(`⚠️ Attempt 1: no messageId — retrying in 2s...`);
            await this.delay(2000);

            // ✅ محاولة 2
            const retry = await this.channelsService.sendWhatsAppMessage(
              channel.id,
              recipient,
              data.content,
            );
            externalId = retry?.messageId;
          }

          if (!externalId) {
            // ❌ فشل نهائي — واتساب ما أكّد
            sendStatus = MessageStatus.FAILED;
            errorMessage = 'WhatsApp returned no messageId after 2 attempts';
            this.logger.error(`❌ SEND FAILED: no messageId for ${recipient} — will save as FAILED`);
          } else {
            this.logger.log(`✅ WhatsApp CONFIRMED: messageId=${externalId} to=${recipient}`);
          }

        } catch (error) {
          // ✅ محاولة ثانية بعد خطأ
          this.logger.warn(`⚠️ Attempt 1 threw error — retrying in 2s... Error: ${error instanceof Error ? error.message : 'Unknown'}`);

          try {
            await this.delay(2000);
            const retry = await this.channelsService.sendWhatsAppMessage(
              channel.id,
              recipient,
              data.content,
            );
            externalId = retry?.messageId;

            if (externalId) {
              sendStatus = MessageStatus.SENT;
              this.logger.log(`✅ Retry SUCCEEDED: messageId=${externalId}`);
            } else {
              sendStatus = MessageStatus.FAILED;
              errorMessage = 'WhatsApp returned no messageId on retry';
              this.logger.error(`❌ Retry also failed — no messageId`);
            }
          } catch (retryError) {
            sendStatus = MessageStatus.FAILED;
            errorMessage = retryError instanceof Error ? retryError.message : 'Send failed after 2 attempts';
            this.logger.error(`❌ BOTH attempts failed: ${errorMessage}`);
          }
        }
      }
    } else {
      // قنوات أخرى — event
      this.eventEmitter.emit(`channel.${channel.type}.send`, {
        content: data.content,
        channel,
        conversation,
        recipient,
      });
    }

    // 4️⃣ ✅ الآن فقط نحفظ — بالحالة الصحيحة
    const message = this.messageRepo.create({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: data.type,
      status: sendStatus,
      sender: data.sender,
      content: data.content,
      media: data.media,
      externalId: externalId || undefined,
      sentAt: sendStatus === MessageStatus.SENT ? new Date() : undefined,
      errorMessage: errorMessage,
      metadata: {
        agentId: data.agentId,
        ...data.aiMetadata,
        interactive: data.interactive,
        template: data.template,
      },
    });

    const savedMessage = await this.messageRepo.save(message);

    // 5️⃣ تحديث المحادثة
    if (sendStatus === MessageStatus.SENT) {
      await this.conversationRepo.update(conversation.id, {
        lastMessageAt: new Date(),
      });
    }

    this.logger.log(`💾 Message saved: ${savedMessage.id} | status: ${sendStatus} | externalId: ${externalId || 'NONE'}`);

    return savedMessage;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 QUERY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  async getConversationMessages(
    conversationId: string,
    options: {
      page?: number;
      limit?: number;
      before?: Date;
      after?: Date;
    } = {},
  ): Promise<{ messages: Message[]; total: number }> {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 50, 100);
    const skip = (page - 1) * limit;

    const queryBuilder = this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId });

    if (options.before) {
      queryBuilder.andWhere('message.createdAt < :before', { before: options.before });
    }
    if (options.after) {
      queryBuilder.andWhere('message.createdAt > :after', { after: options.after });
    }

    const total = await queryBuilder.getCount();

    const messages = await queryBuilder
      .orderBy('message.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return { messages: messages.reverse(), total };
  }

  async searchMessages(filters: MessageFilters): Promise<{
    messages: Message[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const skip = (page - 1) * limit;

    const queryBuilder = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.conversation', 'conversation')
      .where('message.tenantId = :tenantId', { tenantId: filters.tenantId });

    if (filters.conversationId) {
      queryBuilder.andWhere('message.conversationId = :conversationId', {
        conversationId: filters.conversationId,
      });
    }

    if (filters.direction) {
      queryBuilder.andWhere('message.direction = :direction', {
        direction: filters.direction,
      });
    }

    if (filters.type) {
      queryBuilder.andWhere('message.type = :type', { type: filters.type });
    }

    if (filters.status) {
      queryBuilder.andWhere('message.status = :status', { status: filters.status });
    }

    if (filters.sender) {
      queryBuilder.andWhere('message.sender = :sender', { sender: filters.sender });
    }

    if (filters.startDate) {
      queryBuilder.andWhere('message.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      queryBuilder.andWhere('message.createdAt <= :endDate', {
        endDate: filters.endDate,
      });
    }

    if (filters.search) {
      queryBuilder.andWhere('message.content ILIKE :search', {
        search: `%${filters.search}%`,
      });
    }

    const total = await queryBuilder.getCount();

    const messages = await queryBuilder
      .orderBy('message.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      messages,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });
  }

  async getRecentMessages(
    conversationId: string,
    limit: number = 10,
  ): Promise<Message[]> {
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  async getMessageStats(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    total: number;
    inbound: number;
    outbound: number;
    byStatus: Record<string, number>;
    bySender: Record<string, number>;
    byType: Record<string, number>;
    avgResponseTime: number;
  }> {
    const directionStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.direction', 'direction')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.direction')
      .getRawMany();

    const statusStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.status')
      .getRawMany();

    const senderStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.sender', 'sender')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.sender')
      .getRawMany();

    const typeStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.type')
      .getRawMany();

    const avgResponseTime = await this.conversationRepo
      .createQueryBuilder('conversation')
      .select('AVG(EXTRACT(EPOCH FROM (conversation.firstResponseAt - conversation.createdAt)))', 'avg')
      .where('conversation.tenantId = :tenantId', { tenantId })
      .andWhere('conversation.firstResponseAt IS NOT NULL')
      .andWhere('conversation.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .getRawOne();

    const directionMap = directionStats.reduce((acc: Record<string, number>, item: any) => {
      acc[item.direction] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);

    return {
      total: (directionMap.inbound || 0) + (directionMap.outbound || 0),
      inbound: directionMap.inbound || 0,
      outbound: directionMap.outbound || 0,
      byStatus: statusStats.reduce((acc: Record<string, number>, item: any) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      bySender: senderStats.reduce((acc: Record<string, number>, item: any) => {
        acc[item.sender] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      byType: typeStats.reduce((acc: Record<string, number>, item: any) => {
        acc[item.type] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      avgResponseTime: parseFloat(avgResponseTime?.avg) || 0,
    };
  }
}
