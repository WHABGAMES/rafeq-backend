/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - API Connect Controller                         ║
 * ║                                                                                ║
 * ║  POST /api/stores/api/connect — ربط متجر عبر API Key                          ║
 * ║                                                                                ║
 * ║  ✅ يتحقق من صحة الـ API Key بإرسال طلب تجريبي للمنصة                        ║
 * ║  ✅ يشفّر المفاتيح قبل الحفظ                                                  ║
 * ║  ✅ يرجع نفس StoreResponse مثل OAuth                                          ║
 * ║  🆕 يدعم المتاجر الأخرى (other) عبر API عام                                  ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/api-connect.controller.ts                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// Services
import { StoresService } from './stores.service';
import { SallaApiService } from './salla-api.service';
import { ZidApiService } from './zid-api.service';

// DTOs
import { ConnectApiStoreDto } from './dto/connect-api-store.dto';

// Auth
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

// Entities
import { StorePlatform } from './entities/store.entity';

interface RequestWithUser extends Request {
  user: User;
}

@Controller('stores/api')
@ApiTags('Store API Connect')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ApiConnectController {
  private readonly logger = new Logger(ApiConnectController.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly sallaApiService: SallaApiService,
    private readonly zidApiService: ZidApiService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * POST /stores/api/connect
   * ربط متجر عبر API Key بدلاً من OAuth
   */
  @Post('connect')
  @ApiOperation({
    summary: 'ربط متجر عبر API',
    description: 'يربط متجر باستخدام API Key مباشرة بدلاً من OAuth — يدعم سلة، زد، ومنصات أخرى',
  })
  @ApiResponse({ status: 201, description: 'تم ربط المتجر بنجاح' })
  @ApiResponse({ status: 400, description: 'مفتاح API غير صالح' })
  @ApiResponse({ status: 409, description: 'المتجر مربوط مسبقاً' })
  async connectViaApi(
    @Request() req: RequestWithUser,
    @Body() dto: ConnectApiStoreDto,
  ) {
    const tenantId = req.user.tenantId;

    this.logger.log(`API connect attempt`, {
      tenantId,
      platform: dto.platform,
      hasApiKey: !!dto.apiKey,
      hasApiSecret: !!dto.apiSecret,
      platformName: dto.platformName || null,
    });

    // ═══════════════════════════════════════════════════════════════
    // ✅ الخطوة 1: التحقق من صحة الـ API Key بإرسال طلب تجريبي
    // ═══════════════════════════════════════════════════════════════

    if (dto.platform === StorePlatform.SALLA) {
      return this.connectSallaViaApi(tenantId, dto);
    } else if (dto.platform === StorePlatform.ZID) {
      return this.connectZidViaApi(tenantId, dto);
    } else if (dto.platform === StorePlatform.OTHER) {
      return this.connectOtherViaApi(tenantId, dto);
    } else {
      throw new BadRequestException('منصة غير مدعومة');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Salla API Connect
  // ═══════════════════════════════════════════════════════════════════════════════

  private async connectSallaViaApi(tenantId: string, dto: ConnectApiStoreDto) {
    this.logger.log(`Validating Salla API key for tenant: ${tenantId}`);

    // ✅ التحقق بإرسال طلب لـ Salla API
    let storeInfo: any;
    try {
      const response = await this.sallaApiService.getStoreInfo(dto.apiKey);
      storeInfo = response.data;
    } catch (error: any) {
      this.logger.warn(`Invalid Salla API key`, {
        tenantId,
        error: error?.message || error?.status,
      });

      // رسائل خطأ واضحة حسب نوع الخطأ
      const status = error?.status || error?.response?.status;
      if (status === 401 || status === 403) {
        throw new BadRequestException(
          'مفتاح الـ API غير صالح أو منتهي الصلاحية. تأكد من نسخه بشكل صحيح من لوحة تحكم سلة.',
        );
      }
      throw new BadRequestException(
        'فشل في التحقق من مفتاح الـ API. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.',
      );
    }

    // ✅ الخطوة 2: إنشاء المتجر عبر StoresService
    const store = await this.storesService.connectSallaStore(tenantId, {
      tokens: {
        accessToken: dto.apiKey,
        refreshToken: dto.apiSecret || '',
        expiresAt: dto.apiSecret
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // سنة إذا فيه secret
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),  // 14 يوم بدون secret
      },
      merchantInfo: {
        id: storeInfo.id,
        name: dto.name || storeInfo.name || storeInfo.username,
        username: storeInfo.username,
        email: storeInfo.email || '',
        mobile: storeInfo.mobile || '',
        domain: dto.url || storeInfo.domain || '',
        plan: storeInfo.plan || '',
        avatar: storeInfo.avatar,
      },
    });

    this.logger.log(`Salla store connected via API`, {
      storeId: store.id,
      tenantId,
      merchantId: storeInfo.id,
    });

    // ✅ إرجاع بنفس تنسيق StoreResponse
    return {
      id: store.id,
      name: store.name,
      platform: store.platform,
      status: 'connected',
      url: store.sallaDomain || dto.url || null,
      lastSync: store.lastSyncedAt?.toISOString() || null,
      createdAt: store.createdAt.toISOString(),
      stats: { orders: 0, products: 0, customers: 0 },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Zid API Connect
  // ═══════════════════════════════════════════════════════════════════════════════

  private async connectZidViaApi(tenantId: string, dto: ConnectApiStoreDto) {
    this.logger.log(`Validating Zid API key for tenant: ${tenantId}`);

    // ✅ التحقق بإرسال طلب لـ Zid API
    let storeInfo: any;
    try {
      storeInfo = await this.zidApiService.getStoreInfo({ managerToken: dto.apiKey });
    } catch (error: any) {
      this.logger.warn(`Invalid Zid API key`, {
        tenantId,
        error: error?.message || error?.status,
      });

      const status = error?.status || error?.response?.status;
      if (status === 401 || status === 403) {
        throw new BadRequestException(
          'مفتاح الـ API غير صالح أو منتهي الصلاحية. تأكد من نسخه بشكل صحيح من لوحة تحكم زد.',
        );
      }
      throw new BadRequestException(
        'فشل في التحقق من مفتاح الـ API. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.',
      );
    }

    // ✅ الخطوة 2: إنشاء المتجر
    const store = await this.storesService.connectZidStore(tenantId, {
      tokens: {
        accessToken: dto.apiKey,
        refreshToken: dto.apiSecret || '',
        expiresAt: dto.apiSecret
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      storeInfo: {
        id: storeInfo.id,
        uuid: storeInfo.uuid || storeInfo.id,
        name: dto.name || storeInfo.name,
        email: storeInfo.email || '',
        mobile: storeInfo.mobile || '',
        url: dto.url || storeInfo.url || '',
        logo: storeInfo.logo,
        currency: storeInfo.currency || 'SAR',
        language: storeInfo.language || 'ar',
        created_at: new Date().toISOString(),
      },
    });

    this.logger.log(`Zid store connected via API`, {
      storeId: store.id,
      tenantId,
      zidStoreId: storeInfo.id,
    });

    return {
      id: store.id,
      name: store.name,
      platform: store.platform,
      status: 'connected',
      url: store.zidDomain || dto.url || null,
      lastSync: store.lastSyncedAt?.toISOString() || null,
      createdAt: store.createdAt.toISOString(),
      stats: { orders: 0, products: 0, customers: 0 },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 Other Platform API Connect
  // ═══════════════════════════════════════════════════════════════════════════════

  private async connectOtherViaApi(tenantId: string, dto: ConnectApiStoreDto) {
    this.logger.log(`Validating Other Platform API key for tenant: ${tenantId}`, {
      platformName: dto.platformName,
      apiBaseUrl: dto.apiBaseUrl,
    });

    // ✅ Validation
    if (!dto.platformName?.trim()) {
      throw new BadRequestException('اسم المنصة مطلوب');
    }
    if (!dto.apiBaseUrl?.trim()) {
      throw new BadRequestException('رابط API مطلوب للتحقق من المفتاح');
    }

    // ✅ تنظيف رابط API
    const apiBaseUrl = dto.apiBaseUrl.trim().replace(/\/+$/, '');

    // ✅ التحقق أن الرابط URL صالح
    try {
      new URL(apiBaseUrl);
    } catch {
      throw new BadRequestException('رابط API غير صالح. يجب أن يبدأ بـ https://');
    }

    // ✅ التحقق من صحة المفتاح بإرسال طلب تجريبي
    let validationResponse: any = null;
    try {
      // نجرّب عدة أنماط شائعة لإرسال الـ API Key
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      // نجرّب Bearer token أولاً (الأكثر شيوعاً)
      headers['Authorization'] = `Bearer ${dto.apiKey}`;

      // بعض المنصات تستخدم X-API-Key
      headers['X-API-Key'] = dto.apiKey;

      const response = await firstValueFrom(
        this.httpService.get(apiBaseUrl, {
          headers,
          timeout: 15000,
          validateStatus: (status) => status < 500, // نقبل أي response غير 5xx
        }),
      );

      // ✅ نتحقق من الاستجابة
      if (response.status === 401 || response.status === 403) {
        throw new BadRequestException(
          'مفتاح الـ API غير صالح أو مرفوض. تأكد من صحة المفتاح والصلاحيات.',
        );
      }

      if (response.status === 404) {
        throw new BadRequestException(
          'رابط API غير موجود (404). تأكد من صحة الرابط.',
        );
      }

      if (response.status >= 400) {
        throw new BadRequestException(
          `المنصة ردّت بخطأ (${response.status}). تأكد من صحة الرابط والمفتاح.`,
        );
      }

      validationResponse = response.data;
      this.logger.log(`✅ Other platform API key validated successfully`, {
        status: response.status,
        platformName: dto.platformName,
      });

    } catch (error: any) {
      // إذا كان الخطأ BadRequestException من عندنا — نمررها كما هي
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.warn(`Failed to validate Other Platform API key`, {
        tenantId,
        platformName: dto.platformName,
        apiBaseUrl,
        error: error?.message || 'Unknown',
        code: error?.code,
      });

      // أخطاء اتصال
      if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
        throw new BadRequestException(
          'تعذر الاتصال بالمنصة. تأكد من صحة رابط API وأنه يعمل.',
        );
      }
      if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
        throw new BadRequestException(
          'انتهت مهلة الاتصال بالمنصة. حاول مرة أخرى أو تأكد من أن المنصة تعمل.',
        );
      }

      throw new BadRequestException(
        'فشل في التحقق من مفتاح الـ API. تأكد من الرابط والمفتاح وحاول مرة أخرى.',
      );
    }

    // ✅ محاولة استخراج معلومات المتجر من الاستجابة
    const extractedInfo = this.extractStoreInfo(validationResponse);

    // ✅ إنشاء المتجر
    const store = await this.storesService.connectOtherStore(tenantId, {
      tokens: {
        accessToken: dto.apiKey,
        refreshToken: dto.apiSecret || '',
        expiresAt: dto.apiSecret
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // سنة إذا فيه secret
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),  // 30 يوم بدون secret
      },
      storeInfo: {
        platformName: dto.platformName!.trim(),
        apiBaseUrl,
        name: dto.name?.trim() || extractedInfo.name || dto.platformName!.trim(),
        url: dto.url?.trim() || extractedInfo.url || '',
        storeId: extractedInfo.id || '',
      },
    });

    this.logger.log(`✅ Other platform store connected via API`, {
      storeId: store.id,
      tenantId,
      platformName: dto.platformName,
    });

    return {
      id: store.id,
      name: store.name,
      platform: store.platform,
      platformName: store.otherPlatformName,
      status: 'connected',
      url: store.otherStoreUrl || dto.url || null,
      lastSync: store.lastSyncedAt?.toISOString() || null,
      createdAt: store.createdAt.toISOString(),
      stats: { orders: 0, products: 0, customers: 0 },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 Helper: استخراج معلومات المتجر من استجابة API عامة
  // ═══════════════════════════════════════════════════════════════════════════════

  private extractStoreInfo(data: any): {
    name?: string;
    url?: string;
    id?: string;
  } {
    if (!data || typeof data !== 'object') {
      return {};
    }

    // محاولة استخراج من بنى مختلفة (REST APIs شائعة)
    const source = data.data || data.store || data.shop || data.result || data;

    return {
      name: source.name || source.store_name || source.shop_name || source.title || undefined,
      url: source.url || source.domain || source.shop_url || source.website || undefined,
      id: source.id ? String(source.id) : (source.store_id ? String(source.store_id) : undefined),
    };
  }
}
