import { BadRequestException, Body, Controller, Logger, Post, Request, UseGuards } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { firstValueFrom } from 'rxjs';

import { asJsonRecord, getJsonNumber, getJsonString, getNestedJsonRecord } from '@common/utils/json-record.util';
import { getErrorCode, getHttpErrorDetails } from '@common/utils/error.util';
import { assertPublicHttpsUrl, publicHttpsAgent } from '@common/utils/public-url.util';
import { User } from '@database/entities';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConnectApiStoreDto } from './dto/connect-api-store.dto';
import { StoresService } from './stores.service';

interface RequestWithUser extends Request { user: User }

/** Custom platforms only. Salla and Zid must use their official flows. */
@Controller('stores/api')
@ApiTags('Store API Connect')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ApiConnectController {
  private readonly logger = new Logger(ApiConnectController.name);

  constructor(
    private readonly storesService: StoresService,
    private readonly httpService: HttpService,
  ) {}

  @Post('connect')
  @ApiOperation({ summary: 'ربط منصة خارجية مخصصة عبر API' })
  @ApiResponse({ status: 201, description: 'تم ربط المنصة بنجاح' })
  @ApiResponse({ status: 400, description: 'بيانات الربط غير صالحة' })
  async connectViaApi(@Request() req: RequestWithUser, @Body() dto: ConnectApiStoreDto) {
    const tenantId = req.user.tenantId;
    const platformName = dto.platformName?.trim();
    const requestedApiUrl = dto.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!platformName) throw new BadRequestException('اسم المنصة مطلوب');
    if (!requestedApiUrl) throw new BadRequestException('رابط API مطلوب للتحقق من المفتاح');

    let apiBaseUrl: string;
    try {
      apiBaseUrl = (await assertPublicHttpsUrl(requestedApiUrl)).toString().replace(/\/+$/, '');
    } catch {
      throw new BadRequestException('رابط API يجب أن يكون HTTPS عاماً ولا يشير إلى شبكة داخلية.');
    }

    const responseData = await this.validateCredential(tenantId, platformName, apiBaseUrl, dto.apiKey);
    const extracted = this.extractStoreInfo(responseData);
    const store = await this.storesService.connectOtherStore(tenantId, {
      tokens: {
        accessToken: dto.apiKey,
        refreshToken: dto.apiSecret || '',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      storeInfo: {
        platformName,
        apiBaseUrl,
        name: dto.name?.trim() || extracted.name || platformName,
        url: dto.url?.trim() || extracted.url || '',
        storeId: extracted.id || '',
      },
    });

    this.logger.log('Custom platform connected', { storeId: store.id, tenantId, platformName });
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

  private async validateCredential(
    tenantId: string,
    platformName: string,
    apiBaseUrl: string,
    apiKey: string,
  ): Promise<unknown> {
    try {
      const response = await firstValueFrom(this.httpService.get(apiBaseUrl, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey },
        timeout: 15_000,
        maxRedirects: 0,
        httpsAgent: publicHttpsAgent,
        validateStatus: status => status < 500,
      }));
      if (response.status === 401 || response.status === 403) {
        throw new BadRequestException('مفتاح الـ API غير صالح أو لا يملك الصلاحيات المطلوبة.');
      }
      if (response.status === 404) throw new BadRequestException('رابط API غير موجود (404).');
      if (response.status >= 300 && response.status < 400) {
        throw new BadRequestException('رابط API يعيد التوجيه. استخدم رابط HTTPS النهائي مباشرة.');
      }
      if (response.status >= 400) throw new BadRequestException(`المنصة ردّت بخطأ (${response.status}).`);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      const details = getHttpErrorDetails(error, 'Custom platform API validation failed');
      const code = getErrorCode(error);
      this.logger.warn('Custom platform API validation failed', {
        tenantId, platformName, apiBaseUrl, code, error: details.message,
      });
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        throw new BadRequestException('تعذر الاتصال بالمنصة. تأكد من صحة رابط API.');
      }
      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        throw new BadRequestException('انتهت مهلة الاتصال بالمنصة.');
      }
      throw new BadRequestException('فشل في التحقق من مفتاح الـ API.');
    }
  }

  private extractStoreInfo(data: unknown): { name?: string; url?: string; id?: string } {
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
