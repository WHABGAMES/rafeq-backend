/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           Rafeq Platform — Maintenance Service                                ║
 * ║                                                                                ║
 * ║  📌 إدارة وضع الصيانة الجزئي للصفحات                                            ║
 * ║  يتضمن: cache في الذاكرة لتقليل الضغط على قاعدة البيانات                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePage, MaintenanceStyle } from '../entities/maintenance-page.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Default Dashboard Pages — يُنشأ تلقائياً إذا لم تكن موجودة
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULT_PAGES = [
  { route: '/dashboard', label: 'الرئيسية' },
  { route: '/dashboard/inbox', label: 'المحادثات' },
  { route: '/dashboard/contacts', label: 'العملاء' },
  { route: '/dashboard/inbox/settings', label: 'قاعدة بيانات العملاء' },
  { route: '/dashboard/templates', label: 'القوالب' },
  { route: '/dashboard/campaigns', label: 'الحملات' },
  { route: '/dashboard/widget', label: 'ويدجت واتساب' },
  { route: '/dashboard/conversion-elements', label: 'تحسين التحويل' },
  { route: '/dashboard/short-links', label: 'روابط مختصرة' },
  { route: '/dashboard/ai', label: 'موظف إسعاد العملاء' },
  { route: '/dashboard/stores', label: 'المتاجر' },
  { route: '/dashboard/channels', label: 'القنوات' },
  { route: '/dashboard/analytics', label: 'التحليلات' },
  { route: '/dashboard/staff', label: 'الموظفين' },
  { route: '/dashboard/staff/notifications', label: 'تنبيهات الموظفين' },
  { route: '/dashboard/billing', label: 'الاشتراكات' },
  { route: '/dashboard/settings', label: 'الإعدادات' },
  { route: '/dashboard/quick-replies', label: 'الردود السريعة' },
  { route: '/dashboard/suggestions', label: 'الاقتراحات' },
];

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  // ✅ In-memory cache — يتحدث كل 30 ثانية
  private cache: Map<string, { isActive: boolean; style: MaintenanceStyle; message?: string }> = new Map();
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 30_000; // 30 ثانية

  constructor(
    @InjectRepository(MaintenancePage)
    private readonly repo: Repository<MaintenancePage>,
  ) {
    // Seed default pages on startup
    this.seedDefaults().catch(err => this.logger.warn(`Seed failed: ${err.message}`));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ تحقق سريع — هل هذا الـ route تحت الصيانة؟
   * يُستخدم من الفرونت إند عند كل تحميل صفحة
   */
  async checkRoute(route: string): Promise<{ isActive: boolean; style: MaintenanceStyle; message?: string }> {
    await this.refreshCacheIfNeeded();

    const cached = this.cache.get(route);
    if (cached) return cached;

    return { isActive: false, style: MaintenanceStyle.OVERLAY };
  }

  /**
   * ✅ جلب كل الصفحات وحالتها — للأدمن
   */
  async getAll(): Promise<MaintenancePage[]> {
    return this.repo.find({ order: { route: 'ASC' } });
  }

  /**
   * ✅ تفعيل/تعطيل صيانة صفحة
   */
  async toggle(id: string, isActive: boolean, activatedBy?: string): Promise<MaintenancePage> {
    const page = await this.repo.findOneBy({ id });
    if (!page) throw new NotFoundException('الصفحة غير موجودة');
    page.isActive = isActive;
    if (activatedBy) page.activatedBy = activatedBy;
    const saved = await this.repo.save(page);
    this.invalidateCache();
    this.logger.log(`Maintenance ${isActive ? 'ON' : 'OFF'}: ${page.route} by ${activatedBy || 'system'}`);
    return saved;
  }

  /**
   * ✅ تحديث إعدادات صفحة (style, message)
   */
  async update(id: string, data: { style?: MaintenanceStyle; message?: string; isActive?: boolean }, activatedBy?: string): Promise<MaintenancePage> {
    const page = await this.repo.findOneBy({ id });
    if (!page) throw new NotFoundException('الصفحة غير موجودة');
    if (data.style !== undefined) page.style = data.style;
    if (data.message !== undefined) page.message = data.message;
    if (data.isActive !== undefined) page.isActive = data.isActive;
    if (activatedBy) page.activatedBy = activatedBy;
    const saved = await this.repo.save(page);
    this.invalidateCache();
    return saved;
  }

  /**
   * ✅ جلب كل الصفحات النشطة (تحت الصيانة) — للفرونت إند
   */
  async getActiveRoutes(): Promise<{ route: string; style: MaintenanceStyle; message?: string }[]> {
    await this.refreshCacheIfNeeded();
    const result: { route: string; style: MaintenanceStyle; message?: string }[] = [];
    this.cache.forEach((val, key) => {
      if (val.isActive) result.push({ route: key, ...val });
    });
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════════════════════════

  private async refreshCacheIfNeeded(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;
    try {
      const all = await this.repo.find();
      this.cache.clear();
      for (const p of all) {
        this.cache.set(p.route, { isActive: p.isActive, style: p.style, message: p.message });
      }
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    } catch (err) {
      this.logger.error(`Cache refresh failed: ${(err as Error).message}`);
    }
  }

  private invalidateCache(): void {
    this.cacheExpiry = 0;
  }

  private async seedDefaults(): Promise<void> {
    const existing = await this.repo.find();
    const existingRoutes = new Set(existing.map(p => p.route));

    const toInsert = DEFAULT_PAGES
      .filter(p => !existingRoutes.has(p.route))
      .map(p => this.repo.create({ ...p, isActive: false, style: MaintenanceStyle.OVERLAY }));

    if (toInsert.length > 0) {
      await this.repo.save(toInsert);
      this.logger.log(`Seeded ${toInsert.length} maintenance page entries`);
    }
  }
}
