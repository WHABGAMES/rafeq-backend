/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid API Service                                ║
 * ║                                                                                ║
 * ║  خدمة للتواصل مع API زد                                                         ║
 * ║  جلب الطلبات، العملاء، المنتجات، إلخ                                            ║
 * ║                                                                                ║
 * ║  ✅ FIX: زد API يحتاج headerين حسب الوثائق الرسمية:                             ║
 * ║     Authorization: Bearer {authorizationToken}  ← JWT من token response         ║
 * ║     X-Manager-Token: {managerToken}             ← access_token من token response║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  asJsonRecord,
  getJsonBoolean,
  getJsonNumber,
  getJsonRecordArray,
  getJsonString,
  getNestedJsonRecord,
  JsonRecord,
} from '@common/utils/json-record.util';
import { getErrorCode, getErrorMessage, getHttpErrorDetails } from '@common/utils/error.util';

/**
 * 📌 Zid API Documentation:
 * https://docs.zid.sa/
 * 
 * Base URL: https://api.zid.sa/v1
 */

/**
 * ✅ توكنات زد — يُمررون لكل API call
 * managerToken = access_token (encrypted blob) → X-Manager-Token header
 * authorizationToken = authorization (JWT) → Authorization: Bearer header
 */
export interface ZidAuthTokens {
  managerToken: string;
  authorizationToken?: string;
  storeId?: string; // Zid numeric store ID — required for Products endpoint
}

export interface ZidApiResponse<T> {
  status: string;
  message?: string;
  data: T;
  pagination?: {
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
  };
}

export interface ZidOrder {
  id: number;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string;
  currency: string;
  sub_total: number;
  shipping_cost: number;
  tax: number;
  total: number;
  customer: ZidCustomer;
  items: ZidOrderItem[];
  shipping_address?: ZidAddress;
  created_at: string;
  updated_at: string;
}

export interface ZidOrderItem {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  quantity: number;
  price: number;
  total: number;
  image?: string;
}

export interface ZidCustomer {
  id: number;
  name: string;
  email: string;
  mobile: string;
  city?: string;
  country?: string;
  orders_count?: number;
  total_spent?: number;
  created_at: string;
}

export interface ZidProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  sale_price?: number;
  quantity: number;
  status: string;
  images: string[];
  categories: { id: number; name: string }[];
  created_at: string;
}

export interface ZidAddress {
  city: string;
  street: string;
  district?: string;
  postal_code?: string;
  country: string;
}

export interface ZidStoreProfile {
  id: string;
  uuid: string;
  name: string;
  email: string;
  mobile: string;
  url: string;
  logo?: string;
  currency: string;
  language: string;
}

export interface ZidWebhook {
  id?: string | number;
  event?: string;
  target_url?: string;
  active?: boolean;
  status?: unknown;
}

interface ZidRequestOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  useProductHeaders?: boolean;
  timeoutMs?: number;
}

function normalizeWebhook(value: JsonRecord): ZidWebhook {
  const id = value.id;
  return {
    id: typeof id === 'string' || typeof id === 'number' ? id : undefined,
    event: getJsonString(value, 'event'),
    target_url: getJsonString(value, 'target_url'),
    active: getJsonBoolean(value, 'active'),
    status: value.status,
  };
}

export function parseZidStoreProfile(raw: unknown): ZidStoreProfile {
  const root = asJsonRecord(raw);
  const user = getNestedJsonRecord(root, 'user') ?? getNestedJsonRecord(root, 'data') ?? root;
  const storeData = getNestedJsonRecord(user, 'store') ?? user;
  if (!storeData) throw new Error('Zid store profile response is invalid');

  const rawCurrency = storeData.currency;
  const rawLanguage = storeData.language;
  const currencyRecord = asJsonRecord(rawCurrency);
  const languageRecord = asJsonRecord(rawLanguage);
  const id = getJsonString(storeData, 'id', 'store_id')
    ?? getJsonNumber(storeData, 'id', 'store_id')?.toString()
    ?? '';

  return {
    id,
    uuid: getJsonString(storeData, 'uuid') ?? id,
    name: getJsonString(storeData, 'name', 'store_name', 'title') ?? '',
    email: getJsonString(storeData, 'email') ?? getJsonString(user, 'email') ?? '',
    mobile: getJsonString(storeData, 'mobile', 'phone') ?? getJsonString(user, 'mobile') ?? '',
    url: getJsonString(storeData, 'url', 'domain') ?? '',
    logo: getJsonString(storeData, 'logo')?.substring(0, 490),
    currency: getJsonString(currencyRecord, 'code')
      ?? (typeof rawCurrency === 'string' ? rawCurrency : undefined)
      ?? 'SAR',
    language: getJsonString(languageRecord, 'code')
      ?? (typeof rawLanguage === 'string' ? rawLanguage : undefined)
      ?? 'ar',
  };
}

