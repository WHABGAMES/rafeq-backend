/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Admin Inbox Controller                            ║
 * ║                                                                                ║
 * ║  صندوق الرسائل للأدمن — محادثات رقم الواتساب الإداري فقط                      ║
 * ║                                                                                ║
 * ║  يعرض فقط المحادثات المربوطة برقم واتساب الأدمن المسجل                        ║
 * ║  في whatsapp_settings (phoneNumberId)                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions, Require2FA } from '../guards/admin.guards';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { WhatsappSettings } from '../entities/whatsapp-settings.entity';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';

import { Conversation, Message, ConversationStatus, Channel } from '@database/entities';
import { WhatsappSettingsService } from '../services/whatsapp-settings.service';
import { SendAdminMessageDto, UpdateAdminConversationStatusDto, UpdateAdminConversationTagsDto } from '../dto/admin-inbox.dto';

@ApiTags('Admin: صندوق الرسائل')
@Controller({ path: 'admin/inbox', version: '1' })
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@ApiBearerAuth('Admin-JWT')
export class AdminInboxController {
  private readonly logger = new Logger(AdminInboxController.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    @InjectRepository(WhatsappSettings)
    private readonly whatsappSettingsRepo: Repository<WhatsappSettings>,

    private readonly whatsappSettingsService: WhatsappSettingsService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 🔑 Helper: Get admin WhatsApp channel IDs
  // ═══════════════════════════════════════════════════════════════

  /**
   * يجلب IDs القنوات المربوطة برقم واتساب الأدمن
   * 1. يقرأ phoneNumberId من whatsapp_settings
   * 2. يبحث عن channels فيها نفس الـ phoneNumberId
   * 3. يرجع IDs هالقنوات
   */
  private async getAdminChannelIds(): Promise<string[]> {
    // 1. Get admin WhatsApp settings
    const settings = await this.whatsappSettingsRepo.findOne({
      where: { tenantId: IsNull(), isActive: true },
    });
    if (!settings || !settings.phoneNumberId) {
      this.logger.warn('Admin WhatsApp settings not found or phoneNumberId missing');
      return [];
    }

    // 2. القناة يجب أن تحمل علم الإدارة وأن تطابق الرقم المحفوظ معاً.
    const channels = await this.channelRepo.find({
      where: {
        isAdminChannel: true,
        whatsappPhoneNumberId: settings.phoneNumberId,
      },
      select: ['id'],
    });

    return channels.map(c => c.id);
  }

  private async requireAdminConversation(id: string): Promise<Conversation> {
    const adminChannelIds = await this.getAdminChannelIds();
    if (adminChannelIds.length === 0) throw new NotFoundException('المحادثة غير موجودة');
    const conversation = await this.conversationRepo
      .createQueryBuilder('conversation')
      .where('conversation.id = :id', { id })
      .andWhere('conversation.channelId IN (:...channelIds)', { channelIds: adminChannelIds })
      .getOne();
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    return conversation;
  }

  // ═══════════════════════════════════════════════════════════════
  // 📋 المحادثات — فقط رقم الأدمن
  // ═══════════════════════════════════════════════════════════════

  @Get()
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_READ)
  @ApiOperation({ summary: 'محادثات رقم واتساب الأدمن' })
  async getConversations(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 30,
  ) {
    // Get admin's channel IDs
    const adminChannelIds = await this.getAdminChannelIds();

    if (adminChannelIds.length === 0) {
      return { conversations: [], total: 0, page: 1, totalPages: 0 };
    }

    const qb = this.conversationRepo
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.channel', 'channel')
      .leftJoinAndSelect('conv.assignedTo', 'agent')
      // ✅ فقط محادثات رقم الأدمن
      .where('conv.channelId IN (:...channelIds)', { channelIds: adminChannelIds })
      .andWhere("(conv.customerExternalId IS NULL OR conv.customerExternalId NOT LIKE :broadcast)", { broadcast: '%broadcast%' });

    if (status && status !== 'all') {
      qb.andWhere('conv.status = :status', { status });
    }

    if (search) {
      qb.andWhere(
        '(conv.customerName ILIKE :search OR conv.customerPhone ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const p = Number(page) || 1;
    const l = Math.min(Number(limit) || 30, 50);

    const [items, total] = await qb
      .orderBy('conv.lastMessageAt', 'DESC')
      .addOrderBy('conv.id', 'DESC')
      .skip((p - 1) * l)
      .take(l)
      .getManyAndCount();

    // Load last message for each conversation
    const lastMsgs: Record<string, string> = {};
    if (items.length > 0) {
      const ids = items.map(c => c.id);
      const msgs = await this.messageRepo
        .createQueryBuilder('msg')
        .select(['msg.conversationId', 'msg.content'])
        .where('msg.conversationId IN (:...ids)', { ids })
        .orderBy('msg.createdAt', 'DESC')
        .getMany();

      const seen = new Set<string>();
      for (const m of msgs) {
        if (!seen.has(m.conversationId)) {
          lastMsgs[m.conversationId] = m.content?.substring(0, 100) || '';
          seen.add(m.conversationId);
        }
      }
    }

    const conversations = items.map(conv => ({
      id: conv.id,
      tenantId: conv.tenantId,
      customerName: conv.customerName || 'عميل',
      customerPhone: conv.customerPhone || '',
      channel: conv.channel?.type || 'whatsapp',
      status: conv.status,
      lastMessage: lastMsgs[conv.id] || '',
      lastMessageAt: (conv.lastMessageAt || conv.createdAt)?.toISOString() || '',
      unreadCount: conv.messagesCount || 0,
      assignedTo: conv.assignedToId || null,
      tags: conv.tags || [],
      createdAt: conv.createdAt?.toISOString() || '',
    }));

    return { conversations, total, page: p, totalPages: Math.ceil(total / l) };
  }

  // ═══════════════════════════════════════════════════════════════
  // 📊 إحصائيات — فقط رقم الأدمن
  // ═══════════════════════════════════════════════════════════════

  @Get('stats')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_READ)
  @ApiOperation({ summary: 'إحصائيات صندوق الرسائل' })
  async getStats() {
    const adminChannelIds = await this.getAdminChannelIds();
    if (adminChannelIds.length === 0) {
      return { total: 0, open: 0, pending: 0, closed: 0 };
    }

    const base = this.conversationRepo.createQueryBuilder('conv')
      .where('conv.channelId IN (:...channelIds)', { channelIds: adminChannelIds });

    const [total, open, pending, closed] = await Promise.all([
      base.clone().getCount(),
      base.clone().andWhere('conv.status = :s', { s: ConversationStatus.OPEN }).getCount(),
      base.clone().andWhere('conv.status = :s', { s: ConversationStatus.PENDING }).getCount(),
      base.clone().andWhere('conv.status = :s', { s: ConversationStatus.CLOSED }).getCount(),
    ]);

    return { total, open, pending, closed };
  }

  // ═══════════════════════════════════════════════════════════════
  // 💬 رسائل محادثة
  // ═══════════════════════════════════════════════════════════════

  @Get(':id/messages')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_READ)
  @ApiOperation({ summary: 'رسائل محادثة' })
  async getMessages(
    @Param('id') id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('before') before?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    await this.requireAdminConversation(id);
    const normalizedLimit = Math.min(Number(limit) || 50, 100);
    const query = this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId: id });

    if (before || beforeId) {
      if (!before || !beforeId) {
        throw new BadRequestException('before and beforeId must be provided together');
      }
      const beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new BadRequestException('Invalid message cursor');
      }
      query.andWhere(
        '(message.createdAt < :before OR (message.createdAt = :before AND message.id < :beforeId))',
        { before: beforeDate, beforeId },
      );
    }

    const [items, total] = await Promise.all([
      query
        .orderBy('message.createdAt', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .take(normalizedLimit)
        .getMany(),
      this.messageRepo.count({ where: { conversationId: id } }),
    ]);
    const oldest = items.at(-1);

    return {
      messages: items.reverse().map(message => ({
        id: message.id,
        conversationId: message.conversationId,
        content: message.content || '',
        sender: message.sender || 'system',
        timestamp: message.createdAt.toISOString(),
        read: message.status === 'read',
      })),
      total,
      nextCursor: items.length === normalizedLimit && oldest
        ? { before: oldest.createdAt.toISOString(), beforeId: oldest.id }
        : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 📤 إرسال رسالة
  // ═══════════════════════════════════════════════════════════════

  @Post(':id/messages')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إرسال رسالة من الأدمن عبر WhatsApp Admin Settings' })
  async sendMessage(
    @Param('id') id: string,
    @CurrentAdmin() _admin: AdminUser,
    @Body() body: SendAdminMessageDto,
  ) {
    const conv = await this.requireAdminConversation(id);

    if (!body.content?.trim()) {
      throw new BadRequestException('محتوى الرسالة مطلوب');
    }

    const recipientPhone = conv.customerPhone || conv.customerExternalId;
    if (!recipientPhone) {
      throw new BadRequestException('لا يوجد رقم هاتف للمستلم');
    }

    // ✅ الإرسال عبر Admin WhatsApp credentials (يفكّ التشفير تلقائياً)
    const result = await this.whatsappSettingsService.sendMessage(
      recipientPhone,
      body.content.trim(),
      { recipientUserId: undefined, triggerEvent: 'admin.manual' },
    );

    if (!result.success) {
      throw new BadRequestException('فشل إرسال الرسالة عبر واتساب — تأكد من إعدادات واتساب الإداري');
    }

    // ✅ الرسالة تُحفظ في createOrUpdateAdminConversation — نُرجعها للفرونتيند
    const msgId = result.savedMessageId;
    return {
      id: msgId || `sent-${Date.now()}`,
      conversationId: id,
      content: body.content.trim(),
      sender: 'agent',
      direction: 'outbound',
      status: 'sent',
      timestamp: new Date().toISOString(),
      read: true,
      messageLogId: result.messageLogId,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔄 تغيير حالة
  // ═══════════════════════════════════════════════════════════════

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_MANAGE)
  @ApiOperation({ summary: 'تغيير حالة المحادثة' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateAdminConversationStatusDto,
  ) {
    const conversation = await this.requireAdminConversation(id);
    conversation.status = body.status;
    if (body.status === ConversationStatus.RESOLVED) conversation.resolvedAt = new Date();
    return this.conversationRepo.save(conversation);
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ علامة مقروء
  // ═══════════════════════════════════════════════════════════════

  @Post(':id/read')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'علامة مقروء' })
  async markAsRead(@Param('id') id: string) {
    const conversation = await this.requireAdminConversation(id);
    conversation.messagesCount = 0;
    await this.conversationRepo.save(conversation);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🏷️ Tags / Flags
  // ═══════════════════════════════════════════════════════════════

  @Post(':id/tags')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تحديث tags المحادثة' })
  async updateTags(
    @Param('id') id: string,
    @Body() body: UpdateAdminConversationTagsDto,
  ) {
    const conversation = await this.requireAdminConversation(id);
    conversation.tags = [...new Set([...(conversation.tags || []), ...body.tags])];
    return this.conversationRepo.save(conversation);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🗑️ حذف محادثة
  // ═══════════════════════════════════════════════════════════════

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ADMIN_INBOX_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف محادثة نهائياً' })
  async deleteConversation(@Param('id') id: string) {
    const conversation = await this.requireAdminConversation(id);
    await this.conversationRepo.remove(conversation);
  }
}
