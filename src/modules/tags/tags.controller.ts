/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tags Controller                                  ║
 * ║                                                                                ║
 * ║  📌 إدارة التصنيفات للمحادثات والعملاء                                          ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /tags              → قائمة التصنيفات                                   ║
 * ║  POST   /tags              → إنشاء تصنيف                                       ║
 * ║  GET    /tags/:id          → تفاصيل تصنيف                                      ║
 * ║  PUT    /tags/:id          → تحديث تصنيف                                       ║
 * ║  DELETE /tags/:id          → حذف تصنيف                                         ║
 * ║  GET    /tags/stats        → إحصائيات الاستخدام                                ║
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
    @CurrentUser() user: any,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    const tenantId = user.tenantId;
    return this.tagsService.findAll(tenantId, { type, search });
  }

  @Post()
  @ApiOperation({
    summary: 'إنشاء تصنيف',
    description: 'إنشاء تصنيف جديد',
  })
  async create(@CurrentUser() user: any,
    @Body() dto: CreateTagDto) {
    const tenantId = user.tenantId;
    return this.tagsService.create(tenantId, dto);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'إحصائيات الاستخدام',
    description: 'عدد المحادثات والعملاء لكل تصنيف',
  })
  async getStats(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.tagsService.getStats(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل تصنيف' })
  async findOne(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.tagsService.findById(id, tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'تحديث تصنيف' })
  async update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTagDto,
  ) {
    const tenantId = user.tenantId;
    return this.tagsService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف تصنيف' })
  async remove(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
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
  async createBulk(@CurrentUser() user: any,
    @Body() body: { tags: CreateTagDto[] }) {
    const tenantId = user.tenantId;
    return this.tagsService.createBulk(tenantId, body.tags);
  }

  @Delete('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'حذف تصنيفات متعددة',
    description: 'حذف عدة تصنيفات دفعة واحدة',
  })
  async deleteBulk(@CurrentUser() user: any,
    @Body() body: { ids: string[] }) {
    const tenantId = user.tenantId;
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
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body() body: { sourceId: string },
  ) {
    const tenantId = user.tenantId;
    return this.tagsService.mergeTags(targetId, body.sourceId, tenantId);
  }
}
