/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Contacts Controller (CRM)                        ║
 * ║                                                                                ║
 * ║  📌 إدارة العملاء وبياناتهم                                                    ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /contacts              → قائمة العملاء                                 ║
 * ║  POST   /contacts              → إضافة عميل جديد                               ║
 * ║  GET    /contacts/:id          → تفاصيل عميل                                   ║
 * ║  PUT    /contacts/:id          → تحديث بيانات عميل                             ║
 * ║  DELETE /contacts/:id          → حذف عميل                                      ║
 * ║  GET    /contacts/:id/conversations → محادثات العميل                           ║
 * ║  GET    /contacts/:id/orders   → طلبات العميل                                  ║
 * ║  POST   /contacts/:id/tags     → إضافة تصنيفات                                 ║
 * ║  POST   /contacts/import       → استيراد عملاء                                 ║
 * ║  GET    /contacts/export       → تصدير عملاء                                   ║
 * ║  GET    /contacts/segments     → شرائح العملاء                                 ║
 * ║  POST   /contacts/segments     → إنشاء شريحة                                   ║
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
  Res,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  ParseBoolPipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { User } from '@database/entities';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { PlatformFeatureGuard } from '../platform-capabilities/platform-feature.guard';
import { RequirePlatformFeature } from '../platform-capabilities/platform-feature.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ContactsService } from './contacts.service';
import {
  CreateContactDto,
  UpdateContactDto,
  ContactFiltersDto,
  ImportContactsDto,
  CreateSegmentDto,
} from './dto';

/** The import service currently consumes only the original upload filename. */
interface UploadedContactFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
}

const CONTACT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const CONTACT_IMPORT_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function contactImportFileFilter(
  _request: unknown,
  file: UploadedContactFile,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const extensionAllowed = /\.(csv|xlsx)$/i.test(file.originalname || '');
  if (!extensionAllowed || !file.mimetype || !CONTACT_IMPORT_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('يسمح فقط بملفات CSV أو XLSX'), false);
    return;
  }
  callback(null, true);
}

