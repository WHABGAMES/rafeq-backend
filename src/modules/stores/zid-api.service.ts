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
    try {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.per_page) queryParams.append('per_page', params.per_page.toString());
      if (params.status) queryParams.append('status', params.status);

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/orders?${queryParams.toString()}`,
          { headers: this.getHeaders(tokens) },
        ),
      );

      this.logger.debug(`Fetched ${response.data.data?.length || 0} orders from Zid`);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid orders', {
        error: error?.response?.data || error.message,
        status: error?.response?.status,
      });
      throw error;
    }
  }

  async getOrder(tokens: ZidAuthTokens, orderId: number): Promise<ZidOrder> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/orders/${orderId}`,
          { headers: this.getHeaders(tokens) },
        ),
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch Zid order ${orderId}`, {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👥 Customers
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCustomers(
    tokens: ZidAuthTokens,
    params: { page?: number; per_page?: number; search?: string } = {},
  ): Promise<ZidApiResponse<ZidCustomer[]>> {
    try {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.per_page) queryParams.append('per_page', params.per_page.toString());
      if (params.search) queryParams.append('search', params.search);

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/customers?${queryParams.toString()}`,
          { headers: this.getHeaders(tokens) },
        ),
      );

      this.logger.debug(`Fetched ${response.data.data?.length || 0} customers from Zid`);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid customers', {
        error: error?.response?.data || error.message,
        status: error?.response?.status,
      });
      throw error;
    }
  }

  async getCustomer(tokens: ZidAuthTokens, customerId: number): Promise<ZidCustomer> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/customers/${customerId}`,
          { headers: this.getHeaders(tokens) },
        ),
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch Zid customer ${customerId}`, {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
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
    try {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.per_page) queryParams.append('page_size', params.per_page.toString());
      if (params.status) queryParams.append('status', params.status);

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/products/?${queryParams.toString()}`,
          { headers: this.getProductHeaders(tokens) },
        ),
      );

      // ✅ تحويل response shape من products API إلى الشكل الموحد
      const raw = response.data;
      const results = raw.results || raw.data || [];
      const count = raw.count ?? results.length;

      this.logger.debug(`Fetched ${results.length} products from Zid (total: ${count})`);

      return {
        data: results,
        pagination: {
          total: count,
          current_page: params.page || 1,
          per_page: params.per_page || results.length,
        },
      } as ZidApiResponse<ZidProduct[]>;
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid products', {
        error: error?.response?.data || error.message,
        status: error?.response?.status,
      });
      throw error;
    }
  }

  async getProduct(tokens: ZidAuthTokens, productId: number): Promise<ZidProduct> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/products/${productId}`,
          { headers: this.getProductHeaders(tokens) },
        ),
      );

      return response.data.data || response.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch Zid product ${productId}`, {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
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
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/account/profile`,
          { headers: this.getHeaders(tokens) },
        ),
      );

      const raw = response.data;
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
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid store info', {
        error: error?.response?.data || error.message,
        status: error?.response?.status,
      });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers — حسب وثائق زد الرسمية
  //
  // Authorization: Bearer {authorizationToken}  ← JWT
  // X-Manager-Token: {managerToken}             ← access_token (encrypted blob)
  // ═══════════════════════════════════════════════════════════════════════════════

  private getHeaders(tokens: ZidAuthTokens): Record<string, string> {
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

    return headers;
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
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'ar',
      'Access-Token': tokens.managerToken,
    };
  }
}
