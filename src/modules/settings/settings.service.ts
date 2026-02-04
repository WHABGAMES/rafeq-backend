/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Settings Service                                 ║
 * ║                                                                                ║
 * ║  ✅ v2: قاعدة بيانات حقيقية بدلاً من Map في الذاكرة                            ║
 * ║  ✅ الإعدادات مرتبطة بالمتجر (storeId) - كل متجر له إعداداته الخاصة            ║
 * ║  ✅ تبقى محفوظة بعد إعادة النشر                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreSettings } from './entities/store-settings.entity';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(StoreSettings)
    private readonly settingsRepository: Repository<StoreSettings>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Core: قراءة وكتابة الإعدادات من قاعدة البيانات
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ قراءة إعداد من قاعدة البيانات
   * يُرجع القيمة المحفوظة أو القيمة الافتراضية
   */
  private async getSetting(
    tenantId: string,
    storeId: string,
    key: string,
    defaults: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const setting = await this.settingsRepository.findOne({
      where: { tenantId, storeId, settingsKey: key },
    });

    if (setting) {
      // دمج القيم المحفوظة مع الافتراضية (لضمان وجود حقول جديدة)
      return { ...defaults, ...setting.settingsValue };
    }

    return defaults;
  }

  /**
   * ✅ حفظ إعداد في قاعدة البيانات
   * upsert: يُنشئ إذا لم يكن موجوداً، يُحدّث إذا كان موجوداً
   */
  private async setSetting(
    tenantId: string,
    storeId: string,
    key: string,
    value: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let setting = await this.settingsRepository.findOne({
      where: { tenantId, storeId, settingsKey: key },
    });

    if (setting) {
      setting.settingsValue = value;
    } else {
      setting = this.settingsRepository.create({
        tenantId,
        storeId,
        settingsKey: key,
        settingsValue: value,
      });
    }

    const saved = await this.settingsRepository.save(setting);
    this.logger.log(`✅ Settings saved: ${key}`, { tenantId, storeId });

    return saved.settingsValue;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // الإعدادات العامة
  // ═══════════════════════════════════════════════════════════════════════════════

  async getGeneralSettings(tenantId: string, storeId?: string) {
    const defaults = {
      storeName: 'متجر رفيق',
      storeUrl: 'https://store.example.com',
      timezone: 'Asia/Riyadh',
      language: 'ar',
      currency: 'SAR',
      logo: null,
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    };

    if (!storeId) return defaults;
    return this.getSetting(tenantId, storeId, 'general', defaults);
  }

  async updateGeneralSettings(tenantId: string, data: any, storeId?: string) {
    if (!storeId) {
      this.logger.warn('updateGeneralSettings called without storeId');
      return data;
    }

    const current = await this.getGeneralSettings(tenantId, storeId);
    const updated = { ...current, ...data };
    return this.setSetting(tenantId, storeId, 'general', updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إعدادات الإشعارات
  // ═══════════════════════════════════════════════════════════════════════════════

  async getNotificationSettings(tenantId: string, storeId?: string) {
    const defaults = {
      email: {
        newConversation: true,
        newMessage: false,
        dailyReport: true,
        weeklyReport: true,
      },
      push: {
        newConversation: true,
        newMessage: true,
        mentions: true,
      },
      sound: {
        enabled: true,
        volume: 80,
      },
    };

    if (!storeId) return defaults;
    return this.getSetting(tenantId, storeId, 'notifications', defaults);
  }

  async updateNotificationSettings(tenantId: string, data: any, storeId?: string) {
    if (!storeId) return data;

    const current = await this.getNotificationSettings(tenantId, storeId) as any;
    const updated = {
      email: { ...current.email, ...data.email },
      push: { ...current.push, ...data.push },
      sound: { ...current.sound, ...data.sound },
    };
    return this.setSetting(tenantId, storeId, 'notifications', updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ساعات العمل
  // ═══════════════════════════════════════════════════════════════════════════════

  async getWorkingHours(tenantId: string, storeId?: string) {
    const defaults = {
      enabled: true,
      timezone: 'Asia/Riyadh',
      schedule: [
        { day: 'sunday', enabled: true, start: '09:00', end: '21:00' },
        { day: 'monday', enabled: true, start: '09:00', end: '21:00' },
        { day: 'tuesday', enabled: true, start: '09:00', end: '21:00' },
        { day: 'wednesday', enabled: true, start: '09:00', end: '21:00' },
        { day: 'thursday', enabled: true, start: '09:00', end: '21:00' },
        { day: 'friday', enabled: false, start: '00:00', end: '00:00' },
        { day: 'saturday', enabled: true, start: '10:00', end: '18:00' },
      ],
      holidays: [],
    };

    if (!storeId) return defaults;
    return this.getSetting(tenantId, storeId, 'working_hours', defaults);
  }

  async updateWorkingHours(tenantId: string, data: any, storeId?: string) {
    if (!storeId) return data;

    const current = await this.getWorkingHours(tenantId, storeId);
    const updated = { ...current, ...data };
    return this.setSetting(tenantId, storeId, 'working_hours', updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // الردود التلقائية
  // ═══════════════════════════════════════════════════════════════════════════════

  async getAutoReplies(tenantId: string, storeId?: string) {
    const defaults = {
      welcomeMessage: {
        enabled: true,
        message: 'هلا والله! 👋 كيف أقدر أساعدك اليوم؟',
      },
      awayMessage: {
        enabled: true,
        message: 'شكراً لتواصلك. حالياً مو متواجدين، بنرد عليك بأقرب وقت.',
      },
      closedMessage: {
        enabled: true,
        message: 'شكراً لتواصلك! حالياً مقفلين. ساعات العمل: الأحد-الخميس 9ص-9م',
      },
      delayedResponse: {
        enabled: true,
        delayMinutes: 5,
        message: 'شكراً لانتظارك، بيتم الرد عليك قريب...',
      },
    };

    if (!storeId) return defaults;
    return this.getSetting(tenantId, storeId, 'auto_replies', defaults);
  }

  async updateAutoReplies(tenantId: string, data: any, storeId?: string) {
    if (!storeId) return data;

    const current = await this.getAutoReplies(tenantId, storeId);
    const updated = { ...current, ...data };
    return this.setSetting(tenantId, storeId, 'auto_replies', updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إعدادات الفريق
  // ═══════════════════════════════════════════════════════════════════════════════

  async getTeamSettings(tenantId: string, storeId?: string) {
    const defaults = {
      autoAssignment: {
        enabled: true,
        method: 'round_robin',
        maxConversationsPerAgent: 10,
      },
      idleTimeout: 30,
      allowAgentTakeOver: true,
      roles: [
        { id: 'admin', name: 'مدير', permissions: ['all'] },
        { id: 'supervisor', name: 'مشرف', permissions: ['view', 'assign', 'respond'] },
        { id: 'agent', name: 'وكيل', permissions: ['view', 'respond'] },
      ],
    };

    if (!storeId) return defaults;
    return this.getSetting(tenantId, storeId, 'team', defaults);
  }

  async updateTeamSettings(tenantId: string, data: any, storeId?: string) {
    if (!storeId) return data;

    const current = await this.getTeamSettings(tenantId, storeId);
    const updated = { ...current, ...data };
    return this.setSetting(tenantId, storeId, 'team', updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // جميع الإعدادات
  // ═══════════════════════════════════════════════════════════════════════════════

  async getAllSettings(tenantId: string, storeId?: string) {
    return {
      general: await this.getGeneralSettings(tenantId, storeId),
      notifications: await this.getNotificationSettings(tenantId, storeId),
      workingHours: await this.getWorkingHours(tenantId, storeId),
      autoReplies: await this.getAutoReplies(tenantId, storeId),
      team: await this.getTeamSettings(tenantId, storeId),
    };
  }
}
