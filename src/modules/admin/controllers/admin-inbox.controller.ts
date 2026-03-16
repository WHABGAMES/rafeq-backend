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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AdminJwtGuard, AdminPermissionGuard } from '../guards/admin.guards';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { WhatsappSettings } from '../entities/whatsapp-settings.entity';

import { Conversation, Message, ConversationStatus, Channel } from '@database/entities';
import { InboxService } from '@modules/inbox/inbox.service';
import { WhatsappSettingsService } from '../services/whatsapp-settings.service';

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

    private readonly inboxService: InboxService,
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
    const settings = await this.whatsappSettingsRepo.findOne({ where: {} });
    if (!settings || !settings.phoneNumberId) {
      this.logger.warn('Admin WhatsApp settings not found or phoneNumberId missing');
      return [];
    }

    // 2. Find channels with matching phoneNumberId
    const channels = await this.channelRepo.find({
      where: { whatsappPhoneNumberId: settings.phoneNumberId },
      select: ['id'],
    });

    return channels.map(c => c.id);
  }

  // ═══════════════════════════════════════════════════════════════
  // 📋 المحادثات — فقط رقم الأدمن
  // ═══════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'محادثات رقم واتساب الأدمن' })
  async getConversations(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 30,
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
  @ApiOperation({ summary: 'رسائل محادثة' })
  async getMessages(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

    return this.inboxService.getMessages(id, conv.tenantId, {
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 100),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 📤 إرسال رسالة
  // ═══════════════════════════════════════════════════════════════

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إرسال رسالة من الأدمن عبر WhatsApp Admin Settings' })
  async sendMessage(
    @Param('id') id: string,
    @CurrentAdmin() admin: any,
    @Body() body: { content: string },
  ) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

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

    // ✅ حفظ الرسالة في جدول messages ليظهر في المحادثة
    const now = new Date();
    await this.messageRepo.save(
      this.messageRepo.create({
        tenantId: conv.tenantId,
        conversationId: id,
        direction: 'outbound' as any,
        type: 'text' as any,
        status: 'sent' as any,
        sender: 'agent' as any,
        content: body.content.trim(),
        metadata: { sentBy: admin.id, sentByEmail: admin.email },
        deliveredAt: now,
      }),
    );

    // تحديث lastMessageAt في المحادثة
    await this.conversationRepo.update(id, {
      lastMessageAt: now,
      messagesCount: () => '"messages_count" + 1' as any,
    });

    return { success: true, messageLogId: result.messageLogId };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔄 تغيير حالة
  // ═══════════════════════════════════════════════════════════════

  @Patch(':id/status')
  @ApiOperation({ summary: 'تغيير حالة المحادثة' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

    return this.inboxService.updateStatus(id, body.status as ConversationStatus, conv.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ علامة مقروء
  // ═══════════════════════════════════════════════════════════════

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'علامة مقروء' })
  async markAsRead(@Param('id') id: string) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

    await this.inboxService.markAsRead(id, conv.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🏷️ Tags / Flags
  // ═══════════════════════════════════════════════════════════════

  @Post(':id/tags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تحديث tags المحادثة' })
  async updateTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
  ) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

    return this.inboxService.addTags(id, body.tags, conv.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🗑️ حذف محادثة
  // ═══════════════════════════════════════════════════════════════

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف محادثة نهائياً' })
  async deleteConversation(@Param('id') id: string) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

    await this.inboxService.deleteConversation(conv.tenantId, id);
  }
}