@Injectable()
export class ZidApiService {
  private readonly logger = new Logger(ZidApiService.name);
  private readonly ZID_API_URL = 'https://api.zid.sa/v1';

  constructor(private readonly httpService: HttpService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Orders
  // ═══════════════════════════════════════════════════════════════════════════════

  async getOrders(
    tokens: ZidAuthTokens,
    params: { page?: number; per_page?: number; status?: string } = {},
  ): Promise<ZidApiResponse<ZidOrder[]>> {
    const response = await this.callZidApi<ZidApiResponse<ZidOrder[]>>(
      'GET',
      '/managers/store/orders',
      tokens,
      { params },
      'get orders',
    );
    this.logger.debug(`Fetched ${response.data?.length || 0} orders from Zid`);
    return response;
  }

  async getOrder(tokens: ZidAuthTokens, orderId: number): Promise<ZidOrder> {
    const response = await this.callZidApi<{ data: ZidOrder }>(
      'GET',
      `/managers/store/orders/${orderId}`,
      tokens,
      {},
      `get order ${orderId}`,
    );
    return response.data;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👥 Customers
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCustomers(
    tokens: ZidAuthTokens,
    params: { page?: number; per_page?: number; search?: string } = {},
  ): Promise<ZidApiResponse<ZidCustomer[]>> {
    const response = await this.callZidApi<ZidApiResponse<ZidCustomer[]>>(
      'GET',
      '/managers/store/customers',
      tokens,
      { params },
      'get customers',
    );
    this.logger.debug(`Fetched ${response.data?.length || 0} customers from Zid`);
    return response;
  }

  async getCustomer(tokens: ZidAuthTokens, customerId: number): Promise<ZidCustomer> {
    const response = await this.callZidApi<{ data: ZidCustomer }>(
      'GET',
      `/managers/store/customers/${customerId}`,
      tokens,
      {},
      `get customer ${customerId}`,
    );
    return response.data;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛍️ Products
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🛍️ Products — حسب وثائق زد الرسمية:
   *   Endpoint: GET /v1/products/  (ليس /managers/store/products)
   *   Header:   Access-Token (الـ managerToken)  — ليس Authorization + X-Manager-Token
   *   Params:   page_size, page (ليس per_page)
   *   Response: { count, results: [...] }  (ليس { data: [...], pagination })
   *
   * زد يقولون: "we use Access-Token with Product component API endpoints for technical reasons"
   */
  async getProducts(
    tokens: ZidAuthTokens,
    params: { page?: number; per_page?: number; status?: string } = {},
  ): Promise<ZidApiResponse<ZidProduct[]>> {
    // Products API has a different response shape — handle normalization after the call
    const productParams: Record<string, unknown> = {};
    if (params.page) productParams['page'] = params.page;
    if (params.per_page) productParams['page_size'] = params.per_page;
    if (params.status) productParams['status'] = params.status;

    const raw = await this.callZidApi<{ count?: number; results?: ZidProduct[]; data?: ZidProduct[] }>(
      'GET',
      '/products/',
      tokens,
      { params: productParams, useProductHeaders: true },
      'get products',
    );

    // ✅ تحويل response shape من products API إلى الشكل الموحد
    const results = raw.results || raw.data || [];
    const count = raw.count ?? results.length;

    this.logger.debug(`Fetched ${results.length} products from Zid (total: ${count})`);

    return {
      data: results,
      pagination: {
        total: count,
        current_page: params.page || 1,
        per_page: params.per_page || results.length,
        last_page: params.per_page && params.per_page > 0 ? Math.ceil(count / params.per_page) : 1,
      },
    } as ZidApiResponse<ZidProduct[]>;
  }

  async getProduct(tokens: ZidAuthTokens, productId: number): Promise<ZidProduct> {
    const raw = await this.callZidApi<{ data?: ZidProduct } | ZidProduct>(
      'GET',
      `/products/${productId}`,
      tokens,
      { useProductHeaders: true },
      `get product ${productId}`,
    );
    return (raw as { data?: ZidProduct }).data || (raw as ZidProduct);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ Store Info - للمزامنة
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStoreInfo(tokens: ZidAuthTokens): Promise<ZidStoreProfile> {
    const raw = await this.callZidApi<unknown>(
      'GET',
      '/managers/account/profile',
      tokens,
      { timeoutMs: 2000 },  // ✅ PERF: 2s max — critical path must complete in <5s total
      'get store info',
    );

    return parseZidStoreProfile(raw);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Core HTTP Layer — CENTRALIZED
  //
  // Handles all Zid API calls with:
  //   - 401 "No such user" logging (requires Authorization + Access-Token headers)
  //   - Exponential backoff for transient errors (network, 5xx, 429)
  //   - Centralized logging with operation context
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Centralized Zid API call with retry logic
   * @private
   */
  private async callZidApi<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    tokens: ZidAuthTokens,
    options: ZidRequestOptions = {},
    operationName: string,
    retryCount = 0,
  ): Promise<T> {
    const maxRetries = 2;
    const headers = options.useProductHeaders
      ? this.getProductHeaders(tokens)
      : this.getManagerHeaders(tokens);

    this.logger.debug(`📤 Zid API: ${method} ${endpoint}`, {
      operation: operationName,
      hasAuthToken: !!tokens.authorizationToken,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.request<T>({
          method,
          url: `${this.ZID_API_URL}${endpoint}`,
          headers,
          params: options.params,
          data: options.body,
          // ✅ FIX: timeout per-request — prevents 30s hangs that cause Zid callback timeout
          timeout: options.timeoutMs ?? 8000,
        }),
      );

      this.logger.debug(`✅ Zid API: ${operationName} succeeded`);
      return response.data;

    } catch (error: unknown) {
      const details = getHttpErrorDetails(error, `Zid API ${operationName} failed`);
      const errorRecord = asJsonRecord(error);
      const responseData = getNestedJsonRecord(getNestedJsonRecord(errorRecord, 'response'), 'data');
      const status = details.status;
      const errorDetail = getJsonString(responseData, 'detail', 'message') ?? details.message;

      // ⚠️ Handle 401 "No such user" — يعني Authorization أو Store Token مفقود/خاطئ
      // حسب وثائق زد: يجب إرسال Authorization + X-Manager-Token/Access-Token معاً
      // لا نعيد المحاولة بدون authorizationToken لأن ذلك يجعل الأمر أسوأ
      if (status === 401 && errorDetail?.includes('No such user')) {
        this.logger.error(`❌ Zid 401 "No such user" on ${operationName} — missing/invalid Authorization token`, {
          hasAuthToken: !!tokens.authorizationToken,
          endpoint,
        });
      }

      // ✅ Handle transient errors (network/5xx/429) — retry with exponential backoff
      if (this.isRetryableError(error) && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 100; // 100ms, 200ms
        this.logger.warn(
          `⚠️ Zid API transient error on ${operationName} — retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`,
          { status, error: errorDetail },
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callZidApi<T>(method, endpoint, tokens, options, operationName, retryCount + 1);
      }

      this.logger.error(`❌ Zid API: ${operationName} failed`, {
        status,
        error: errorDetail,
        endpoint,
        hasAuthToken: !!tokens.authorizationToken,
      });
      throw error;
    }
  }

  /**
   * Build headers for /managers/* endpoints
   * Official Zid method: dual-header auth when authorizationToken is available
   * @private
   */
  private getManagerHeaders(tokens: ZidAuthTokens): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'ar',
    };

    if (tokens.authorizationToken) {
      // ✅ الطريقة الرسمية: headerين
      headers['Authorization'] = `Bearer ${tokens.authorizationToken}`;
      headers['X-Manager-Token'] = tokens.managerToken;
      headers['Role'] = 'Manager';
    } else {
      // Fallback: bearer فقط (ما يشتغل مع أغلب الـ endpoints)
      headers['Authorization'] = `Bearer ${tokens.managerToken}`;
      this.logger.warn('⚠️ Zid API call without authorizationToken — may fail');
    }

    // ✅ FIX: إرسال Store-Id في جميع الـ endpoints
    if (tokens.storeId) {
      headers['Store-Id'] = tokens.storeId;
    }

    return headers;
  }

  /**
   * Check if error is retryable (network/timeout/5xx/429)
   * @private
   */
  private isRetryableError(error: unknown): boolean {
    // Network errors
    const code = getErrorCode(error);
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return true;
    }

    const status = getHttpErrorDetails(error).status;
    if (!status) return false;

    // 5xx server errors
    if (status >= 500 && status < 600) return true;

    // 429 rate limit
    if (status === 429) return true;

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔔 Webhooks — تسجيل webhooks في زد
  //
  // POST /v1/managers/webhooks
  // Events: order.create, order.status.update, customer.create, etc.
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ v3: تسجيل webhooks في زد — حذف أولاً ثم إعادة تسجيل
   *
   * ⚠️ مشكلة مكتشفة: زد يعطّل الـ webhook بصمت (active=false, status=error/inactive)
   * إذا الـ endpoint رجع أخطاء متكررة (مثل 400).
   * زد ما عنده Update/Patch API — الحل الوحيد: حذف + إعادة إنشاء.
   *
   * الخطوات:
   * 1. حذف كل webhooks المسجلة بنفس الـ subscriber (تنظيف كامل)
   * 2. تسجيل webhooks جديدة (fresh = active=true)
   */
  async registerWebhooks(
    tokens: ZidAuthTokens,
    targetUrl: string,
    appId: string,
  ): Promise<{ registered: string[]; failed: string[] }> {
    const events = [
      // Order events
      'order.create',
      'order.status.update',
      'order.payment_status.update',
      
      // Customer events
      'customer.create',
      'customer.update',
      
      // Cart events
      'abandoned_cart.created',
      
      // ❌ REMOVED: product.create / product.update — Zid rate limiting is active on
      //   product endpoints (60 req/min). Webhook delivery failures under high product
      //   update frequency cause queue backlogs. Use polling/sync instead.
      // 'product.create',
      // 'product.update',
      
      // ❌ REMOVED: app.uninstalled — not a store-level webhook (registered via Partner Dashboard)
      // 'app.uninstalled',
    ];

    const registered: string[] = [];
    const failed: string[] = [];

    // ═══════════════════════════════════════════════════════════════════════════
    // الخطوة 1: حذف كل webhooks القديمة المرتبطة بالتطبيق
    // هذا يحل مشكلة الـ webhooks المعطّلة (inactive/error)
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      this.logger.log(`🧹 Cleaning up old Zid webhooks for original_id: ${appId}`);
      // ✅ FIX: Correct Zid API endpoint per official docs:
      //   DELETE /v1/managers/webhooks?original_id={appId}
      //   (NOT /managers/webhooks/subscribers/{appId} which returns 404)
      await firstValueFrom(
        this.httpService.delete(
          `${this.ZID_API_URL}/managers/webhooks`,
          {
            headers: this.getManagerHeaders(tokens),
            params: { original_id: appId },
          },
        ),
      );
      this.logger.log(`✅ Old Zid webhooks deleted for original_id: ${appId}`);
    } catch (deleteError: unknown) {
      const details = getHttpErrorDetails(deleteError, 'Failed to delete old Zid webhooks');
      const status = details.status;
      // 404 = ما فيه webhooks قديمة — عادي
      if (status === 404) {
        this.logger.log(`📋 No existing Zid webhooks to clean up (404)`);
      } else {
        this.logger.warn(`⚠️ Failed to delete old Zid webhooks (non-fatal)`, {
          status,
          error: details.message,
        });
      }
    }

    // تأخير قصير بعد الحذف لضمان الاتساق في نظام زد
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ═══════════════════════════════════════════════════════════════════════════
    // الخطوة 2: تسجيل webhooks جديدة (fresh = active=true)
    // ═══════════════════════════════════════════════════════════════════════════
    for (const event of events) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.ZID_API_URL}/managers/webhooks`,
            {
              event,
              target_url: targetUrl,
              original_id: appId,
              subscriber: appId,
            },
            { headers: this.getManagerHeaders(tokens) },
          ),
        );

        const responseRoot = asJsonRecord(response.data);
        const webhookData = getNestedJsonRecord(responseRoot, 'data') ?? responseRoot;
        const isActive = getJsonBoolean(webhookData, 'active');
        const webhookStatus = webhookData?.status;

        registered.push(event);
        this.logger.log(`✅ Zid webhook registered: ${event} → ${targetUrl}`, {
          active: isActive,
          status: typeof webhookStatus === 'object' ? JSON.stringify(webhookStatus) : webhookStatus,
          webhookId: webhookData?.id,
        });

        // ⚠️ تحذير إذا الـ webhook مسجّل لكن مو active
        if (isActive === false) {
          this.logger.error(`🚨 Zid webhook registered but NOT ACTIVE: ${event} — may need manual intervention`);
        }
      } catch (error: unknown) {
        const details = getHttpErrorDetails(error, 'Zid webhook registration failed');
        const errorRecord = asJsonRecord(error);
        const responseData = getNestedJsonRecord(getNestedJsonRecord(errorRecord, 'response'), 'data');
        const responseMessage = getNestedJsonRecord(responseData, 'message');
        const msg = getJsonString(responseMessage, 'description')
          ?? getJsonString(responseData, 'message')
          ?? details.message;
        const status = details.status;
        failed.push(event);
        this.logger.warn(`⚠️ Failed to register Zid webhook: ${event}`, {
          status,
          error: msg,
        });
      }
    }

    return { registered, failed };
  }

  /**
   * قائمة webhooks المسجلة — مع تشخيص حالة كل webhook
   */
  async listWebhooks(tokens: ZidAuthTokens): Promise<ZidWebhook[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/webhooks`,
          { headers: this.getManagerHeaders(tokens) },
        ),
      );
      const responseRoot = asJsonRecord(response.data);
      const webhooks = (getJsonRecordArray(responseRoot, 'data') ?? []).map(normalizeWebhook);

