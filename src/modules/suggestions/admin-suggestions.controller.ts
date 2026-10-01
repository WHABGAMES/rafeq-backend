/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Admin Suggestions Controller                     ║
 * ║                                                                                ║
 * ║  Admin moderation endpoints                                                    ║
 * ║                                                                                ║
 * ║  GET    /admin/suggestions/stats              → إحصائيات                       ║
 * ║  GET    /admin/suggestions                    → قائمة كاملة (مع هوية المرسل)  ║
 * ║  PATCH  /admin/suggestions/:id/status         → تغيير الحالة                   ║
 * ║  PATCH  /admin/suggestions/:id/pin            → تثبيت/إلغاء تثبيت             ║
 * ║  POST   /admin/suggestions/:id/reply          → رد رسمي                        ║
 * ║  POST   /admin/suggestions/merge              → دمج اقتراحات                   ║
 * ║  DELETE /admin/suggestions/:id                → حذف اقتراح                     ║
 * ║  DELETE /admin/suggestions/comments/:id       → حذف تعليق                      ║
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
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { AdminJwtGuard, AdminPermissionGuard, Require2FA, RequirePermissions } from '@modules/admin/guards/admin.guards';
import { CurrentAdmin } from '@modules/admin/decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '@modules/admin/entities/admin-user.entity';
import { SuggestionsService } from './suggestions.service';
import {
  AdminCreateCommentDto,
  UpdateSuggestionStatusDto,
  MergeSuggestionsDto,
  ListSuggestionsQueryDto,
} from './dto';

@ApiTags('Admin: الاقتراحات والمشاكل')
@Controller({
  path: 'admin/suggestions',
  version: '1',
})
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@ApiBearerAuth('Admin-JWT')
export class AdminSuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  // ═══════════════════════════════════════════════════════════
  // Stats
  // ═══════════════════════════════════════════════════════════

  @Get('stats')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_READ)
  @ApiOperation({ summary: 'إحصائيات الاقتراحات' })
  async getStats() {
    return this.suggestionsService.getStats();
  }

  // ═══════════════════════════════════════════════════════════
  // List (admin sees real identity)
  // ═══════════════════════════════════════════════════════════

  @Get()
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_READ)
  @ApiOperation({ summary: 'قائمة الاقتراحات (مع هوية المرسل)' })
  async list(@Query() query: ListSuggestionsQueryDto) {
    // ✅ Admin gets real identity — uses separate method
    return this.suggestionsService.listForAdmin(query);
  }

  // ═══════════════════════════════════════════════════════════
  // Status Change
  // ═══════════════════════════════════════════════════════════

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_MANAGE)
  @ApiOperation({ summary: 'تغيير حالة الاقتراح' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuggestionStatusDto,
  ) {
    return this.suggestionsService.updateStatus(id, dto);
  }

  // ═══════════════════════════════════════════════════════════
  // Pin / Unpin
  // ═══════════════════════════════════════════════════════════

  @Patch(':id/pin')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_MANAGE)
  @ApiOperation({ summary: 'تثبيت / إلغاء تثبيت' })
  async togglePin(@Param('id', ParseUUIDPipe) id: string) {
    return this.suggestionsService.togglePin(id);
  }

  // ═══════════════════════════════════════════════════════════
  // Official Reply
  // ═══════════════════════════════════════════════════════════

  @Post(':id/reply')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'رد رسمي من فريق رفيق' })
  async reply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @Body() dto: AdminCreateCommentDto,
  ) {
    return this.suggestionsService.addAdminComment(id, dto, {
      id: admin.id,
      firstName: admin.firstName,
      lastName: admin.lastName,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Merge
  // ═══════════════════════════════════════════════════════════

  @Post('merge')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'دمج اقتراحات مكررة' })
  async merge(@Body() dto: MergeSuggestionsDto) {
    return this.suggestionsService.merge(dto);
  }

  // ═══════════════════════════════════════════════════════════
  // Get Comments (admin view)
  // ═══════════════════════════════════════════════════════════

  @Get(':id/comments')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_READ)
  @ApiOperation({ summary: 'تعليقات الاقتراح' })
  async getComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.suggestionsService.getComments(id, Number(page) || 1, Number(limit) || 50, true);
  }

  // ═══════════════════════════════════════════════════════════
  // Delete Comment — ⚠️ MUST be before DELETE ':id' to avoid route shadowing
  // ═══════════════════════════════════════════════════════════

  @Delete('comments/:id')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_MANAGE)
  @Require2FA()
  @ApiOperation({ summary: 'حذف تعليق' })
  async deleteComment(@Param('id', ParseUUIDPipe) id: string) {
    return this.suggestionsService.deleteComment(id);
  }

  // ═══════════════════════════════════════════════════════════
  // Delete Suggestion
  // ═══════════════════════════════════════════════════════════

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SUGGESTIONS_MANAGE)
  @Require2FA()
  @ApiOperation({ summary: 'حذف اقتراح' })
  async deleteSuggestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.suggestionsService.deleteSuggestion(id);
  }
}
