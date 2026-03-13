/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla API Service                              ║
 * ║                                                                                ║
 * ║  خدمة للتواصل مع API سلة                                                        ║
 * ║  جلب الطلبات، العملاء، المنتجات، إلخ                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * 📌 Salla API Documentation:
 * https://docs.salla.dev/
 * 
 * Base URL: https://api.salla.dev/admin/v2
 * 
 * Authentication: Bearer Token
 * 
 * Rate Limits:
 * - 120 requests per minute (standard)
 * - بعض الـ endpoints لها limits مختلفة
 */

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
    links: {
      first: string;
      last: string;
      prev: string | null;
      next: string | null;
    };
  };
}

export interface SallaOrder {
  id: number;
  reference_id: string;
  date: {
    date: string;
    timezone: string;
    timestamp: number;
  };
  status: {
    id: number;
    name: string;
    slug: string;
    customized: {
      id: number;
      name: string;
      slug: string;
    };
  };
  payment: {
    status: string;
    method: {
      id: number;
      name: string;
    };
  };
  amounts: {
    sub_total: {
      amount: number;
      currency: string;
    };
    shipping_cost: {
      amount: number;
      currency: string;
    };
    tax: {
      amount: number;
      currency: string;
    };
    total: {
      amount: number;
      currency: string;
    };
  };
  customer: SallaCustomer;
  items: SallaOrderItem[];
  shipping?: {
    company?: {
      id: number;
      name: string;
    };
    receiver?: {
      name: string;
      phone: string;
    };
    address?: {
      city: string;
      country: string;
      street_number: string;
      block: string;
      postal_code: string;
    };
  };
}

export interface SallaCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  mobile_code: string;
  avatar: string;
  city: string;
  country: string;
  country_code: string;
  currency: string;
  location: string;
  gender: string;
  birthday: string;
  updated_at: string;
}

export interface SallaOrderItem {
  id: number;
  name: string;
  sku: string;
  quantity: number;
  price: {
    amount: number;
    currency: string;
  };
  thumbnail: string;
  product_id: number;
}

export interface SallaProduct {
  id: number;
  name: string;
  sku: string;
  description: string;
  price: {
    amount: number;
    currency: string;
  };
  sale_price?: {
    amount: number;
    currency: string;
  };
  quantity: number;
  status: string;
  images: Array<{
    id: number;
    url: string;
    main: boolean;
  }>;
}

@Injectable()
export class SallaApiService {
  private readonly logger = new Logger(SallaApiService.name);
  private readonly BASE_URL = 'https://api.salla.dev/admin/v2';

