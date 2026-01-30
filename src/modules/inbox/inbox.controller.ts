/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Inbox Controller                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

import {
  InboxService,
  ConversationStatus,
  ConversationPriority,
  InboxFilters,
} from './inbox.service';

@ApiTags('Inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'inbox',
  version: '1',
})
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get()
  @ApiOperation({
    summary: 'قائمة المحادثات',
    description: 'جلب جميع المحادثات مع الفلترة والتصفح',
  })
  @ApiQuery({ name: 'status', required: false, enum: ConversationStatus })
  @ApiQuery({ name: 'channel', required: false })
  @ApiQuery({ name: 'assignedTo', required: false })
  @ApiQuery({ name: 'priority', required: false, enum: ConversationPriority })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getConversations(
    @CurrentUser() user: any,
    @Query('status') status?: ConversationStatus,
    @Query('channel') channel?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('priority') priority?: ConversationPriority,
    @Query('search') search?: string,
    @Query('unreadOnly') unreadOnly?: boolean,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    
    const filters: InboxFilters = {
      status,
      channel,
      assignedTo: assignedTo === 'null' ? null : assignedTo,
      priority,
      search,
      unreadOnly,
    };

    return this.inboxService.getConversations(tenantId, filters, {
      page,
      limit,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: 'إحصائيات الـ Inbox',
    description: 'إجماليات المحادثات وأوقات الرد',
  })
  async getStats(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.inboxService.getStats(tenantId, userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'تفاصيل محادثة',
    description: 'جلب محادثة مع الرسائل',
  })
  async getConversation(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    return this.inboxService.getConversation(id, tenantId);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تعيين المحادثة لموظف',
  })
  async assign(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { agentId: string },
  ) {
    const tenantId = user.tenantId;
    return this.inboxService.assignToAgent(id, body.agentId, tenantId);
  }

  @Post(':id/unassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إلغاء تعيين المحادثة',
  })
  async unassign(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    return this.inboxService.unassign(id, tenantId);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'تغيير حالة المحادثة',
  })
  async updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { status: ConversationStatus },
  ) {
    const tenantId = user.tenantId;
    return this.inboxService.updateStatus(id, body.status, tenantId);
  }

  @Patch(':id/priority')
  @ApiOperation({
    summary: 'تغيير أولوية المحادثة',
  })
  async updatePriority(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { priority: ConversationPriority },
  ) {
    const tenantId = user.tenantId;
    return this.inboxService.updatePriority(id, body.priority, tenantId);
  }

  @Post(':id/tags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إضافة tags للمحادثة',
  })
  async addTags(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { tags: string[] },
  ) {
    const tenantId = user.tenantId;
    return this.inboxService.addTags(id, body.tags, tenantId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'وضع علامة مقروء',
  })
  async markAsRead(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    await this.inboxService.markAsRead(id, tenantId);
  }

  @Post(':id/note')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إضافة ملاحظة داخلية',
  })
  async addNote(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.inboxService.addNote(id, body.note, userId, tenantId);
  }
}
