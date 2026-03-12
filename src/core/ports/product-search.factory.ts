/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — ProductSearchFactory                                 ║
 * ║                                                                                ║
 * ║  يختار الـ adapter الصحيح بناءً على منصة المتجر تلقائياً                      ║
 * ║  AI يستخدم هذا الـ factory فقط — لا يرى سلة أو زد مباشرة                    ║
 * ║                                                                                ║
 * ║  📁 src/core/ports/product-search.factory.ts                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '../../modules/stores/entities/store.entity';
import { ProductSearchPort, ProductSearchOptions, ProductSearchResult } from './product-search.port';

@Injectable()
export class ProductSearchFactory {
  private readonly logger = new Logger(ProductSearchFactory.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    /**
     * الـ adapters مُمرَّرة من ai.module.ts عبر useFactory
     * كل adapter يُعرّف supports() ليحدد أي منصة يخدم
     */
    private readonly adapters: ProductSearchPort[],
  ) {}

  /**
   * البحث في منتجات متجر — يختار الـ adapter المناسب تلقائياً
   */
  async search(storeId: string, options: ProductSearchOptions): Promise<ProductSearchResult> {
    const empty: ProductSearchResult = { chunks: [], topScore: 0, gateAPassed: false };

    try {
      const store = await this.storeRepository.findOne({
        where: { id: storeId },
        select: ['id', 'platform'],
      });

      if (!store) {
        this.logger.warn(`ProductSearchFactory: store not found: ${storeId}`);
        return empty;
      }

      const adapter = this.adapters.find(a => a.supports(store.platform));

      if (!adapter) {
        this.logger.warn(
          `ProductSearchFactory: no adapter for platform "${store.platform}" (storeId: ${storeId})`,
        );
        return empty;
      }

      this.logger.debug(`ProductSearchFactory: using ${store.platform} adapter`);
      return adapter.search(storeId, options);

    } catch (error) {
      this.logger.error(
        `ProductSearchFactory error: ${error instanceof Error ? error.message : 'Unknown'}`,
        { storeId },
      );
      return empty;
    }
  }
}
