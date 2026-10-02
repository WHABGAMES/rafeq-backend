/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           Rafeq Platform — Maintenance Service                                ║
 * ║                                                                                ║
 * ║  📌 إدارة وضع الصيانة الجزئي للصفحات                                            ║
 * ║  يتضمن: cache في الذاكرة لتقليل الضغط على قاعدة البيانات                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePage, MaintenanceStyle } from '../entities/maintenance-page.entity';
import { AdminUser } from '../entities/admin-user.entity';
import { AuditService } from './audit.service';

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
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceService.name);

  // ✅ In-memory cache — يتحدث كل 30 ثانية
  private cache: Map<string, { isActive: boolean; style: MaintenanceStyle; message: string | null }> = new Map();
  private cacheExpiry = 0;
  private cacheRefresh?: Promise<void>;
  private readonly CACHE_TTL_MS = 30_000; // 30 ثانية

  constructor(
    @InjectRepository(MaintenancePage)
    private readonly repo: Repository<MaintenancePage>,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ تحقق سريع — هل هذا الـ route تحت الصيانة؟
   * يُستخدم من الفرونت إند عند كل تحميل صفحة
   */
  async checkRoute(route: string): Promise<{ isActive: boolean; style: MaintenanceStyle; message?: string | null }> {
    await this.refreshCacheIfNeeded();

    const match = this.findMostSpecificMatch(route);
    if (match) return match;

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
  async toggle(id: string, isActive: boolean, actor: AdminUser): Promise<MaintenancePage> {
    const page = await this.repo.findOneBy({ id });
    if (!page) throw new NotFoundException('الصفحة غير موجودة');
    const previous = this.snapshot(page);
    page.isActive = isActive;
    page.activatedBy = isActive ? actor.email : null;
    const saved = await this.repo.save(page);
    this.invalidateCache();
    await this.auditService.log({
      actor,
      action: isActive ? 'maintenance.enabled' : 'maintenance.disabled',
      targetType: 'maintenance_page',
      targetId: saved.id,
      metadata: { route: saved.route, previous, current: this.snapshot(saved) },
    });
    this.logger.log(`Maintenance ${isActive ? 'ON' : 'OFF'}: ${page.route} by ${actor.email}`);
    return saved;
  }

  /**
   * ✅ تحديث إعدادات صفحة (style, message)
   */
  async update(id: string, data: { style?: MaintenanceStyle; message?: string; isActive?: boolean }, actor: AdminUser): Promise<MaintenancePage> {
    const page = await this.repo.findOneBy({ id });
    if (!page) throw new NotFoundException('الصفحة غير موجودة');
    const previous = this.snapshot(page);
    if (data.style !== undefined) page.style = data.style;
    if (data.message !== undefined) page.message = data.message || null;
    if (data.isActive !== undefined) {
      page.isActive = data.isActive;
      page.activatedBy = data.isActive ? actor.email : null;
    }
    const saved = await this.repo.save(page);
    this.invalidateCache();
    await this.auditService.log({
      actor,
      action: 'maintenance.updated',
      targetType: 'maintenance_page',
      targetId: saved.id,
      metadata: { route: saved.route, previous, current: this.snapshot(saved) },
    });
    return saved;
  }

  /**
   * ✅ جلب كل الصفحات النشطة (تحت الصيانة) — للفرونت إند
   */
  async getActiveRoutes(): Promise<{ route: string; style: MaintenanceStyle; message: string | null }[]> {
    await this.refreshCacheIfNeeded();
    const result: { route: string; style: MaintenanceStyle; message: string | null }[] = [];
    this.cache.forEach((val, key) => {
      if (val.isActive) result.push({ route: key, ...val });
    });
    return result.sort((a, b) => b.route.length - a.route.length);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════════════════════════

  private async refreshCacheIfNeeded(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;
    if (!this.cacheRefresh) {
      this.cacheRefresh = (async () => {
        try {
          const all = await this.repo.find();
          const nextCache = new Map<string, { isActive: boolean; style: MaintenanceStyle; message: string | null }>();
          for (const p of all) {
            nextCache.set(p.route, { isActive: p.isActive, style: p.style, message: p.message });
          }
          this.cache = nextCache;
          this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
        } catch (err) {
          this.logger.error(`Cache refresh failed: ${(err as Error).message}`);
        }
      })().finally(() => {
        this.cacheRefresh = undefined;
      });
    }

    await this.cacheRefresh;
  }

  private invalidateCache(): void {
    this.cacheExpiry = 0;
  }

  private findMostSpecificMatch(route: string): { isActive: boolean; style: MaintenanceStyle; message: string | null } | undefined {
    const normalizedRoute = route.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
    const candidates = [...this.cache.entries()]
      .filter(([configuredRoute, state]) => {
        if (!state.isActive) return false;
        if (configuredRoute === '/dashboard') return normalizedRoute === configuredRoute;
        return normalizedRoute === configuredRoute || normalizedRoute.startsWith(`${configuredRoute}/`);
      })
      .sort(([left], [right]) => right.length - left.length);

    return candidates[0]?.[1];
  }

  private snapshot(page: MaintenancePage): Record<string, unknown> {
    return {
      isActive: page.isActive,
      style: page.style,
      message: page.message ?? null,
      activatedBy: page.activatedBy ?? null,
    };
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
