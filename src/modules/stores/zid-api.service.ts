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
    const productParams: Record<string, any> = {};
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

  async getStoreInfo(tokens: ZidAuthTokens): Promise<{
    id: string;
    uuid: string;
    name: string;
    email: string;
    mobile: string;
    url: string;
    logo?: string;
    currency: string;
    language: string;
  }> {
    const raw = await this.callZidApi<any>(
      'GET',
      '/managers/account/profile',
      tokens,
      {},
      'get store info',
    );

    const user = raw?.user || raw?.data || raw;
    const storeData = user?.store || user;

    const rawCurrency = storeData.currency;
    const rawLanguage = storeData.language;

    return {
      id: String(storeData.id || storeData.store_id || ''),
      uuid: String(storeData.uuid || storeData.id || ''),
      name: storeData.name || storeData.store_name || storeData.title || '',
      email: storeData.email || user?.email || '',
      mobile: storeData.mobile || storeData.phone || user?.mobile || '',
      url: storeData.url || storeData.domain || '',
      logo: typeof storeData.logo === 'string' ? storeData.logo.substring(0, 490) : undefined,
      currency: typeof rawCurrency === 'object' && rawCurrency !== null
        ? (rawCurrency.code || 'SAR') : (rawCurrency || 'SAR'),
      language: typeof rawLanguage === 'object' && rawLanguage !== null
        ? (rawLanguage.code || 'ar') : (rawLanguage || 'ar'),
    };
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
    options: {
      params?: Record<string, any>;
      body?: any;
      useProductHeaders?: boolean;
    } = {},
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
        }),
      );

      this.logger.debug(`✅ Zid API: ${operationName} succeeded`);
      return response.data;

    } catch (error: any) {
      const status = error?.response?.status;
      const errorDetail = error?.response?.data?.detail || error?.response?.data?.message;

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
  private isRetryableError(error: any): boolean {
    // Network errors
    if (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    ) {
      return true;
    }

    const status = error?.response?.status;
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
      
      // Product events
      'product.create',
      'product.update',
      
      // Cart events
      'abandoned_cart.created',
      
      // ❌ REMOVED: Zid doesn't support app.uninstalled webhook (returns 422 validation error)
      // 'app.uninstalled',
    ];

    const registered: string[] = [];
    const failed: string[] = [];

    // ═══════════════════════════════════════════════════════════════════════════
    // الخطوة 1: حذف كل webhooks القديمة المرتبطة بالتطبيق
    // هذا يحل مشكلة الـ webhooks المعطّلة (inactive/error)
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      this.logger.log(`🧹 Cleaning up old Zid webhooks for subscriber: ${appId}`);
      await firstValueFrom(
        this.httpService.delete(
          `${this.ZID_API_URL}/managers/webhooks/subscribers/${appId}`,
          { headers: this.getManagerHeaders(tokens) },
        ),
      );
      this.logger.log(`✅ Old Zid webhooks deleted for subscriber: ${appId}`);
    } catch (deleteError: any) {
      const status = deleteError?.response?.status;
      // 404 = ما فيه webhooks قديمة — عادي
      if (status === 404) {
        this.logger.log(`📋 No existing Zid webhooks to clean up (404)`);
      } else {
        this.logger.warn(`⚠️ Failed to delete old Zid webhooks (non-fatal)`, {
          status,
          error: deleteError?.response?.data?.message || deleteError.message,
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

        const webhookData = response.data?.data || response.data;
        const isActive = webhookData?.active;
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
      } catch (error: any) {
        const msg = error?.response?.data?.message?.description
          || error?.response?.data?.message
          || error.message;
        const status = error?.response?.status;
        failed.push(event);
        this.logger.warn(`⚠️ Failed to register Zid webhook: ${event}`, {
          status,
          error: msg,
          responseData: JSON.stringify(error?.response?.data || {}).slice(0, 200),
        });
      }
    }

    return { registered, failed };
  }

  /**
   * قائمة webhooks المسجلة — مع تشخيص حالة كل webhook
   */
  async listWebhooks(tokens: ZidAuthTokens): Promise<any[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/webhooks`,
          { headers: this.getManagerHeaders(tokens) },
        ),
      );
      const webhooks = response.data?.data || [];

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
    } catch (error: any) {
      this.logger.error('Failed to list Zid webhooks', {
        error: error?.response?.data || error.message,
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