  constructor(private readonly httpService: HttpService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Orders API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب قائمة الطلبات
   */
  async getOrders(
    accessToken: string,
    options?: {
      page?: number;
      perPage?: number;
      status?: string;
    },
  ): Promise<SallaApiResponse<SallaOrder[]>> {
    const params = new URLSearchParams();
    
    if (options?.page) params.append('page', options.page.toString());
    if (options?.perPage) params.append('per_page', options.perPage.toString());
    if (options?.status) params.append('status', options.status);

    return this.makeRequest<SallaOrder[]>(
      accessToken,
      'GET',
      `/orders?${params.toString()}`,
    );
  }

  /**
   * جلب طلب معين
   */
  async getOrder(accessToken: string, orderId: number): Promise<SallaApiResponse<SallaOrder>> {
    return this.makeRequest<SallaOrder>(
      accessToken,
      'GET',
      `/orders/${orderId}`,
    );
  }

  /**
   * ✅ بحث عن طلب بالرقم المرجعي (المرئي للعميل)
   */
  async searchOrderByReference(accessToken: string, reference: string): Promise<SallaOrder | null> {
    try {
      const response = await this.makeRequest<SallaOrder[]>(
        accessToken,
        'GET',
        `/orders?keyword=${encodeURIComponent(reference)}&per_page=5`,
      );

      const orders = response?.data;
      if (!orders?.length) return null;

      return orders.find((o: SallaOrder) =>
        String(o.id) === reference ||
        String(o.reference_id) === reference ||
        String(o.reference_id)?.includes(reference)
      ) || orders[0];
    } catch {
      return null;
    }
  }

  /**
   * تحديث حالة الطلب
   */
  async updateOrderStatus(
    accessToken: string,
    orderId: number,
    statusId: number,
  ): Promise<SallaApiResponse<SallaOrder>> {
    return this.makeRequest<SallaOrder>(
      accessToken,
      'PUT',
      `/orders/${orderId}/status`,
      { status_id: statusId },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customers API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب قائمة العملاء
   */
  async getCustomers(
    accessToken: string,
    options?: {
      page?: number;
      perPage?: number;
      keyword?: string;
    },
  ): Promise<SallaApiResponse<SallaCustomer[]>> {
    const params = new URLSearchParams();
    
    if (options?.page) params.append('page', options.page.toString());
    if (options?.perPage) params.append('per_page', options.perPage.toString());
    if (options?.keyword) params.append('keyword', options.keyword);

    return this.makeRequest<SallaCustomer[]>(
      accessToken,
      'GET',
      `/customers?${params.toString()}`,
    );
  }

  /**
   * جلب عميل معين
   */
  async getCustomer(accessToken: string, customerId: number): Promise<SallaApiResponse<SallaCustomer>> {
    return this.makeRequest<SallaCustomer>(
      accessToken,
      'GET',
      `/customers/${customerId}`,
    );
  }

  /**
   * جلب طلبات عميل
   */
  async getCustomerOrders(
    accessToken: string,
    customerId: number,
    options?: { page?: number },
  ): Promise<SallaApiResponse<SallaOrder[]>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());

    return this.makeRequest<SallaOrder[]>(
      accessToken,
      'GET',
      `/customers/${customerId}/orders?${params.toString()}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Products API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب قائمة المنتجات
   */
  async getProducts(
    accessToken: string,
    options?: {
      page?: number;
      perPage?: number;
      keyword?: string;
      status?: string;
    },
  ): Promise<SallaApiResponse<SallaProduct[]>> {
    const params = new URLSearchParams();
    
    if (options?.page) params.append('page', options.page.toString());
    if (options?.perPage) params.append('per_page', options.perPage.toString());
    if (options?.keyword) params.append('keyword', options.keyword);
    if (options?.status) params.append('status', options.status);

    return this.makeRequest<SallaProduct[]>(
      accessToken,
      'GET',
      `/products?${params.toString()}`,
    );
  }

  /**
   * جلب منتج معين
   */
  async getProduct(accessToken: string, productId: number): Promise<SallaApiResponse<SallaProduct>> {
    return this.makeRequest<SallaProduct>(
      accessToken,
      'GET',
      `/products/${productId}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Store API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب معلومات المتجر
   */
  async getStoreInfo(accessToken: string): Promise<SallaApiResponse<{
    id: number;
    username: string;
    name: string;
    email: string;
    mobile: string;
    domain: string;
    avatar: string;
    plan: string;
  }>> {
    return this.makeRequest(
      accessToken,
      'GET',
      '/store/info',
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚚 Shipment API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب شركات الشحن
   */
  async getShippingCompanies(accessToken: string): Promise<SallaApiResponse<Array<{
    id: number;
    name: string;
    code: string;
    logo: string;
  }>>> {
    return this.makeRequest(
      accessToken,
      'GET',
      '/shipping/companies',
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إجراء طلب للـ API
   */
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

      // إعادة رمي الخطأ مع معلومات إضافية
      throw {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
        endpoint,
        originalError: error,
      };
    }
  }
}

/**
 * 📌 أمثلة على استخدام الـ Service:
 * 
 * // جلب آخر 10 طلبات
 * const orders = await sallaApiService.getOrders(accessToken, { perPage: 10 });
 * 
 * // جلب عميل معين
 * const customer = await sallaApiService.getCustomer(accessToken, 12345);
 * 
 * // البحث في المنتجات
 * const products = await sallaApiService.getProducts(accessToken, { keyword: 'عباية' });
 */
