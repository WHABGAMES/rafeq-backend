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
import { ZidApiService, ZidStoreProfile } from './zid-api.service';

// DTOs
import { ConnectApiStoreDto } from './dto/connect-api-store.dto';

// Auth
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

// Entities
import { StorePlatform } from './entities/store.entity';
import { getErrorCode, getHttpErrorDetails } from '@common/utils/error.util';
import { asJsonRecord, getJsonNumber, getJsonString, getNestedJsonRecord } from '@common/utils/json-record.util';
import { assertPublicHttpsUrl, publicHttpsAgent } from '@common/utils/public-url.util';

type SallaStoreProfile = Awaited<ReturnType<SallaApiService['getStoreInfo']>>['data'];

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
    let storeInfo: SallaStoreProfile;
    try {
      const response = await this.sallaApiService.getStoreInfo(dto.apiKey);
      storeInfo = response.data;
    } catch (error: unknown) {
      const details = getHttpErrorDetails(error, 'Salla API key validation failed');
      this.logger.warn(`Invalid Salla API key`, {
        tenantId,
        error: details.message,
      });

      // رسائل خطأ واضحة حسب نوع الخطأ
      const status = details.status;
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
    let storeInfo: ZidStoreProfile;
    try {
      storeInfo = await this.zidApiService.getStoreInfo({ managerToken: dto.apiKey });
    } catch (error: unknown) {
      const details = getHttpErrorDetails(error, 'Zid API key validation failed');
      this.logger.warn(`Invalid Zid API key`, {
        tenantId,
        error: details.message,
      });

      const status = details.status;
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
    const requestedApiUrl = dto.apiBaseUrl.trim().replace(/\/+$/, '');
    let apiBaseUrl: string;

    // ✅ التحقق أن الرابط عام ومشفّر قبل إرسال المفتاح
    try {
      const safeUrl = await assertPublicHttpsUrl(requestedApiUrl);
      apiBaseUrl = safeUrl.toString().replace(/\/+$/, '');
    } catch {
      throw new BadRequestException('رابط API يجب أن يكون HTTPS عاماً ولا يشير إلى شبكة داخلية.');
    }

    // ✅ التحقق من صحة المفتاح بإرسال طلب تجريبي
    let validationResponse: unknown;
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
          maxRedirects: 0,
          httpsAgent: publicHttpsAgent,
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

      if (response.status >= 300 && response.status < 400) {
        throw new BadRequestException(
          'رابط API يعيد التوجيه. استخدم رابط HTTPS النهائي مباشرة لحماية مفتاح API.',
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

    } catch (error: unknown) {
      // إذا كان الخطأ BadRequestException من عندنا — نمررها كما هي
      if (error instanceof BadRequestException) {
        throw error;
      }

      const details = getHttpErrorDetails(error, 'Other platform API validation failed');
      const code = getErrorCode(error);
      this.logger.warn(`Failed to validate Other Platform API key`, {
        tenantId,
        platformName: dto.platformName,
        apiBaseUrl,
        error: details.message,
        code,
      });

      // أخطاء اتصال
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        throw new BadRequestException(
          'تعذر الاتصال بالمنصة. تأكد من صحة رابط API وأنه يعمل.',
        );
      }
      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
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

  private extractStoreInfo(data: unknown): {
    name?: string;
    url?: string;
    id?: string;
  } {
    // محاولة استخراج من بنى مختلفة (REST APIs شائعة)
    const root = asJsonRecord(data);
    const source = getNestedJsonRecord(root, 'data')
      ?? getNestedJsonRecord(root, 'store')
      ?? getNestedJsonRecord(root, 'shop')
      ?? getNestedJsonRecord(root, 'result')
      ?? root;
    const numericId = getJsonNumber(source, 'id', 'store_id');

    return {
      name: getJsonString(source, 'name', 'store_name', 'shop_name', 'title'),
      url: getJsonString(source, 'url', 'domain', 'shop_url', 'website'),
      id: getJsonString(source, 'id', 'store_id') ?? numericId?.toString(),
    };
  }
}
