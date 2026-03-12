/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           RAFIQ PLATFORM — Zid Product Search Adapter                          ║
 * ║                                                                                ║
 * ║  يُطبّق ProductSearchPort لمنصة زد                                            ║
 * ║  AI يستخدم هذا الـ adapter عبر الـ interface — لا يستورده مباشرة             ║
 * ║                                                                                ║
 * ║  📁 src/integrations/zid/zid-product-search.adapter.ts                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, StorePlatform, StoreStatus } from '../../modules/stores/entities/store.entity';
import { ZidApiService, ZidAuthTokens, ZidProduct } from '../../modules/stores/zid-api.service';
import { decrypt } from '../../common/utils/encryption.util';
import {
  ProductSearchPort,
  ProductSearchOptions,
  ProductSearchResult,
  ProductSearchChunk,
  UnifiedProduct,
} from '../../core/ports/product-search.port';

@Injectable()
export class ZidProductSearchAdapter extends ProductSearchPort {
  private readonly logger = new Logger(ZidProductSearchAdapter.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    private readonly zidApiService: ZidApiService,
  ) {
    super();
  }

  // ─── ProductSearchPort Interface ────────────────────────────────────────────

  supports(platform: string): boolean {
    return platform === StorePlatform.ZID;
  }

  async search(storeId: string, options: ProductSearchOptions): Promise<ProductSearchResult> {
    const empty: ProductSearchResult = { chunks: [], topScore: 0, gateAPassed: false };

    try {
      // ─── جلب معلومات المتجر مع tokens ────────────────────────────────────
      const store = await this.storeRepository.findOne({
        where: { id: storeId },
        select: ['id', 'platform', 'status', 'accessToken', 'zidStoreId'],
      });

      if (!store) {
        this.logger.warn(`[Zid] Store not found: ${storeId}`);
        return empty;
      }

      if (store.platform !== StorePlatform.ZID) {
        return empty; // هذا الـ adapter لا يدعم هذه المنصة
      }

      if (store.status !== StoreStatus.ACTIVE) {
        this.logger.warn(`[Zid] Store inactive: ${storeId} (${store.status})`);
        return empty;
      }

      if (!store.accessToken) {
        this.logger.warn(`[Zid] No access token for store: ${storeId}`);
        return empty;
      }

      // ─── فك التشفير ──────────────────────────────────────────────────────
      const managerToken = decrypt(store.accessToken);
      if (!managerToken) {
        this.logger.error(`[Zid] Failed to decrypt access token: ${storeId}`);
        return empty;
      }

      const tokens: ZidAuthTokens = {
        managerToken,
        storeId: store.zidStoreId,
      };

      // ─── البحث عبر Zid API ───────────────────────────────────────────────
      this.logger.log(`[Zid] Searching products: "${options.keyword}" in ${storeId}`);

      const response = await this.zidApiService.getProducts(tokens, {
        per_page: options.limit ?? 10,
        status: options.status === 'all' ? undefined : 'active',
      });

      if (!response.data || response.data.length === 0) {
        this.logger.log(`[Zid] No products for: "${options.keyword}"`);
        return { ...empty, rawCount: 0 };
      }

      // ─── فلترة بالـ keyword (Zid API لا يدعم keyword search مثل Salla) ──
      const keyword = options.keyword.toLowerCase();
      const filtered = response.data.filter((p: ZidProduct) =>
        p.name?.toLowerCase().includes(keyword),
      );

      if (filtered.length === 0) {
        this.logger.log(`[Zid] No products matching keyword "${options.keyword}" after filter`);
        return { ...empty, rawCount: response.data.length };
      }

      // ─── تحويل إلى UnifiedProduct → chunks ───────────────────────────────
      const products: UnifiedProduct[] = filtered.map((p: ZidProduct) => ({
        id:          String(p.id),
        name:        p.name || '',
        price:       p.price ?? 0,
        currency:    'SAR', // زد يستخدم SAR افتراضياً
        salePrice:   p.sale_price,
        quantity:    p.quantity ?? 0,
        sku:         p.sku,
        status:      p.quantity > 0 ? 'active' : 'out_of_stock',
        imageUrl:    p.images?.[0],
      }));

      const chunks: ProductSearchChunk[] = products.map(p => this.toChunk(p));

      this.logger.log(`[Zid] Found ${chunks.length} products`);

      return {
        chunks,
        topScore: chunks.length > 0 ? 0.80 : 0,
        gateAPassed: chunks.length > 0,
        rawCount: response.data.length,
      };

    } catch (error) {
      this.logger.error(
        `[Zid] Product search error: ${error instanceof Error ? error.message : 'Unknown'}`,
        { storeId, keyword: options.keyword },
      );
      return empty;
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private toChunk(product: UnifiedProduct): ProductSearchChunk {
    const inStock = product.quantity > 0 ? 'متوفر' : 'غير متوفر';
    const price = product.salePrice ?? product.price;

    return {
      title:   product.name,
      content: [
        product.description || 'لا يوجد وصف',
        `السعر: ${price} ${product.currency}`,
        `الحالة: ${inStock}`,
        product.sku ? `رمز المنتج: ${product.sku}` : null,
      ].filter(Boolean).join('\n'),
      score: 0.80,
    };
  }
}
