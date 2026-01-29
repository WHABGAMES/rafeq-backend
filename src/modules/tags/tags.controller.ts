/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tags Controller                                  ║
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
import { TagsService } from './tags.service';
import { CreateTagDto, UpdateTagDto } from './dto';

@ApiTags('Tags - التصنيفات')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'tags',
  version: '1',
})
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'قائمة التصنيفات',
    description: 'جلب جميع التصنيفات',
  })
  @ApiQuery({ name: 'type', required: false, enum: ['conversation', 'contact', 'all'] })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.findAll(tenantId, { type, search });
  }

  @Post()
  @ApiOperation({
    summary: 'إنشاء تصنيف',
    description: 'إنشاء تصنيف جديد',
  })
  async create(@Body() dto: CreateTagDto) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.create(tenantId, dto);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'إحصائيات الاستخدام',
    description: 'عدد المحادثات والعملاء لكل تصنيف',
  })
  async getStats() {
    const tenantId = 'test-tenant-id';
    return this.tagsService.getStats(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل تصنيف' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.findById(id, tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث تصنيف' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTagDto,
  ) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف تصنيف' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = 'test-tenant-id';
    await this.tagsService.delete(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Bulk Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('bulk')
  @ApiOperation({
    summary: 'إنشاء تصنيفات متعددة',
    description: 'إنشاء عدة تصنيفات دفعة واحدة',
  })
  async createBulk(@Body() body: { tags: CreateTagDto[] }) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.createBulk(tenantId, body.tags);
  }

  @Delete('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'حذف تصنيفات متعددة',
    description: 'حذف عدة تصنيفات دفعة واحدة',
  })
  async deleteBulk(@Body() body: { ids: string[] }) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.deleteBulk(tenantId, body.ids);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Merge Tags
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/merge')
  @ApiOperation({
    summary: 'دمج تصنيفات',
    description: 'دمج تصنيفين في واحد',
  })
  async mergeTags(
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body() body: { sourceId: string },
  ) {
    const tenantId = 'test-tenant-id';
    return this.tagsService.mergeTags(targetId, body.sourceId, tenantId);
  }
}
