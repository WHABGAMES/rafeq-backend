/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Controller                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

// Services
import { StoresService } from './stores.service';

// DTOs
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';

@Controller('stores')
@ApiTags('Stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @ApiOperation({
    summary: 'قائمة المتاجر',
    description: 'جلب قائمة المتاجر المرتبطة بالحساب',
  })
  @ApiResponse({
    status: 200,
    description: 'قائمة المتاجر',
  })
  async listStores() {
    const tenantId = 'temp-tenant-id';
    return this.storesService.findByTenant(tenantId);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'إحصائيات المتاجر' })
  async getStatistics() {
    const tenantId = 'temp-tenant-id';
    return this.storesService.getStatistics(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل متجر' })
  @ApiResponse({ status: 200, description: 'تفاصيل المتجر' })
  @ApiResponse({ status: 404, description: 'غير موجود' })
  async getStore(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.storesService.findById(tenantId, id);
  }

  @Put(':id/settings')
  @ApiOperation({ summary: 'تحديث إعدادات المتجر' })
  @ApiResponse({ status: 200, description: 'تم التحديث' })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreSettingsDto,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.storesService.updateSettings(tenantId, id, dto.settings);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'فصل المتجر' })
  @ApiResponse({ status: 204, description: 'تم الفصل' })
  async disconnectStore(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = 'temp-tenant-id';
    await this.storesService.disconnectStore(tenantId, id);
  }
}
