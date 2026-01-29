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
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

// Services
import { StoresService } from './stores.service';

// DTOs
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';

// Auth
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

interface RequestWithUser extends Request {
  user: User;
}

@Controller('stores')
@ApiTags('Stores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
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
  async listStores(@Request() req: RequestWithUser) {
    return this.storesService.findByTenant(req.user.tenantId);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'إحصائيات المتاجر' })
  async getStatistics(@Request() req: RequestWithUser) {
    return this.storesService.getStatistics(req.user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل متجر' })
  @ApiResponse({ status: 200, description: 'تفاصيل المتجر' })
  @ApiResponse({ status: 404, description: 'غير موجود' })
  async getStore(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storesService.findById(req.user.tenantId, id);
  }

  @Put(':id/settings')
  @ApiOperation({ summary: 'تحديث إعدادات المتجر' })
  @ApiResponse({ status: 200, description: 'تم التحديث' })
  async updateSettings(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreSettingsDto,
  ) {
    return this.storesService.updateSettings(req.user.tenantId, id, dto.settings);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'فصل المتجر' })
  @ApiResponse({ status: 204, description: 'تم الفصل' })
  async disconnectStore(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.storesService.disconnectStore(req.user.tenantId, id);
  }
}
