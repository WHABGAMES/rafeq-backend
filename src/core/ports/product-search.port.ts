/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                  RAFIQ PLATFORM — ProductSearchPort                            ║
 * ║                                                                                ║
 * ║  FIX #7: AI يعتمد على Salla مباشرة → يجب platform-agnostic                   ║
 * ║                                                                                ║
 * ║  المشكلة:                                                                      ║
 * ║    AiModule يستورد SallaApiService مباشرة                                     ║
 * ║    → AI لا يدعم زد أبداً                                                      ║
 * ║    → إصلاح Salla يلمس AI (خرق للـ Platform Isolation)                        ║
 * ║                                                                                ║
 * ║  الحل — Dependency Inversion:                                                  ║
 * ║    AI يعتمد على Interface فقط (هذا الملف)                                     ║
 * ║    كل منصة تُطبّق هذه الـ Interface:                                           ║
 * ║      SallaProductSearchAdapter → يستخدم SallaApiService                       ║
 * ║      ZidProductSearchAdapter   → يستخدم ZidApiService                         ║
 * ║                                                                                ║
 * ║  النتيجة:                                                                      ║
 * ║    AI لا يرى سلة أو زد — يرى فقط ProductSearchPort                           ║
 * ║    إضافة Shopify = adapter جديد فقط، لا مساس بـ AI                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/**
 * منتج مُوحَّد — مستقل عن المنصة
 * كل adapter يُحوّل بيانات منصته إلى هذا الشكل
 */
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
  /** رابط المنتج للعميل */
  url?: string;
  /** صورة المنتج */
  imageUrl?: string;
}

/**
 * خيارات بحث المنتجات
 */
export interface ProductSearchOptions {
  keyword: string;
  limit?: number;
  /** حالة المنتج — افتراضياً active فقط */
  status?: 'active' | 'all';
}

/**
 * نتيجة بحث منتج واحد — جاهزة للـ AI RAG pipeline
 */
export interface ProductSearchChunk {
  title: string;
  content: string;
  /** نقاط التطابق — 0.0 إلى 1.0 */
  score: number;
}

/**
 * نتيجة البحث الكاملة من الـ adapter
 */
export interface ProductSearchResult {
  chunks: ProductSearchChunk[];
  topScore: number;
  /** هل نجح البحث وأعاد نتائج ذات صلة؟ */
  gateAPassed: boolean;
  /** عدد المنتجات الخام قبل التحويل */
  rawCount?: number;
}

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ProductSearchPort — الـ Interface الوحيد الذي يراه AI                      ║
 * ║                                                                              ║
 * ║  يجب أن تُطبّق كل منصة هذا الـ interface:                                   ║
 * ║    • SallaProductSearchAdapter  → for Salla stores                           ║
 * ║    • ZidProductSearchAdapter    → for Zid stores                             ║
 * ║    • ShopifyProductSearchAdapter → for Shopify stores (مستقبلاً)             ║
 * ║                                                                              ║
 * ║  القاعدة الصارمة:                                                            ║
 * ║    AI يستدعي search() فقط — لا يعرف المنصة، لا يستورد أي service منصة     ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
export abstract class ProductSearchPort {
  /**
   * البحث في منتجات المتجر
   *
   * @param storeId  معرّف المتجر الداخلي (UUID)
   * @param options  خيارات البحث (keyword, limit, status)
   * @returns نتيجة البحث جاهزة للـ RAG pipeline
   */
  abstract search(storeId: string, options: ProductSearchOptions): Promise<ProductSearchResult>;

  /**
   * هل هذا الـ adapter يدعم منصة معينة؟
   * يُستخدم من الـ ProductSearchFactory لاختيار الـ adapter الصحيح
   */
  abstract supports(platform: string): boolean;
}

/** Token للـ Dependency Injection في NestJS */
export const PRODUCT_SEARCH_PORT = 'PRODUCT_SEARCH_PORT';
