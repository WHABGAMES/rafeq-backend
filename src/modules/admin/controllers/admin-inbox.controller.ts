/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Admin Inbox Controller                            ║
 * ║                                                                                ║
 * ║  صندوق الرسائل للأدمن — يشوف محادثات كل التجار                               ║
 * ║                                                                                ║
 * ║  GET    /admin/inbox              → كل المحادثات (كل التجار)                   ║
 * ║  GET    /admin/inbox/stats        → إحصائيات عامة                              ║
 * ║  GET    /admin/inbox/:id/messages → رسائل محادثة                               ║
 * ║  POST   /admin/inbox/:id/messages → إرسال رسالة                                ║
 * ║  PATCH  /admin/inbox/:id/status   → تغيير حالة                                ║
 * ║  POST   /admin/inbox/:id/read     → علامة مقروء                                ║
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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AdminJwtGuard, AdminPermissionGuard } from '../guards/admin.guards';
import { CurrentAdmin } from '../decorators/current-admin.decorator';

import { Conversation, Message, ConversationStatus } from '@database/entities';
import { InboxService } from '@modules/inbox/inbox.service';

@ApiTags('Admin: صندوق الرسائل')
@Controller({ path: 'admin/inbox', version: '1' })
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@ApiBearerAuth('Admin-JWT')
export class AdminInboxController {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    private readonly inboxService: InboxService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 📋 كل المحادثات — بدون فلتر tenant
  // ═══════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'كل المحادثات (كل التجار)' })
  async getConversations(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 30,
  ) {
    const qb = this.conversationRepo
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.channel', 'channel')
      .leftJoinAndSelect('conv.assignedTo', 'agent')
      .andWhere("(conv.customerExternalId IS NULL OR conv.customerExternalId NOT LIKE :broadcast)", { broadcast: '%broadcast%' });

    // Optional: filter by tenant
    if (tenantId) {
      qb.andWhere('conv.tenantId = :tenantId', { tenantId });
    }

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
      assignedName: (conv as any).assignedTo?.firstName || null,
      createdAt: conv.createdAt?.toISOString() || '',
    }));

    return { conversations, total, page: p, totalPages: Math.ceil(total / l) };
  }

  // ═══════════════════════════════════════════════════════════════
  // 📊 إحصائيات عامة
  // ═══════════════════════════════════════════════════════════════

  @Get('stats')
  @ApiOperation({ summary: 'إحصائيات صندوق الرسائل' })
  async getStats() {
    const [total, open, pending, closed] = await Promise.all([
      this.conversationRepo.count(),
      this.conversationRepo.count({ where: { status: ConversationStatus.OPEN } }),
      this.conversationRepo.count({ where: { status: ConversationStatus.PENDING } }),
      this.conversationRepo.count({ where: { status: ConversationStatus.CLOSED } }),
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
  @ApiOperation({ summary: 'إرسال رسالة من الأدمن' })
  async sendMessage(
    @Param('id') id: string,
    @CurrentAdmin() admin: any,
    @Body() body: { content: string },
  ) {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');

    // Use InboxService with conversation's tenantId
    return this.inboxService.sendMessage(id, body.content, admin.id, conv.tenantId);
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
