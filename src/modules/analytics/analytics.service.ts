/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Analytics Service                                ║
 * ║                                                                                ║
 * ║  📌 Business Logic للتحليلات والتقارير                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';

import {
  Conversation,
  Message,
  Campaign,
  Customer,
  User,
} from '@database/entities';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📌 Types
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface OverviewStats {
  conversations: {
    total: number;
    today: number;
    change: number; // نسبة التغيير عن الأمس
  };
  messages: {
    total: number;
    today: number;
    change: number;
  };
  customers: {
    total: number;
    new: number;
    change: number;
  };
  responseTime: {
    average: number; // بالدقائق
    change: number;
  };
}

export interface ConversationStats {
  byDay: Array<{ date: string; count: number }>;
  byChannel: Array<{ channel: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
}

export interface TeamPerformance {
  agents: Array<{
    id: string;
    name: string;
    conversationsHandled: number;
    avgResponseTime: number;
    avgResolutionTime: number;
    satisfactionRate: number;
  }>;
}

export interface CampaignStats {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  deliveryRate: number;
  readRate: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Overview Stats
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب الإحصائيات العامة
   */
  async getOverview(tenantId: string): Promise<OverviewStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // محادثات اليوم
    const conversationsToday = await this.conversationRepository.count({
      where: {
        tenantId,
        createdAt: MoreThanOrEqual(today),
      },
    });

    // محادثات الأمس
    const conversationsYesterday = await this.conversationRepository.count({
      where: {
        tenantId,
        createdAt: Between(yesterday, today),
      },
    });

    // إجمالي المحادثات
    const totalConversations = await this.conversationRepository.count({
      where: { tenantId } as any,
    });

    // رسائل اليوم
    const messagesToday = await this.messageRepository.count({
      where: {
        tenantId,
        createdAt: MoreThanOrEqual(today),
      },
    });

    // رسائل الأمس
    const messagesYesterday = await this.messageRepository.count({
      where: {
        tenantId,
        createdAt: Between(yesterday, today),
      },
    });

    // إجمالي الرسائل
    const totalMessages = await this.messageRepository.count({
      where: { tenantId } as any,
    });

    // عملاء جدد اليوم
    const newCustomersToday = await this.customerRepository.count({
      where: {
        tenantId,
        createdAt: MoreThanOrEqual(today),
      } as any,
    });

    // عملاء جدد الأمس
    const newCustomersYesterday = await this.customerRepository.count({
      where: {
        tenantId,
        createdAt: Between(yesterday, today),
      } as any,
    });

    // إجمالي العملاء
    const totalCustomers = await this.customerRepository.count({
      where: { tenantId } as any,
    });

    // حساب نسب التغيير
    const calcChange = (today: number, yesterday: number): number => {
      if (yesterday === 0) return today > 0 ? 100 : 0;
      return Math.round(((today - yesterday) / yesterday) * 100);
    };

