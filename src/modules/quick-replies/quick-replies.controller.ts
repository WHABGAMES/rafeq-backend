/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Replies Controller                         ║
 * ║                                                                                ║
 * ║  📌 إدارة الردود السريعة والـ Canned Responses                                  ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /quick-replies              → قائمة الردود السريعة                     ║
 * ║  POST   /quick-replies              → إنشاء رد سريع                           ║
 * ║  GET    /quick-replies/:id          → تفاصيل رد سريع                          ║
 * ║  PUT    /quick-replies/:id          → تحديث رد سريع                           ║
 * ║  DELETE /quick-replies/:id          → حذف رد سريع                             ║
 * ║  GET    /quick-replies/search       → بحث في الردود                           ║
 * ║  GET    /quick-replies/categories   → فئات الردود                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { User } from '@database/entities';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuickRepliesService } from './quick-replies.service';
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto';
import { PlatformFeatureGuard } from '../platform-capabilities/platform-feature.guard';
import { RequirePlatformFeature } from '../platform-capabilities/platform-feature.decorator';

@ApiTags('Quick Replies - الردود السريعة')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PlatformFeatureGuard)
@RequirePlatformFeature('quick_replies')
@Controller({
  path: 'quick-replies',
  version: '1',
})
export class QuickRepliesController {
  constructor(private readonly quickRepliesService: QuickRepliesService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Categories
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('categories')
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({
    summary: 'فئات الردود',
    description: 'جلب جميع فئات الردود السريعة',
  })
  async getCategories(@CurrentUser() user: User) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.getCategories(tenantId);
  }

  @Post('categories')
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({
    summary: 'إنشاء فئة',
    description: 'إنشاء فئة جديدة للردود السريعة',
  })
  async createCategory(@CurrentUser() user: User,
    @Body() body: { name: string; icon?: string }) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.createCategory(tenantId, body);
  }

  @Delete('categories/:id')
  @RequirePlatformFeature('quick_replies')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف فئة' })
  async deleteCategory(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.quickRepliesService.deleteCategory(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Quick Replies CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({
    summary: 'قائمة الردود السريعة',
    description: 'جلب جميع الردود السريعة مع الفلترة',
  })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: User,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.findAll(tenantId, { category, search, page, limit });
  }

  @Get('search')
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({
    summary: 'بحث في الردود',
    description: 'بحث سريع في الردود باستخدام الاختصار أو المحتوى',
  })
  @ApiQuery({ name: 'q', required: true, description: 'كلمة البحث أو الاختصار' })
  async search(@CurrentUser() user: User,
    @Query('q') query: string) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.search(tenantId, query);
  }

  @Post()
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({
    summary: 'إنشاء رد سريع',
    description: 'إنشاء رد سريع جديد',
  })
  async create(@CurrentUser() user: User,
    @Body() dto: CreateQuickReplyDto) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.quickRepliesService.create(tenantId, userId, dto);
  }

  @Get(':id')
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({ summary: 'تفاصيل رد سريع' })
  async findOne(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.findById(id, tenantId);
  }

  @Put(':id')
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({ summary: 'تحديث رد سريع' })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuickReplyDto,
  ) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @RequirePlatformFeature('quick_replies')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف رد سريع' })
  async remove(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.quickRepliesService.delete(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Usage & Stats
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/use')
  @RequirePlatformFeature('quick_replies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تسجيل استخدام',
    description: 'تسجيل استخدام رد سريع (لتحسين الترتيب)',
  })
  async recordUsage(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.quickRepliesService.recordUsage(id, tenantId, userId);
  }

  @Get('stats/popular')
  @RequirePlatformFeature('quick_replies')
  @ApiOperation({
    summary: 'الردود الأكثر استخداماً',
    description: 'قائمة الردود السريعة الأكثر استخداماً',
  })
  async getPopular(@CurrentUser() user: User,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.getPopular(tenantId, limit);
  }
}
