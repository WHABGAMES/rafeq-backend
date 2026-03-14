/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Widget Service                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WidgetSettings } from './widget-settings.entity';

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    @InjectRepository(WidgetSettings)
    private readonly repo: Repository<WidgetSettings>,
  ) {}

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

    // Update only allowed fields
    const allowed = [
      'isEnabled', 'whatsappNumber', 'welcomeMessage', 'prefilledMessage',
      'position', 'buttonColor', 'headerColor', 'size',
      'showOnMobile', 'showTooltip', 'tooltipText',
      'agentName', 'agentAvatarUrl', 'offlineMessage',
    ];

    for (const key of allowed) {
      if (dto[key as keyof WidgetSettings] !== undefined) {
        (settings as any)[key] = dto[key as keyof WidgetSettings];
      }
    }

    return this.repo.save(settings);
  }

  /**
   * جلب config عام (بدون بيانات حساسة) — للـ embed script
   */
  async getPublicConfig(storeId: string): Promise<Record<string, unknown> | null> {
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
      mobile: settings.showOnMobile,
      tooltip: settings.showTooltip,
      tooltipText: settings.tooltipText,
      agent: settings.agentName,
      avatar: settings.agentAvatarUrl,
      offline: settings.offlineMessage,
    };
  }

  /**
   * Track click
   */
  async trackClick(storeId: string): Promise<void> {
    await this.repo.increment({ storeId }, 'totalClicks', 1);
  }

  /**
   * Track impression
   */
  async trackImpression(storeId: string): Promise<void> {
    await this.repo.increment({ storeId }, 'totalImpressions', 1);
  }
}
