/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Inbox Service (Production v2)                    ║
 * ║                                                                                ║
 * ║  🔧 v2 Fixes:                                                                  ║
 * ║  - BUG-INB1: return { items, meta } → { conversations, total }                ║
 * ║  - BUG-INB2: إضافة getMessages endpoint مفقود                                  ║
 * ║  - BUG-INB3: إضافة sendMessage endpoint مفقود                                  ║
 * ║  - BUG-INB4: تحويل حقول Entity لصيغة Frontend                                 ║
 * ║  - BUG-INB5: تحميل آخر رسالة لكل محادثة (lastMessage)                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Conversation,
  ConversationStatus,
  ConversationPriority,
  ConversationHandler,
  Message,
  MessageStatus,
  MessageType,
  User,
  ChannelType,
} from '@database/entities';
import { MessageSender } from '@database/entities/message.entity';

// ✅ MessageService: لإرسال الرسائل من الـ inbox
import { MessageService } from '../messaging/services/message.service';

// Re-export for controller
export { ConversationStatus, ConversationPriority };

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface InboxFilters {
  status?: ConversationStatus;
  channel?: string;
  assignedTo?: string | null;
  priority?: ConversationPriority;
  tags?: string[];
  search?: string;
  unreadOnly?: boolean;
}

export interface InboxStats {
  total: number;
  unread: number;
  pending: number;
  assignedToMe: number;
  unassigned: number;
  avgResponseTime: number;
  avgResolutionTime: number;
}

/**
 * ✅ الشكل الذي تتوقعه الواجهة الأمامية
 */
export interface ConversationDto {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  channel: string;
  status: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  assignedTo?: string;
  tags: string[];
  aiHandled: boolean;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  content: string;
  sender: string;
  timestamp: string;
  read: boolean;
  attachments?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📬 INBOX SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,

    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    // ✅ BUG-INB3: لإرسال الرسائل من الـ inbox
    private readonly messageService: MessageService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 📋 قائمة المحادثات
  // ═══════════════════════════════════════════════════════════════════════════

