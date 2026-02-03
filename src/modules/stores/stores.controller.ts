/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Controller                          ║
 * ║                                                                                ║
 * ║  ✅ Fixed: Response transformation لمطابقة Frontend                           ║
 * ║  ✅ Fixed: إضافة endpoint للمزامنة                                             ║
 * ║  ✅ Fixed: Status mapping (active → connected)                                ║
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
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

// Services
import { StoresService } from './stores.service';

// DTOs
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';

// Auth
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

// Entities
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

interface RequestWithUser extends Request {
  user: User;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Response Transformer - تحويل البيانات لمطابقة Frontend
// ═══════════════════════════════════════════════════════════════════════════════

interface StoreResponse {
  id: string;
  name: string;
  platform: string;
  status: 'connected' | 'disconnected' | 'pending' | 'error';
  url: string | null;
  lastSync: string | null;
  createdAt: string;
  stats: {
    orders: number;
    products: number;
    customers: number;
  };
}

function transformStoreResponse(store: Store, stats?: { orders: number; products: number; customers: number }): StoreResponse {
  const statusMap: Record<string, 'connected' | 'disconnected' | 'pending' | 'error'> = {
    [StoreStatus.ACTIVE]: 'connected',
    [StoreStatus.PENDING]: 'pending',
    [StoreStatus.DISCONNECTED]: 'disconnected',
    [StoreStatus.TOKEN_EXPIRED]: 'error',
    [StoreStatus.SUSPENDED]: 'error',
    [StoreStatus.UNINSTALLED]: 'disconnected',
  };

  let url: string | null = null;
  if (store.platform === StorePlatform.SALLA) {
    url = store.sallaDomain || null;
  } else if (store.platform === StorePlatform.ZID) {
    url = store.zidDomain || null;
  }

  return {
    id: store.id,
    name: store.name || store.sallaStoreName || store.zidStoreName || 'متجر',
    platform: store.platform,
    status: statusMap[store.status] || 'disconnected',
    url,
    lastSync: store.lastSyncedAt ? store.lastSyncedAt.toISOString() : null,
    createdAt: store.createdAt.toISOString(),
    stats: stats || { orders: 0, products: 0, customers: 0 },
  };
}

@Controller('stores')
@ApiTags('Stores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class StoresController {
  private readonly logger = new Logger(StoresController.name);

  constructor(private readonly storesService: StoresService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ GET /stores - قائمة المتاجر (مع تحويل Response)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'قائمة المتاجر',
    description: 'جلب قائمة المتاجر المرتبطة بالحساب',
  })
  @ApiResponse({
    status: 200,
    description: 'قائمة المتاجر',
  })
  async listStores(@Request() req: RequestWithUser): Promise<StoreResponse[]> {
    this.logger.debug(`Fetching stores for tenant: ${req.user.tenantId}`);
    
    const stores = await this.storesService.findByTenant(req.user.tenantId);
    
    this.logger.debug(`Found ${stores.length} stores`);
    
    // ✅ جلب الإحصائيات الحقيقية لكل متجر مربوط
    const results: StoreResponse[] = [];
    for (const store of stores) {
      let stats = { orders: 0, products: 0, customers: 0 };
      if (store.status === StoreStatus.ACTIVE && store.accessToken) {
        try {
          stats = await this.storesService.getStoreStats(store);
        } catch (err) {
          this.logger.warn(`Failed to get stats for store ${store.id}: ${err}`);
        }
      }
      results.push(transformStoreResponse(store, stats));
    }
    
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ GET /stores/statistics - إحصائيات المتاجر
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('statistics')
  @ApiOperation({ summary: 'إحصائيات المتاجر' })
  async getStatistics(@Request() req: RequestWithUser) {
    return this.storesService.getStatistics(req.user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ GET /stores/:id - تفاصيل متجر (مع تحويل Response)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل متجر' })
  @ApiResponse({ status: 200, description: 'تفاصيل المتجر' })
  @ApiResponse({ status: 404, description: 'غير موجود' })
  async getStore(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StoreResponse> {
    const store = await this.storesService.findById(req.user.tenantId, id);
    
    let stats = { orders: 0, products: 0, customers: 0 };
    if (store.status === StoreStatus.ACTIVE && store.accessToken) {
      try {
        stats = await this.storesService.getStoreStats(store);
      } catch (err) {
        this.logger.warn(`Failed to get stats for store ${id}: ${err}`);
      }
    }
    
    return transformStoreResponse(store, stats);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ POST /stores/:id/sync - مزامنة المتجر (جديد!)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/sync')
  @ApiOperation({ 
    summary: 'مزامنة المتجر',
    description: 'تحديث بيانات المتجر من المنصة'
  })
  @ApiResponse({ status: 200, description: 'تمت المزامنة بنجاح' })
  @ApiResponse({ status: 404, description: 'المتجر غير موجود' })
  async syncStore(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StoreResponse> {
    this.logger.log(`Syncing store: ${id} for tenant: ${req.user.tenantId}`);
    
    const store = await this.storesService.syncStore(req.user.tenantId, id);
    
    // ✅ جلب الإحصائيات بعد المزامنة
    let stats = { orders: 0, products: 0, customers: 0 };
    try {
      stats = await this.storesService.getStoreStats(store);
    } catch (err) {
      this.logger.warn(`Failed to get stats after sync for store ${id}: ${err}`);
    }
    
    this.logger.log(`Store synced successfully: ${id}`, { stats });
    
    return transformStoreResponse(store, stats);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ PUT /stores/:id/settings - تحديث إعدادات المتجر
  // ═══════════════════════════════════════════════════════════════════════════════

  @Put(':id/settings')
  @ApiOperation({ summary: 'تحديث إعدادات المتجر' })
  @ApiResponse({ status: 200, description: 'تم التحديث' })
  async updateSettings(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreSettingsDto,
  ): Promise<StoreResponse> {
    const store = await this.storesService.updateSettings(req.user.tenantId, id, dto.settings);
    return transformStoreResponse(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ DELETE /stores/:id - فصل المتجر
  // ═══════════════════════════════════════════════════════════════════════════════

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'فصل المتجر' })
  @ApiResponse({ status: 204, description: 'تم الفصل' })
  async disconnectStore(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.logger.log(`Disconnecting store: ${id} for tenant: ${req.user.tenantId}`);
    
    await this.storesService.disconnectStore(req.user.tenantId, id);
    
    this.logger.log(`Store disconnected successfully: ${id}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ DELETE /stores/:id/permanent - حذف المتجر نهائياً
  // ═══════════════════════════════════════════════════════════════════════════════

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف المتجر نهائياً من قاعدة البيانات' })
  @ApiResponse({ status: 204, description: 'تم الحذف نهائياً' })
  @ApiResponse({ status: 404, description: 'المتجر غير موجود' })
  async deleteStorePermanently(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.logger.log(`Permanently deleting store: ${id} for tenant: ${req.user.tenantId}`);
    await this.storesService.deleteStorePermanently(req.user.tenantId, id);
    this.logger.log(`Store permanently deleted: ${id}`);
  }
}