      // تشخيص: طباعة حالة كل webhook
      for (const wh of webhooks) {
        const statusStr = typeof wh.status === 'object' ? JSON.stringify(wh.status) : wh.status;
        if (wh.active === false) {
          this.logger.error(`🚨 INACTIVE webhook: ${wh.event} → ${wh.target_url} (active=${wh.active}, status=${statusStr})`);
        } else {
          this.logger.log(`✅ Active webhook: ${wh.event} → ${wh.target_url} (active=${wh.active}, status=${statusStr})`);
        }
      }

      return webhooks;
    } catch (error: unknown) {
      this.logger.error('Failed to list Zid webhooks', {
        error: getErrorMessage(error, 'Failed to list Zid webhooks'),
      });
      return [];
    }
  }

  /**
   * 🛍️ Headers خاصة بـ Products API
   * حسب وثائق زد: "we use Access-Token with Product component API endpoints for technical reasons"
   *
   * Products endpoints تستخدم:
   *   Access-Token: {managerToken}  (الـ encrypted blob)
   * بدل:
   *   Authorization + X-Manager-Token
   */
  private getProductHeaders(tokens: ZidAuthTokens): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'ar',
      'Access-Token': tokens.managerToken,
    };

    // ✅ حسب وثائق زد — Products API تحتاج Authorization + Access-Token معاً
    if (tokens.authorizationToken) {
      headers['Authorization'] = `Bearer ${tokens.authorizationToken}`;
    }

    // ✅ FIX: إرسال Store-Id header — حل لـ 401 "No such user"
    // وثائق زد: "Make sure to send the Store ID in the headers parameters correctly"
    if (tokens.storeId) {
      headers['Store-Id'] = tokens.storeId;
    }

    return headers;
  }
}