  async getConversations(
    tenantId: string,
    filters: InboxFilters = {},
    pagination = { page: 1, limit: 20 },
  ): Promise<{ conversations: ConversationDto[]; total: number }> {
    const queryBuilder = this.conversationRepository
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.channel', 'channel')
      .leftJoinAndSelect('conv.assignedTo', 'agent')
      .where('conv.tenantId = :tenantId', { tenantId })
      // ✅ فلترة محادثات broadcast (status@broadcast)
      // NULL-safe: conversations without customerExternalId must still appear
      .andWhere("(conv.customerExternalId IS NULL OR conv.customerExternalId NOT LIKE :broadcast)", { broadcast: '%broadcast%' });

    if (filters.status) {
      queryBuilder.andWhere('conv.status = :status', {
        status: filters.status,
      });
    }

    if (filters.channel) {
      queryBuilder.andWhere('channel.type LIKE :channel', {
        channel: `%${filters.channel}%`,
      });
    }

    if (filters.assignedTo === null) {
      queryBuilder.andWhere('conv.assignedToId IS NULL');
    } else if (filters.assignedTo) {
      queryBuilder.andWhere('conv.assignedToId = :assignedTo', {
        assignedTo: filters.assignedTo,
      });
    }

    if (filters.priority) {
      queryBuilder.andWhere('conv.priority = :priority', {
        priority: filters.priority,
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      queryBuilder.andWhere('conv.tags && :tags', { tags: filters.tags });
    }

    if (filters.search) {
      queryBuilder.andWhere(
        '(conv.customerName ILIKE :search OR conv.customerPhone ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters.unreadOnly) {
      queryBuilder.andWhere('conv.messagesCount > 0');
    }

    const [items, total] = await queryBuilder
      .orderBy('conv.lastMessageAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit)
      .getManyAndCount();

    // ✅ BUG-INB5: تحميل آخر رسالة لكل محادثة
    const lastMessages = items.length > 0
      ? await this.getLastMessages(items.map(c => c.id))
      : {};

    // ✅ BUG-INB1 + BUG-INB4: تحويل لصيغة الواجهة
    const conversations: ConversationDto[] = items.map(conv => {
      // ✅ استخراج الرقم: أولاً من customerPhone المحفوظ، ثم من JID
      const phone = this.cleanPhoneDisplay(conv.customerPhone) || (this.isLidIdentifier(conv.customerExternalId) ? '' : this.cleanPhoneDisplay(conv.customerExternalId));
      const name = conv.customerName?.trim() || '';

      return {
        id: conv.id,
        customerId: conv.customerId || conv.customerExternalId || '',
        // ✅ الاسم للعرض: الاسم الحقيقي أو "عميل واتساب" كـ fallback
        customerName: name || 'عميل واتساب',
        // ✅ الرقم دائماً: يظهر تحت الاسم
        customerPhone: phone,
        channel: this.mapChannelType(conv.channel?.type),
        status: conv.status,
        lastMessage: lastMessages[conv.id] || '',
        lastMessageAt: (conv.lastMessageAt || conv.createdAt).toISOString(),
        unreadCount: conv.messagesCount || 0,
        assignedTo: conv.assignedToId,
        tags: conv.tags || [],
        aiHandled: conv.handler === ConversationHandler.AI,
      };
    });

    return { conversations, total };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 💬 رسائل محادثة معينة
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ✅ BUG-INB2: endpoint مفقود — الواجهة تستدعي GET /inbox/:id/messages
   */
  async getMessages(
    conversationId: string,
    tenantId: string,
    pagination = { page: 1, limit: 50 },
  ): Promise<{ messages: MessageDto[]; total: number }> {
    // التحقق من ملكية المحادثة
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, tenantId },
      select: ['id'],
    });

    if (!conversation) {
      throw new NotFoundException('المحادثة غير موجودة');
    }

    const [items, total] = await this.messageRepository.findAndCount({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    const messages: MessageDto[] = items.map(msg => this.mapMessage(msg));

    return { messages, total };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📤 إرسال رسالة من الـ inbox
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ✅ BUG-INB3: endpoint مفقود — الواجهة تستدعي POST /inbox/:id/messages
   * يُنشئ رسالة صادرة ويضعها في queue للإرسال عبر WhatsApp/Discord/...
   */
  async sendMessage(
    conversationId: string,
    content: string,
    userId: string,
    tenantId: string,
  ): Promise<MessageDto> {
    // التحقق من ملكية المحادثة
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      throw new NotFoundException('المحادثة غير موجودة');
    }

    // ✅ إرسال عبر MessageService (يحفظ + يضع في queue للإرسال الفعلي)
    const message = await this.messageService.createOutgoingMessage({
      conversationId,
      type: MessageType.TEXT,
      content,
      sender: MessageSender.AGENT,
      agentId: userId,
    });

    // تحديث آخر رسالة في المحادثة
    await this.conversationRepository.update(conversationId, {
      lastMessageAt: new Date(),
    });

    return this.mapMessage(message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 إحصائيات
  // ═══════════════════════════════════════════════════════════════════════════

  async getStats(tenantId: string, userId?: string): Promise<InboxStats> {
    const baseQuery = this.conversationRepository
      .createQueryBuilder('conv')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.status NOT IN (:...closedStatuses)', {
        closedStatuses: [ConversationStatus.CLOSED],
      });

    const [total, unread, pending, unassigned] = await Promise.all([
      baseQuery.clone().getCount(),
      baseQuery.clone().andWhere('conv.messagesCount > 0').getCount(),
      baseQuery
        .clone()
        .andWhere('conv.status = :pendingStatus', {
          pendingStatus: ConversationStatus.PENDING,
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('conv.assignedToId IS NULL')
        .getCount(),
    ]);

    let assignedToMe = 0;
    if (userId) {
      assignedToMe = await baseQuery
        .clone()
        .andWhere('conv.assignedToId = :userId', { userId })
        .getCount();
    }

    const avgResponseTime = 5;
    const avgResolutionTime = 30;

    return {
      total,
      unread,
      pending,
      assignedToMe,
      unassigned,
      avgResponseTime,
      avgResolutionTime,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📝 تفاصيل محادثة
  // ═══════════════════════════════════════════════════════════════════════════

  async getConversation(id: string, tenantId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id, tenantId },
      relations: ['channel', 'assignedTo'],
    });

    if (!conversation) {
      throw new NotFoundException('المحادثة غير موجودة');
    }

    const messages = await this.messageRepository.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
      take: 100,
    });

    // ✅ استخراج الرقم: أولاً من customerPhone المحفوظ، ثم من JID
    const detailPhone = this.cleanPhoneDisplay(conversation.customerPhone) || (this.isLidIdentifier(conversation.customerExternalId) ? '' : this.cleanPhoneDisplay(conversation.customerExternalId));
    const detailName = conversation.customerName?.trim() || '';

    return {
      ...conversation,
      // ✅ الاسم للعرض: الاسم الحقيقي أو "عميل واتساب" كـ fallback
      customerName: detailName || 'عميل واتساب',
      // ✅ الرقم دائماً: يظهر تحت الاسم
      customerPhone: detailPhone,
      customerExternalId: conversation.customerExternalId || '',
      messages: messages.map(m => this.mapMessage(m)),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 👥 إدارة المحادثات
  // ═══════════════════════════════════════════════════════════════════════════

  async assignToAgent(
    id: string,
    agentId: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const agent = await this.userRepository.findOne({
      where: { id: agentId, tenantId },
    });

    if (!agent) {
      throw new NotFoundException('الموظف غير موجود');
    }

    conversation.assignedToId = agentId;
    conversation.status = ConversationStatus.ASSIGNED;

    return this.conversationRepository.save(conversation);
  }

  async unassign(id: string, tenantId: string): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    conversation.assignedToId = undefined;
    conversation.status = ConversationStatus.PENDING;

    return this.conversationRepository.save(conversation);
  }

  async updateStatus(
    id: string,
    status: ConversationStatus,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    conversation.status = status;

    if (status === ConversationStatus.RESOLVED) {
      conversation.resolvedAt = new Date();
    }

    return this.conversationRepository.save(conversation);
  }

  async updatePriority(
    id: string,
    priority: ConversationPriority,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    conversation.priority = priority;

    return this.conversationRepository.save(conversation);
  }

  async addTags(
    id: string,
    tags: string[],
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const currentTags = conversation.tags || [];
    conversation.tags = [...new Set([...currentTags, ...tags])];

    return this.conversationRepository.save(conversation);
  }

  async removeTag(
    id: string,
    tag: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const currentTags = conversation.tags || [];
    conversation.tags = currentTags.filter((t) => t !== tag);

    return this.conversationRepository.save(conversation);
  }

  async addNote(
    id: string,
    note: string,
    userId: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const currentNotes = conversation.notes || '';
    const timestamp = new Date().toISOString();
    conversation.notes = currentNotes + `\n[${timestamp}] ${userId}: ${note}`;

    return this.conversationRepository.save(conversation);
  }

  async markAsRead(id: string, tenantId: string): Promise<void> {
    await this.conversationRepository.update(
      { id, tenantId },
      { messagesCount: 0 },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async getConversationById(
    id: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id, tenantId },
    });

    if (!conversation) {
      throw new NotFoundException('المحادثة غير موجودة');
    }

    return conversation;
  }

  /**
   * ✅ BUG-INB5: تحميل آخر رسالة لكل محادثة (batch)
   * يستخدم DISTINCT ON لـ PostgreSQL لجلب آخر رسالة لكل محادثة بكفاءة
   */
  private async getLastMessages(
    conversationIds: string[],
  ): Promise<Record<string, string>> {
    if (conversationIds.length === 0) return {};

    try {
      // استخدام raw query مع DISTINCT ON (PostgreSQL)
      const results = await this.messageRepository
        .createQueryBuilder('m')
        .select(['m.conversationId', 'm.content'])
        .where('m.conversationId IN (:...ids)', { ids: conversationIds })
        .orderBy('m.conversationId')
        .addOrderBy('m.createdAt', 'DESC')
        .distinctOn(['m.conversationId'])
        .getRawMany();

      const map: Record<string, string> = {};
      for (const row of results) {
        const convId = row.m_conversation_id || row.m_conversationId;
        const content = row.m_content;
        if (convId && content) {
          map[convId] = content.length > 100 ? content.slice(0, 100) + '...' : content;
        }
      }

      return map;
    } catch (error) {
      // fallback إذا فشل DISTINCT ON
      this.logger.warn('Failed to batch-load last messages, using fallback');

      const map: Record<string, string> = {};
      for (const id of conversationIds) {
        const msg = await this.messageRepository.findOne({
          where: { conversationId: id },
          order: { createdAt: 'DESC' },
          select: ['content'],
        });
        if (msg?.content) {
          map[id] = msg.content.length > 100
            ? msg.content.slice(0, 100) + '...'
            : msg.content;
        }
      }

      return map;
    }
  }

  /**
   * ✅ BUG-INB4: تحويل نوع القناة لاسم بسيط
   * 'whatsapp_official' → 'whatsapp'
   * 'whatsapp_qr'       → 'whatsapp'
   */
  private mapChannelType(type?: ChannelType | string): string {
    if (!type) return 'unknown';

    const map: Record<string, string> = {
      [ChannelType.WHATSAPP_OFFICIAL]: 'whatsapp',
      [ChannelType.WHATSAPP_QR]: 'whatsapp',
      [ChannelType.INSTAGRAM]: 'instagram',
      [ChannelType.DISCORD]: 'discord',
      [ChannelType.TELEGRAM]: 'telegram',
      [ChannelType.SMS]: 'sms',
      [ChannelType.EMAIL]: 'email',
    };

    return map[type] || type;
  }

  /**
   * ✅ BUG-INB4: تحويل Message entity لصيغة Frontend
   * Entity: { id, conversationId, content, sender, createdAt, status }
   * Frontend: { id, conversationId, content, sender, timestamp, read }
   */
  private mapMessage(msg: Message): MessageDto {
    return {
      id: msg.id,
      conversationId: msg.conversationId,
      content: msg.content || '',
      sender: msg.sender || 'system',
      timestamp: msg.createdAt.toISOString(),
      read: msg.status === MessageStatus.READ,
    };
  }

  /**
   * ✅ تنظيف عرض رقم الهاتف
   * يزيل @s.whatsapp.net, @c.us وأي suffix آخر
   * لا يعرض أرقام @lid لأنها معرّفات داخلية وليست أرقام هاتف حقيقية
   */
  private cleanPhoneDisplay(raw?: string | null): string {
    if (!raw) return '';
    // @lid = معرّف داخلي لواتساب وليس رقم هاتف حقيقي
    if (raw.includes('@lid')) return '';
    // إزالة أي suffix بعد @
    const digits = raw.split('@')[0].replace(/\D/g, '');
    if (!digits) return '';
    // إضافة + للأرقام الدولية
    return `+${digits}`;
  }

  /**
   * ✅ هل الـ customerExternalId هو @lid (معرّف داخلي لواتساب)؟
   * @lid = Linked Identity Device — ليس رقم هاتف حقيقي
   */
  private isLidIdentifier(externalId?: string | null): boolean {
    if (!externalId) return false;
    return externalId.includes('@lid');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🗑️ DELETE CONVERSATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * حذف محادثة مع جميع رسائلها نهائياً من قاعدة البيانات
   * الرسائل تُحذف تلقائياً بسبب ON DELETE CASCADE
   */
  async deleteConversation(tenantId: string, conversationId: string): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      throw new NotFoundException(`المحادثة غير موجودة: ${conversationId}`);
    }

    this.logger.log(`🗑️ Deleting conversation ${conversationId} with all messages`);

    // الرسائل تُحذف تلقائياً بسبب ON DELETE CASCADE في message entity
    await this.conversationRepository.remove(conversation);

    this.logger.log(`✅ Conversation ${conversationId} deleted successfully`);
  }
}