    return {
      conversations: {
        total: totalConversations,
        today: conversationsToday,
        change: calcChange(conversationsToday, conversationsYesterday),
      },
      messages: {
        total: totalMessages,
        today: messagesToday,
        change: calcChange(messagesToday, messagesYesterday),
      },
      customers: {
        total: totalCustomers,
        new: newCustomersToday,
        change: calcChange(newCustomersToday, newCustomersYesterday),
      },
      responseTime: {
        average: 5, // TODO: حساب فعلي
        change: -20, // TODO: حساب فعلي
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 Conversation Stats
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إحصائيات المحادثات
   */
  async getConversationStats(
    tenantId: string,
    range: DateRange,
  ): Promise<ConversationStats> {
    // المحادثات حسب اليوم
    const byDay = await this.conversationRepository
      .createQueryBuilder('conv')
      .select("DATE(conv.createdAt)", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.createdAt BETWEEN :start AND :end', {
        start: range.startDate,
        end: range.endDate,
      })
      .groupBy('DATE(conv.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    // المحادثات حسب القناة
    const byChannel = await this.conversationRepository
      .createQueryBuilder('conv')
      .select('conv.channel', 'channel')
      .addSelect('COUNT(*)', 'count')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.createdAt BETWEEN :start AND :end', {
        start: range.startDate,
        end: range.endDate,
      })
      .groupBy('conv.channel')
      .getRawMany();

    // المحادثات حسب الحالة
    const byStatus = await this.conversationRepository
      .createQueryBuilder('conv')
      .select('conv.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('conv.tenantId = :tenantId', { tenantId })
      .groupBy('conv.status')
      .getRawMany();

    // أوقات الذروة
    const peakHours = await this.conversationRepository
      .createQueryBuilder('conv')
      .select("EXTRACT(HOUR FROM conv.createdAt)", 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.createdAt BETWEEN :start AND :end', {
        start: range.startDate,
        end: range.endDate,
      })
      .groupBy("EXTRACT(HOUR FROM conv.createdAt)")
      .orderBy('count', 'DESC')
      .getRawMany();

    return {
      byDay: byDay.map(d => ({ date: d.date, count: parseInt(d.count) })),
      byChannel: byChannel.map(c => ({
        channel: c.channel,
        count: parseInt(c.count),
      })),
      byStatus: byStatus.map(s => ({
        status: s.status,
        count: parseInt(s.count),
      })),
      peakHours: peakHours.map(h => ({
        hour: parseInt(h.hour),
        count: parseInt(h.count),
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👥 Team Performance
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * أداء الفريق
   */
  async getTeamPerformance(
    tenantId: string,
    _range: DateRange,
  ): Promise<TeamPerformance> {
    // جلب الموظفين مع إحصائياتهم
    const agents = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('conversations', 'conv', 'conv.assignedAgentId = user.id')
      .select('user.id', 'id')
      .addSelect("CONCAT(user.firstName, ' ', user.lastName)", 'name')
      .addSelect('COUNT(conv.id)', 'conversationsHandled')
      .where('user.tenantId = :tenantId', { tenantId })
      .andWhere("user.role IN ('agent', 'manager')")
      .groupBy('user.id')
      .orderBy('conversationsHandled', 'DESC')
      .getRawMany();

    return {
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        conversationsHandled: parseInt(a.conversationsHandled) || 0,
        avgResponseTime: 3, // TODO: حساب فعلي
        avgResolutionTime: 15, // TODO: حساب فعلي
        satisfactionRate: 95, // TODO: حساب فعلي
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📣 Campaign Stats
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إحصائيات الحملات
   */
  async getCampaignStats(
    tenantId: string,
    range: DateRange,
  ): Promise<CampaignStats> {
    const campaigns = await this.campaignRepository.find({
      where: {
        tenantId,
        createdAt: Between(range.startDate, range.endDate),
      },
    });

    let total = 0;
    let sent = 0;
    let delivered = 0;
    let read = 0;

    for (const campaign of campaigns) {
      const stats = campaign.stats as unknown as Record<string, number>;
      total += stats?.totalTargeted || 0;
      sent += stats?.sent || 0;
      delivered += stats?.delivered || 0;
      read += stats?.read || 0;
    }

    return {
      total,
      sent,
      delivered,
      read,
      deliveryRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      readRate: delivered > 0 ? Math.round((read / delivered) * 100) : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📈 Trends
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب الاتجاهات (Trends)
   */
  async getTrends(
    tenantId: string,
    metric: 'conversations' | 'messages' | 'customers',
    days: number = 30,
  ) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let repository: Repository<any>;
    switch (metric) {
      case 'conversations':
        repository = this.conversationRepository;
        break;
      case 'messages':
        repository = this.messageRepository;
        break;
      case 'customers':
        repository = this.customerRepository;
        break;
    }

    const data = await repository
      .createQueryBuilder('entity')
      .select("DATE(entity.createdAt)", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('entity.tenantId = :tenantId', { tenantId })
      .andWhere('entity.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .groupBy('DATE(entity.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    return data.map(d => ({
      date: d.date,
      count: parseInt(d.count),
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Export
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تصدير تقرير
   */
  async exportReport(
    tenantId: string,
    reportType: string,
    range: DateRange,
    format: 'csv' | 'json' = 'json',
  ): Promise<{ data: string; filename: string; mimeType: string }> {
    let data: unknown;
    let filename: string;

    switch (reportType) {
      case 'overview':
        data = await this.getOverview(tenantId);
        filename = 'overview-report';
        break;
      case 'conversations':
        data = await this.getConversationStats(tenantId, range);
        filename = 'conversations-report';
        break;
      case 'team':
        data = await this.getTeamPerformance(tenantId, range);
        filename = 'team-performance-report';
        break;
      case 'campaigns':
        data = await this.getCampaignStats(tenantId, range);
        filename = 'campaigns-report';
        break;
      default:
        data = await this.getOverview(tenantId);
        filename = 'report';
    }

    if (format === 'csv') {
      // تحويل لـ CSV (مبسط)
      const csvContent = this.jsonToCsv(data);
      return {
        data: csvContent,
        filename: `${filename}.csv`,
        mimeType: 'text/csv',
      };
    }

    return {
      data: JSON.stringify(data, null, 2),
      filename: `${filename}.json`,
      mimeType: 'application/json',
    };
  }

  /**
   * تحويل JSON لـ CSV (مبسط)
   */
  private jsonToCsv(data: unknown): string {
    if (Array.isArray(data)) {
      if (data.length === 0) return '';
      const headers = Object.keys(data[0]);
      const rows = data.map(row =>
        headers.map(h => JSON.stringify((row as Record<string, unknown>)[h] ?? '')).join(','),
      );
      return [headers.join(','), ...rows].join('\n');
    }
    
    // للكائنات، نحولها لصفوف
    const entries = Object.entries(data as Record<string, unknown>);
    return entries.map(([key, value]) => `${key},${JSON.stringify(value)}`).join('\n');
  }
}
