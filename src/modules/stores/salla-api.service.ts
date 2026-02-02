/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla API Service                              ║
 * ║                                                                                ║
 * ║  ✅ Fixed: إضافة getMerchantInfo method للمزامنة                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// ✅ Import from salla-oauth.service.ts to avoid duplicate definitions
import { SallaMerchantInfo } from './salla-oauth.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export interface SallaApiResponse<T> {
  status: number;
  success: boolean;
  data: T;
  pagination?: {
    count: number;
    total: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
  };
}

export interface SallaOrder {
  id: number;
  reference_id: string;
  date: { date: string; timestamp: number };
  status: { id: number; name: string; slug: string };
  payment: { status: string; method: { id: number; name: string } };
  amounts: {
    sub_total: { amount: number; currency: string };
    total: { amount: number; currency: string };
  };
  customer: SallaCustomer;
  items: SallaOrderItem[];
}

export interface SallaCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  mobile_code: string;
}

export interface SallaOrderItem {
  id: number;
  name: string;
  sku: string;
  quantity: number;
  price: { amount: number; currency: string };
}

export interface SallaProduct {
  id: number;
  name: string;
  sku: string;
  price: { amount: number; currency: string };
  quantity: number;
  status: string;
}

@Injectable()
export class SallaApiService {
  private readonly logger = new Logger(SallaApiService.name);
  private readonly BASE_URL = 'https://api.salla.dev/admin/v2';

  constructor(private readonly httpService: HttpService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ NEW: getMerchantInfo - جلب معلومات التاجر للمزامنة
  // ═══════════════════════════════════════════════════════════════════════════════

  async getMerchantInfo(accessToken: string): Promise<SallaMerchantInfo> {
    this.logger.debug('Fetching merchant info from Salla');

    try {
      const response = await this.makeRequest<SallaMerchantInfo>(
        accessToken,
        'GET',
        '/store/info',
      );

      this.logger.debug(`Merchant info retrieved: ${response.data.name}`);

      return response.data;

    } catch (error: any) {
      this.logger.error('Failed to fetch merchant info', error);
      throw new Error(`فشل في جلب بيانات المتجر: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Orders API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getOrders(
    accessToken: string,
    options?: { page?: number; perPage?: number; status?: string },
  ): Promise<SallaApiResponse<SallaOrder[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.perPage) params.append('per_page', options.perPage.toString());
    if (options?.status) params.append('status', options.status);

    return this.makeRequest<SallaOrder[]>(accessToken, 'GET', `/orders?${params.toString()}`);
  }

  async getOrder(accessToken: string, orderId: number): Promise<SallaApiResponse<SallaOrder>> {
    return this.makeRequest<SallaOrder>(accessToken, 'GET', `/orders/${orderId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customers API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCustomers(
    accessToken: string,
    options?: { page?: number; perPage?: number; keyword?: string },
  ): Promise<SallaApiResponse<SallaCustomer[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.perPage) params.append('per_page', options.perPage.toString());
    if (options?.keyword) params.append('keyword', options.keyword);

    return this.makeRequest<SallaCustomer[]>(accessToken, 'GET', `/customers?${params.toString()}`);
  }

  async getCustomer(accessToken: string, customerId: number): Promise<SallaApiResponse<SallaCustomer>> {
    return this.makeRequest<SallaCustomer>(accessToken, 'GET', `/customers/${customerId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Products API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getProducts(
    accessToken: string,
    options?: { page?: number; perPage?: number; keyword?: string },
  ): Promise<SallaApiResponse<SallaProduct[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.perPage) params.append('per_page', options.perPage.toString());
    if (options?.keyword) params.append('keyword', options.keyword);

    return this.makeRequest<SallaProduct[]>(accessToken, 'GET', `/products?${params.toString()}`);
  }

  async getProduct(accessToken: string, productId: number): Promise<SallaApiResponse<SallaProduct>> {
    return this.makeRequest<SallaProduct>(accessToken, 'GET', `/products/${productId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private async makeRequest<T>(
    accessToken: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: Record<string, unknown>,
  ): Promise<SallaApiResponse<T>> {
    const url = `${this.BASE_URL}${endpoint}`;

    this.logger.debug(`Salla API ${method} ${endpoint}`);

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
      this.logger.error(`Salla API Error: ${method} ${endpoint}`, {
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
