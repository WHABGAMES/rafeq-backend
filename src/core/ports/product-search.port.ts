/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                  RAFIQ PLATFORM — ProductSearchPort                            ║
 * ║                                                                                ║
 * ║  FIX #7: AI Platform-Agnostic Product Search                                  ║
 * ║                                                                                ║
 * ║  هذا الملف يحتوي على:                                                          ║
 * ║    • Interfaces: UnifiedProduct, ProductSearchOptions, ProductSearchResult     ║
 * ║    • Abstract Class: ProductSearchPort (يُطبَّق في كل منصة)                   ║
 * ║                                                                                ║
 * ║  📁 src/core/ports/product-search.port.ts                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/** منتج مُوحَّد — مستقل عن المنصة */
export interface UnifiedProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  salePrice?: number;
  quantity: number;
  sku?: string;
  status: 'active' | 'out_of_stock' | 'inactive';
  url?: string;
  imageUrl?: string;
}

/** خيارات بحث المنتجات */
export interface ProductSearchOptions {
  keyword: string;
  limit?: number;
  status?: 'active' | 'all';
}

/** نتيجة بحث منتج واحد — جاهزة للـ AI RAG pipeline */
export interface ProductSearchChunk {
  title: string;
  content: string;
  score: number;
}

/** نتيجة البحث الكاملة */
export interface ProductSearchResult {
  chunks: ProductSearchChunk[];
  topScore: number;
  gateAPassed: boolean;
  rawCount?: number;
}

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ProductSearchPort — Abstract Class                                          ║
 * ║                                                                              ║
 * ║  كل منصة تُطبّق هذا الـ abstract class:                                      ║
 * ║    • SallaProductSearchAdapter  → src/integrations/salla/                   ║
 * ║    • ZidProductSearchAdapter    → src/integrations/zid/                     ║
 * ║                                                                              ║
 * ║  AI يستدعي search() فقط — لا يعرف المنصة                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
export abstract class ProductSearchPort {
  abstract search(storeId: string, options: ProductSearchOptions): Promise<ProductSearchResult>;
  abstract supports(platform: string): boolean;
}

/** Token للـ Dependency Injection */
export const PRODUCT_SEARCH_PORT = 'PRODUCT_SEARCH_PORT';
