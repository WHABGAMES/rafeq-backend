/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Settings Service                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  // In-memory storage (replace with database)
  private settings: Map<string, any> = new Map();

  /**
   * الإعدادات العامة
   */
  async getGeneralSettings(tenantId: string) {
    return this.settings.get(`${tenantId}:general`) || {
      storeName: 'متجر رفيق',
      storeUrl: 'https://store.example.com',
      timezone: 'Asia/Riyadh',
      language: 'ar',
      currency: 'SAR',
      logo: null,
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    };
  }

  async updateGeneralSettings(tenantId: string, data: any) {
    const current = await this.getGeneralSettings(tenantId);
    const updated = { ...current, ...data };
    this.settings.set(`${tenantId}:general`, updated);
    this.logger.log('General settings updated', { tenantId });
    return updated;
  }

  /**
   * إعدادات الإشعارات
   */
  async getNotificationSettings(tenantId: string) {
    return this.settings.get(`${tenantId}:notifications`) || {
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
  }

  async updateNotificationSettings(tenantId: string, data: any) {
    const current = await this.getNotificationSettings(tenantId);
    const updated = {
      email: { ...current.email, ...data.email },
      push: { ...current.push, ...data.push },
      sound: { ...current.sound, ...data.sound },
    };
    this.settings.set(`${tenantId}:notifications`, updated);
    this.logger.log('Notification settings updated', { tenantId });
    return updated;
  }

  /**
   * ساعات العمل
   */
  async getWorkingHours(tenantId: string) {
    return this.settings.get(`${tenantId}:working-hours`) || {
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
  }

  async updateWorkingHours(tenantId: string, data: any) {
    const current = await this.getWorkingHours(tenantId);
    const updated = { ...current, ...data };
    this.settings.set(`${tenantId}:working-hours`, updated);
    this.logger.log('Working hours updated', { tenantId });
    return updated;
  }

  /**
   * الردود التلقائية
   */
  async getAutoReplies(tenantId: string) {
    return this.settings.get(`${tenantId}:auto-replies`) || {
      welcomeMessage: {
        enabled: true,
        message: 'مرحباً بك! 👋 كيف يمكنني مساعدتك اليوم؟',
      },
      awayMessage: {
        enabled: true,
        message: 'شكراً لتواصلك معنا. نحن حالياً غير متواجدين، سنرد عليك في أقرب وقت ممكن.',
      },
      closedMessage: {
        enabled: true,
        message: 'شكراً لتواصلك! نحن مغلقون حالياً. ساعات العمل: الأحد-الخميس 9ص-9م',
      },
      delayedResponse: {
        enabled: true,
        delayMinutes: 5,
        message: 'شكراً لانتظارك، سيتم الرد عليك قريباً...',
      },
    };
  }

  async updateAutoReplies(tenantId: string, data: any) {
    const current = await this.getAutoReplies(tenantId);
    const updated = { ...current, ...data };
    this.settings.set(`${tenantId}:auto-replies`, updated);
    this.logger.log('Auto-replies updated', { tenantId });
    return updated;
  }

  /**
   * إعدادات الفريق
   */
  async getTeamSettings(tenantId: string) {
    return this.settings.get(`${tenantId}:team`) || {
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
  }

  async updateTeamSettings(tenantId: string, data: any) {
    const current = await this.getTeamSettings(tenantId);
    const updated = { ...current, ...data };
    this.settings.set(`${tenantId}:team`, updated);
    this.logger.log('Team settings updated', { tenantId });
    return updated;
  }

  /**
   * جميع الإعدادات
   */
  async getAllSettings(tenantId: string) {
    return {
      general: await this.getGeneralSettings(tenantId),
      notifications: await this.getNotificationSettings(tenantId),
      workingHours: await this.getWorkingHours(tenantId),
      autoReplies: await this.getAutoReplies(tenantId),
      team: await this.getTeamSettings(tenantId),
    };
  }
}
