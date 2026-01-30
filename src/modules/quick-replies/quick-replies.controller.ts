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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuickRepliesService } from './quick-replies.service';
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto';

@ApiTags('Quick Replies - الردود السريعة')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
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
  @ApiOperation({
    summary: 'فئات الردود',
    description: 'جلب جميع فئات الردود السريعة',
  })
  async getCategories(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.getCategories(tenantId);
  }

  @Post('categories')
  @ApiOperation({
    summary: 'إنشاء فئة',
    description: 'إنشاء فئة جديدة للردود السريعة',
  })
  async createCategory(@CurrentUser() user: any,
    @Body() body: { name: string; icon?: string }) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.createCategory(tenantId, body);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف فئة' })
  async deleteCategory(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.quickRepliesService.deleteCategory(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Quick Replies CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'قائمة الردود السريعة',
    description: 'جلب جميع الردود السريعة مع الفلترة',
  })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.findAll(tenantId, { category, search, page, limit });
  }

  @Get('search')
  @ApiOperation({
    summary: 'بحث في الردود',
    description: 'بحث سريع في الردود باستخدام الاختصار أو المحتوى',
  })
  @ApiQuery({ name: 'q', required: true, description: 'كلمة البحث أو الاختصار' })
  async search(@CurrentUser() user: any,
    @Query('q') query: string) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.search(tenantId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'إنشاء رد سريع',
    description: 'إنشاء رد سريع جديد',
  })
  async create(@CurrentUser() user: any,
    @Body() dto: CreateQuickReplyDto) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.quickRepliesService.create(tenantId, userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل رد سريع' })
  async findOne(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.findById(id, tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث رد سريع' })
  async update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuickReplyDto,
  ) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف رد سريع' })
  async remove(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.quickRepliesService.delete(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Usage & Stats
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/use')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تسجيل استخدام',
    description: 'تسجيل استخدام رد سريع (لتحسين الترتيب)',
  })
  async recordUsage(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.quickRepliesService.recordUsage(id, tenantId, userId);
  }

  @Get('stats/popular')
  @ApiOperation({
    summary: 'الردود الأكثر استخداماً',
    description: 'قائمة الردود السريعة الأكثر استخداماً',
  })
  async getPopular(@CurrentUser() user: any,
    @Query('limit') limit = 10) {
    const tenantId = user.tenantId;
    return this.quickRepliesService.getPopular(tenantId, limit);
  }
}
