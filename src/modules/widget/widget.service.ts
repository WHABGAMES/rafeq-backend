/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Widget Service                                   ║
 * ║                                                                                ║
 * ║  يدعم البحث بـ storeId (UUID) أو sallaMerchantId (رقم سلة)                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WidgetSettings } from './widget-settings.entity';
import { Store } from '../stores/entities/store.entity';

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    @InjectRepository(WidgetSettings)
    private readonly repo: Repository<WidgetSettings>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  /**
   * يحل storeId من UUID أو رقم سلة
   * سلة Snippet يرسل {{store.id}} = رقم سلة (مثل 1852572916)
   * قاعدة بياناتنا تستخدم UUID
   */
  private async resolveStoreId(identifier: string): Promise<string | null> {
    // إذا كان UUID → استخدمه مباشرة
    if (identifier.includes('-') && identifier.length > 30) {
      return identifier;
    }

    // إذا كان رقم → ابحث بـ sallaMerchantId
    const numericId = parseInt(identifier, 10);
    if (!isNaN(numericId)) {
      const store = await this.storeRepo.findOne({
        where: { sallaMerchantId: numericId },
        select: ['id'],
      });

      if (store) {
        this.logger.log(`Resolved sallaMerchantId ${numericId} → storeId ${store.id}`);
        return store.id;
      }
    }

    return null;
  }

  /**
   * جلب إعدادات الويدجت لمتجر — يُنشئ default إذا ما لقى
   */
  async getSettings(storeId: string, tenantId: string): Promise<WidgetSettings> {
    let settings = await this.repo.findOne({ where: { storeId } });

    if (!settings) {
      settings = this.repo.create({ storeId, tenantId, whatsappNumber: '' });
      await this.repo.save(settings);
    }

    return settings;
  }

  /**
   * تحديث إعدادات الويدجت
   */
  async updateSettings(
    storeId: string,
    tenantId: string,
    dto: Partial<WidgetSettings>,
  ): Promise<WidgetSettings> {
    let settings = await this.repo.findOne({ where: { storeId, tenantId } });

    if (!settings) {
      settings = this.repo.create({ storeId, tenantId, whatsappNumber: '' });
    }

    const allowed = [
      'isEnabled', 'whatsappNumber', 'welcomeMessage', 'prefilledMessage',
      'position', 'buttonColor', 'headerColor', 'size',
      'buttonStyle', 'buttonAnimation', 'buttonText', 'popupStyle',
      'iconSizePx', 'bottomOffset', 'showOnHover', 'autoOpenSeconds',
      'showOnMobile', 'showTooltip', 'tooltipText',
      'agentName', 'agentAvatarUrl', 'offlineMessage',
      'customIconUrl',   // ✅ لوقو الأيقونة المخصصة
    ];

    for (const key of allowed) {
      if (dto[key as keyof WidgetSettings] !== undefined) {
        (settings as any)[key] = dto[key as keyof WidgetSettings];
      }
    }

    return this.repo.save(settings);
  }

  /**
   * جلب config عام — يقبل UUID أو رقم سلة
   */
  async getPublicConfig(identifier: string): Promise<Record<string, unknown> | null> {
    const storeId = await this.resolveStoreId(identifier);
    if (!storeId) return null;

    const settings = await this.repo.findOne({ where: { storeId, isEnabled: true } });

    if (!settings || !settings.whatsappNumber) {
      return null;
    }

    return {
      enabled: settings.isEnabled,
      phone: settings.whatsappNumber,
      welcome: settings.welcomeMessage,
      prefilled: settings.prefilledMessage,
      position: settings.position,
      btnColor: settings.buttonColor,
      headerColor: settings.headerColor,
      size: settings.size,
      btnStyle: settings.buttonStyle || 'classic',
      btnAnim: settings.buttonAnimation || 'pulse',
      btnText: settings.buttonText || '',
      popupStyle: settings.popupStyle || 'whatsapp',
      iconSize: settings.iconSizePx || 60,
      bottomOff: settings.bottomOffset || 20,
      hoverOpen: settings.showOnHover || false,
      autoOpen: settings.autoOpenSeconds || 0,
      mobile: settings.showOnMobile,
      tooltip: settings.showTooltip,
      tooltipText: settings.tooltipText,
      agent: settings.agentName,
      avatar: settings.agentAvatarUrl,
      offline: settings.offlineMessage,
      customIcon: settings.customIconUrl || null,  // ✅ لوقو مخصص
    };
  }

  /**
   * Track click — يقبل UUID أو رقم سلة
   */
  async trackClick(identifier: string): Promise<void> {
    const storeId = await this.resolveStoreId(identifier);
    if (storeId) await this.repo.increment({ storeId }, 'totalClicks', 1);
  }

  /**
   * Track impression — يقبل UUID أو رقم سلة
   */
  async trackImpression(identifier: string): Promise<void> {
    const storeId = await this.resolveStoreId(identifier);
    if (storeId) await this.repo.increment({ storeId }, 'totalImpressions', 1);
  }
}