@ApiTags('Contacts - إدارة العملاء (CRM)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PlatformFeatureGuard)
@RequirePlatformFeature('contacts')
@Controller({
  path: 'contacts',
  version: '1',
})
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /contacts - قائمة العملاء
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'قائمة العملاء',
    description: 'جلب جميع العملاء مع الفلترة والبحث',
  })
  @ApiQuery({ name: 'search', required: false, description: 'البحث بالاسم أو الهاتف أو الإيميل' })
  @ApiQuery({ name: 'segment', required: false, description: 'معرف الشريحة' })
  @ApiQuery({ name: 'tags', required: false, description: 'التصنيفات (مفصولة بفاصلة)' })
  @ApiQuery({ name: 'channel', required: false, description: 'القناة' })
  @ApiQuery({ name: 'hasOrders', required: false, type: Boolean })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'lastActivity', 'totalOrders', 'name'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'قائمة العملاء' })
  async findAll(
    @CurrentUser() user: User,
    @Query('search') search?: string,
    @Query('segment') segment?: string,
    @Query('tags') tags?: string,
    @Query('channel') channel?: string,
    @Query('hasOrders', new ParseBoolPipe({ optional: true })) hasOrders?: boolean,
    @Query('sortBy') sortBy = 'createdAt',
    @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'desc',
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const tenantId = user.tenantId;

    const filters: ContactFiltersDto = {
      search,
      segment,
      tags: tags?.split(','),
      channel,
      hasOrders,
      sortBy,
      sortOrder,
    };

    return this.contactsService.findAll(tenantId, filters, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /contacts/stats - إحصائيات العملاء
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('stats')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'إحصائيات العملاء',
    description: 'إحصائيات شاملة عن العملاء',
  })
  async getStats(@CurrentUser() user: User) {
    const tenantId = user.tenantId;
    return this.contactsService.getStats(tenantId);
  }

  @Post('sync')
  @RequirePlatformFeature('contacts.sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'مزامنة العملاء من سلة',
    description: 'جلب جميع العملاء من متجر سلة وحفظهم في قاعدة البيانات',
  })
  async syncCustomers(@CurrentUser() user: User) {
    const tenantId = user.tenantId;
    return this.contactsService.syncFromSalla(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Segments - شرائح العملاء
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('segments')
  @RequirePlatformFeature('contacts')
  @ApiOperation({
    summary: 'شرائح العملاء',
    description: 'جلب جميع شرائح العملاء',
  })
  async getSegments(@CurrentUser() user: User) {
    const tenantId = user.tenantId;
    return this.contactsService.getSegments(tenantId);
  }

  @Post('segments')
  @RequirePlatformFeature('contacts')
  @ApiOperation({
    summary: 'إنشاء شريحة',
    description: 'إنشاء شريحة عملاء جديدة بشروط محددة',
  })
  async createSegment(@CurrentUser() user: User,
    @Body() dto: CreateSegmentDto) {
    const tenantId = user.tenantId;
    return this.contactsService.createSegment(tenantId, dto);
  }

  @Get('segments/:id')
  @RequirePlatformFeature('contacts')
  @ApiOperation({ summary: 'تفاصيل شريحة' })
  async getSegment(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.contactsService.getSegmentById(id, tenantId);
  }

  @Put('segments/:id')
  @RequirePlatformFeature('contacts')
  @ApiOperation({ summary: 'تحديث شريحة' })
  async updateSegment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSegmentDto,
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.updateSegment(id, tenantId, dto);
  }

  @Delete('segments/:id')
  @RequirePlatformFeature('contacts')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف شريحة' })
  async deleteSegment(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.contactsService.deleteSegment(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Import/Export
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('import')
  @RequirePlatformFeature('contacts')
  @ApiOperation({
    summary: 'استيراد عملاء',
    description: 'استيراد عملاء من ملف CSV/Excel',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: CONTACT_IMPORT_MAX_BYTES, files: 1 },
    fileFilter: contactImportFileFilter,
  }))
  async importContacts(
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedContactFile,
    @Body() dto: ImportContactsDto,
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.importContacts(tenantId, file, dto);
  }

  @Get('export')
  @RequirePlatformFeature('contacts.export')
  @ApiOperation({
    summary: 'تصدير عملاء',
    description: 'تصدير العملاء إلى ملف CSV (يفتح في Excel مباشرة)',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  @ApiQuery({ name: 'segment', required: false })
  async exportContacts(
    @CurrentUser() user: User,
    @Res() res: Response,
    @Query('format') format = 'csv',
    @Query('segment') segment?: string,
  ) {
    const tenantId = user.tenantId;
    const csvContent = await this.contactsService.exportContacts(tenantId, format, segment);

    // ✅ إرسال كملف CSV مع BOM لدعم العربية في Excel
    const filename = encodeURIComponent(`عملاء-رفيق-${new Date().toISOString().slice(0, 10)}.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.send(csvContent);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /contacts - إضافة عميل جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post()
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'إضافة عميل جديد',
    description: 'إنشاء عميل جديد في النظام',
  })
  @ApiResponse({ status: 201, description: 'تم إنشاء العميل' })
  async create(@CurrentUser() user: User,
    @Body() dto: CreateContactDto) {
    const tenantId = user.tenantId;
    return this.contactsService.create(tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /contacts/:id - تفاصيل عميل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'تفاصيل عميل',
    description: 'جلب تفاصيل عميل معين مع سجل النشاطات',
  })
  async findOne(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.contactsService.findById(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PUT /contacts/:id - تحديث بيانات عميل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Put(':id')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'تحديث بيانات عميل',
    description: 'تحديث بيانات عميل معين',
  })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.update(id, tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE /contacts/:id - حذف عميل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Delete(':id')
  @RequirePlatformFeature('contacts.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'حذف عميل',
    description: 'حذف عميل من النظام',
  })
  async remove(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.contactsService.delete(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /contacts/:id/conversations - محادثات العميل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/conversations')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'محادثات العميل',
    description: 'جلب جميع محادثات عميل معين',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getConversations(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.getConversations(id, tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /contacts/:id/orders - طلبات العميل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/orders')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'طلبات العميل',
    description: 'جلب جميع طلبات عميل معين من سلة/زد',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getOrders(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.getOrders(id, tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /contacts/:id/timeline - سجل النشاطات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/timeline')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'سجل النشاطات',
    description: 'جميع نشاطات العميل (رسائل، طلبات، ملاحظات)',
  })
  async getTimeline(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.getTimeline(id, tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Tags Management
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/tags')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'إضافة تصنيفات',
    description: 'إضافة تصنيفات للعميل',
  })
  async addTags(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { tags: string[] },
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.addTags(id, tenantId, body.tags);
  }

  @Delete(':id/tags/:tag')
  @RequirePlatformFeature('contacts.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'إزالة تصنيف',
    description: 'إزالة تصنيف من العميل',
  })
  async removeTag(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tag') tag: string,
  ) {
    const tenantId = user.tenantId;
    await this.contactsService.removeTag(id, tenantId, tag);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Notes Management
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/notes')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({ summary: 'ملاحظات العميل' })
  async getNotes(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.contactsService.getNotes(id, tenantId);
  }

  @Post(':id/notes')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({ summary: 'إضافة ملاحظة' })
  async addNote(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { content: string },
  ) {
    const tenantId = user.tenantId;
    const userId = user.id;
    return this.contactsService.addNote(id, tenantId, userId, body.content);
  }

  @Delete(':id/notes/:noteId')
  @RequirePlatformFeature('contacts.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف ملاحظة' })
  async deleteNote(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    const tenantId = user.tenantId;
    await this.contactsService.deleteNote(id, tenantId, noteId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Merge Contacts
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/merge')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({
    summary: 'دمج عملاء',
    description: 'دمج عميلين في سجل واحد',
  })
  async mergeContacts(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) primaryId: string,
    @Body() body: { secondaryId: string },
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.mergeContacts(primaryId, body.secondaryId, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Block/Unblock Contact
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/block')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({ summary: 'حظر عميل' })
  async blockContact(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    const tenantId = user.tenantId;
    return this.contactsService.blockContact(id, tenantId, body.reason);
  }

  @Post(':id/unblock')
  @RequirePlatformFeature('contacts.manage')
  @ApiOperation({ summary: 'إلغاء حظر عميل' })
  async unblockContact(@CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    return this.contactsService.unblockContact(id, tenantId);
  }
}
