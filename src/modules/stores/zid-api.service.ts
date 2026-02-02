/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid API Service                                ║
 * ║                                                                                ║
 * ║  ✅ Fixed: إضافة getStoreInfo method للمزامنة                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export interface ZidApiResponse<T> {
  status: string;
  data: T;
}

export interface ZidStoreInfo {
  id: string;
  uuid: string;
  name: string;
  email: string;
  mobile: string;
  url: string;
  logo: string;
  currency: string;
  language: string;
}

export interface ZidOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total: { amount: number; currency: string };
  customer: ZidCustomer;
  items: ZidOrderItem[];
  created_at: string;
}

export interface ZidCustomer {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface ZidOrderItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  price: number;
}

export interface ZidProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  status: string;
}

@Injectable()
export class ZidApiService {
  private readonly logger = new Logger(ZidApiService.name);
  private readonly BASE_URL = 'https://api.zid.sa/v1';

  constructor(private readonly httpService: HttpService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ NEW: getStoreInfo - جلب معلومات المتجر للمزامنة
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStoreInfo(accessToken: string): Promise<ZidStoreInfo> {
    this.logger.debug('Fetching store info from Zid');

    try {
      const response = await this.makeRequest<{ store: ZidStoreInfo }>(
        accessToken,
        'GET',
        '/store/info',
      );

      const storeInfo = response.data?.store || response.data;

      this.logger.debug(`Zid store info retrieved: ${storeInfo.name}`);

      return {
        id: storeInfo.id,
        uuid: storeInfo.uuid,
        name: storeInfo.name,
        email: storeInfo.email,
        mobile: storeInfo.mobile,
        url: storeInfo.url,
        logo: storeInfo.logo,
        currency: storeInfo.currency,
        language: storeInfo.language,
      };

    } catch (error: any) {
      this.logger.error('Failed to fetch Zid store info', error);
      throw new Error(`فشل في جلب بيانات المتجر: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Orders API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getOrders(
    accessToken: string,
    options?: { page?: number; limit?: number; status?: string },
  ): Promise<ZidApiResponse<ZidOrder[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.status) params.append('status', options.status);

    return this.makeRequest<ZidOrder[]>(accessToken, 'GET', `/orders?${params.toString()}`);
  }

  async getOrder(accessToken: string, orderId: string): Promise<ZidApiResponse<ZidOrder>> {
    return this.makeRequest<ZidOrder>(accessToken, 'GET', `/orders/${orderId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customers API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCustomers(
    accessToken: string,
    options?: { page?: number; limit?: number },
  ): Promise<ZidApiResponse<ZidCustomer[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());

    return this.makeRequest<ZidCustomer[]>(accessToken, 'GET', `/customers?${params.toString()}`);
  }

  async getCustomer(accessToken: string, customerId: string): Promise<ZidApiResponse<ZidCustomer>> {
    return this.makeRequest<ZidCustomer>(accessToken, 'GET', `/customers/${customerId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Products API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getProducts(
    accessToken: string,
    options?: { page?: number; limit?: number },
  ): Promise<ZidApiResponse<ZidProduct[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());

    return this.makeRequest<ZidProduct[]>(accessToken, 'GET', `/products?${params.toString()}`);
  }

  async getProduct(accessToken: string, productId: string): Promise<ZidApiResponse<ZidProduct>> {
    return this.makeRequest<ZidProduct>(accessToken, 'GET', `/products/${productId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private async makeRequest<T>(
    accessToken: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: Record<string, unknown>,
  ): Promise<ZidApiResponse<T>> {
    const url = `${this.BASE_URL}${endpoint}`;

    this.logger.debug(`Zid API ${method} ${endpoint}`);

    try {
      const response = await firstValueFrom(
        this.httpService.request({
          method,
          url,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          data,
        }),
      );

      return response.data;

    } catch (error: any) {
      this.logger.error(`Zid API Error: ${method} ${endpoint}`, {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });

      throw {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
        endpoint,
      };
    }
  }
}
