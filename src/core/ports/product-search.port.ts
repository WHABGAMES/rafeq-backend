/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Salla Product Search Adapter                         ║
 * ║                                                                                ║
 * ║  يُطبّق ProductSearchPort لمنصة سلة                                           ║
 * ║  AI يستخدم هذا الـ adapter عبر الـ interface — لا يستورده مباشرة             ║
 * ║                                                                                ║
 * ║  📁 src/integrations/salla/salla-product-search.adapter.ts                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, StorePlatform, StoreStatus } from '../../modules/stores/entities/store.entity';
import { SallaApiService, SallaProduct } from '../../modules/stores/salla-api.service';
import { decrypt } from '../../common/utils/encryption.util';
import {
  ProductSearchPort,
  ProductSearchOptions,
  ProductSearchResult,
  ProductSearchChunk,
  UnifiedProduct,
} from '../../core/ports/product-search.port';

@Injectable()
export class SallaProductSearchAdapter extends ProductSearchPort {
  private readonly logger = new Logger(SallaProductSearchAdapter.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    private readonly sallaApiService: SallaApiService,
  ) {
    super();
  }

  // ─── ProductSearchPort Interface ────────────────────────────────────────────

  supports(platform: string): boolean {
    return platform === StorePlatform.SALLA;
  }

  async search(storeId: string, options: ProductSearchOptions): Promise<ProductSearchResult> {
    const empty: ProductSearchResult = { chunks: [], topScore: 0, gateAPassed: false };

    try {
      // ─── جلب معلومات المتجر مع access token ───────────────────────────────
      const store = await this.storeRepository.findOne({
        where: { id: storeId },
        select: ['id', 'platform', 'status', 'accessToken'],
      });

      if (!store) {
        this.logger.warn(`[Salla] Store not found: ${storeId}`);
        return empty;
      }

      if (store.platform !== StorePlatform.SALLA) {
        // هذا الـ adapter لا يدعم هذه المنصة
        return empty;
      }

      if (store.status !== StoreStatus.ACTIVE) {
        this.logger.warn(`[Salla] Store inactive: ${storeId} (${store.status})`);
        return empty;
      }

      if (!store.accessToken) {
        this.logger.warn(`[Salla] No access token for store: ${storeId}`);
        return empty;
      }

      // ─── فك التشفير ──────────────────────────────────────────────────────
      const accessToken = decrypt(store.accessToken);
      if (!accessToken) {
        this.logger.error(`[Salla] Failed to decrypt access token: ${storeId}`);
        return empty;
      }

      // ─── البحث عبر Salla API ─────────────────────────────────────────────
      this.logger.log(`[Salla] Searching products: "${options.keyword}" in ${storeId}`);

      const response = await this.sallaApiService.getProducts(accessToken, {
        keyword: options.keyword,
        perPage: options.limit ?? 10,
        status: options.status === 'all' ? undefined : 'active',
      });

      if (!response.data || response.data.length === 0) {
        this.logger.log(`[Salla] No products for: "${options.keyword}"`);
        return { ...empty, rawCount: 0 };
      }

      // ─── تحويل إلى UnifiedProduct → chunks ───────────────────────────────
      const products: UnifiedProduct[] = response.data.map((p: SallaProduct) => ({
        id:          String(p.id),
        name:        p.name || '',
        description: p.description,
        price:       p.price?.amount ?? p.sale_price?.amount ?? 0,
        currency:    p.price?.currency ?? 'SAR',
        salePrice:   p.sale_price?.amount,
        quantity:    p.quantity ?? 0,
        sku:         p.sku,
        status:      p.quantity > 0 ? 'active' : 'out_of_stock',
        imageUrl:    p.images?.[0]?.url,
      }));

      const chunks: ProductSearchChunk[] = products.map(p => this.toChunk(p));

      this.logger.log(`[Salla] Found ${chunks.length} products`);

      return {
        chunks,
        topScore: chunks.length > 0 ? 0.80 : 0,
        gateAPassed: chunks.length > 0,
        rawCount: response.data.length,
      };

    } catch (error) {
      this.logger.error(
        `[Salla] Product search error: ${error instanceof Error ? error.message : 'Unknown'}`,
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
