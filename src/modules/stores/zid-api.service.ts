/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid API Service                                ║
 * ║                                                                                ║
 * ║  خدمة للتواصل مع API زد                                                         ║
 * ║  جلب الطلبات، العملاء، المنتجات، إلخ                                            ║
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

  /**
   * جلب الطلبات
   */
  async getOrders(
    accessToken: string,
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
          {
            headers: this.getHeaders(accessToken),
          },
        ),
      );

      this.logger.debug(`Fetched ${response.data.data?.length || 0} orders from Zid`);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid orders', {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * جلب طلب واحد
   */
  async getOrder(accessToken: string, orderId: number): Promise<ZidOrder> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/orders/${orderId}`,
          {
            headers: this.getHeaders(accessToken),
          },
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

  /**
   * جلب العملاء
   */
  async getCustomers(
    accessToken: string,
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
          {
            headers: this.getHeaders(accessToken),
          },
        ),
      );

      this.logger.debug(`Fetched ${response.data.data?.length || 0} customers from Zid`);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid customers', {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * جلب عميل واحد
   */
  async getCustomer(accessToken: string, customerId: number): Promise<ZidCustomer> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/customers/${customerId}`,
          {
            headers: this.getHeaders(accessToken),
          },
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
   * جلب المنتجات
   */
  async getProducts(
    accessToken: string,
    params: { page?: number; per_page?: number; status?: string } = {},
  ): Promise<ZidApiResponse<ZidProduct[]>> {
    try {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.per_page) queryParams.append('per_page', params.per_page.toString());
      if (params.status) queryParams.append('status', params.status);

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/products?${queryParams.toString()}`,
          {
            headers: this.getHeaders(accessToken),
          },
        ),
      );

      this.logger.debug(`Fetched ${response.data.data?.length || 0} products from Zid`);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid products', {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * جلب منتج واحد
   */
  async getProduct(accessToken: string, productId: number): Promise<ZidProduct> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.ZID_API_URL}/managers/store/products/${productId}`,
          {
            headers: this.getHeaders(accessToken),
          },
        ),
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch Zid product ${productId}`, {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ NEW: Store Info - للمزامنة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب معلومات المتجر للمزامنة
   */
  async getStoreInfo(accessToken: string): Promise<{
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
          `${this.ZID_API_URL}/managers/store/info`,
          {
            headers: this.getHeaders(accessToken),
          },
        ),
      );

      const storeData = response.data.data || response.data;

      return {
        id: storeData.id?.toString() || storeData.store_id?.toString(),
        uuid: storeData.uuid || storeData.id?.toString(),
        name: storeData.name || storeData.store_name,
        email: storeData.email || '',
        mobile: storeData.mobile || storeData.phone || '',
        url: storeData.url || storeData.domain || '',
        logo: storeData.logo || storeData.image,
        currency: storeData.currency || 'SAR',
        language: storeData.language || 'ar',
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid store info', {
        error: error?.response?.data || error.message,
      });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private getHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'ar',
    };
  }
}
