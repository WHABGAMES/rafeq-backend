/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Analytics Service                                ║
 * ║                                                                                ║
 * ║  📌 Business Logic للتحليلات والتقارير                                         ║
 * ║                                                                                ║
 * ║  ✅ جميع البيانات حقيقية من قاعدة البيانات — لا يوجد أي قيم hardcoded          ║
 * ║  ✅ byChannel: JOIN مع channels + normalize whatsapp_official/qr → whatsapp    ║
 * ║  ✅ byStatus: مفلتر بالتاريخ                                                   ║
 * ║  ✅ Team: وقت الرد + الحل + نسبة الحل — كلها حقيقية                            ║
 * ║  ✅ Overview: يقبل DateRange + مقارنة مع الفترة السابقة                         ║
 * ║  ✅ TypeORM: entity alias = property names, raw alias = SQL column names        ║
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
    change: number;
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
   * ✅ FIX #1: يقبل DateRange اختياري
   * ✅ FIX #2: responseTime.average — حقيقي من DB (كان hardcoded: 5)
   * ✅ FIX #3: responseTime.change — حقيقي من DB (كان hardcoded: -20)
   */
  async getOverview(tenantId: string, range?: DateRange): Promise<OverviewStats> {
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // الفترة الحالية (حسب الفلتر أو اليوم كاملاً)
    const currentStart = range?.startDate ?? today;
    const currentEnd = range?.endDate ?? now;

    // الفترة السابقة المماثلة (نفس المدة قبلها مباشرة)
    const periodMs = currentEnd.getTime() - currentStart.getTime();
    const previousStart = new Date(currentStart.getTime() - periodMs);
    const previousEnd = new Date(currentStart.getTime());

    // ─── المحادثات ───
    const conversationsCurrent = await this.conversationRepository.count({
      where: { tenantId, createdAt: Between(currentStart, currentEnd) },
    });
    const conversationsPrevious = await this.conversationRepository.count({
      where: { tenantId, createdAt: Between(previousStart, previousEnd) },
    });
    const conversationsToday = await this.conversationRepository.count({
      where: { tenantId, createdAt: MoreThanOrEqual(today) },
    });

    // ─── الرسائل ───
    const messagesCurrent = await this.messageRepository.count({
      where: { tenantId, createdAt: Between(currentStart, currentEnd) },
    });
    const messagesPrevious = await this.messageRepository.count({
      where: { tenantId, createdAt: Between(previousStart, previousEnd) },
    });
    const messagesToday = await this.messageRepository.count({
      where: { tenantId, createdAt: MoreThanOrEqual(today) },
    });

    // ─── العملاء ───
    const customersCurrent = await this.customerRepository.count({
      where: { tenantId, createdAt: Between(currentStart, currentEnd) },
    });
    const customersPrevious = await this.customerRepository.count({
      where: { tenantId, createdAt: Between(previousStart, previousEnd) },
    });
    const customersToday = await this.customerRepository.count({
      where: { tenantId, createdAt: MoreThanOrEqual(today) },
    });
    const totalCustomers = await this.customerRepository.count({
      where: { tenantId },
    });

    // ─── ✅ متوسط وقت الرد الحقيقي (بدل hardcoded 5) ───
    const avgResponseCurrent = await this.calculateAvgResponseTime(
      tenantId, currentStart, currentEnd,
    );
    const avgResponsePrevious = await this.calculateAvgResponseTime(
      tenantId, previousStart, previousEnd,
    );

    // ─── نسب التغيير ───
    const calcChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // ✅ لوقت الرد: انخفاض = تحسن = إيجابي (بدل hardcoded -20)
    const responseTimeChange = avgResponsePrevious === 0
      ? 0
      : Math.round(((avgResponsePrevious - avgResponseCurrent) / avgResponsePrevious) * 100);

    return {
      conversations: {
        total: conversationsCurrent,
        today: conversationsToday,
        change: calcChange(conversationsCurrent, conversationsPrevious),
      },
      messages: {
        total: messagesCurrent,
        today: messagesToday,
        change: calcChange(messagesCurrent, messagesPrevious),
      },
      customers: {
        total: totalCustomers,
        new: customersToday,
        change: calcChange(customersCurrent, customersPrevious),
      },
      responseTime: {
        average: avgResponseCurrent,
        change: responseTimeChange,
      },
    };
  }

  /**
   * ✅ حساب متوسط وقت الرد الحقيقي من DB
   *
   * conv = ENTITY alias (conversationRepository.createQueryBuilder)
   * → TypeORM resolves: conv.firstResponseAt → "conv"."first_response_at"
   * → TypeORM resolves: conv.createdAt → "conv"."created_at"
   */
  private async calculateAvgResponseTime(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const result = await this.conversationRepository
      .createQueryBuilder('conv')
      .select(
        'AVG(EXTRACT(EPOCH FROM (conv.firstResponseAt - conv.createdAt)) / 60)',
        'avgMinutes',
      )
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.createdAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .andWhere('conv.firstResponseAt IS NOT NULL')
      .getRawOne();

    const avg = parseFloat(result?.avgMinutes);
    return Number.isFinite(avg) ? Math.round(avg) : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 Conversation Stats
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ FIX #4: byChannel — JOIN مع channels table بدل UUID
   * ✅ FIX #5: byChannel — normalize whatsapp_official/whatsapp_qr → whatsapp
   * ✅ FIX #6: byStatus — مفلتر بالتاريخ
   *
   * conv = ENTITY alias → property names (conv.createdAt, conv.channelId)
   * ch = RAW TABLE alias → SQL column names (ch.id, ch.type)
   */
  async getConversationStats(
    tenantId: string,
    range: DateRange,
  ): Promise<ConversationStats> {
    // ─── المحادثات حسب اليوم ───
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

    // ─── ✅ FIX: المحادثات حسب القناة ───
    //
    // المشكلة الأصلية: conv.channel هو ManyToOne relation → يرجع UUID
    // Frontend CHANNEL_AR يتوقع: 'whatsapp', 'instagram', 'discord', etc.
    // Backend ChannelType: 'whatsapp_official', 'whatsapp_qr', 'instagram', etc.
    //
    // الحل: JOIN channels table → normalize whatsapp types
    //
    // conv = entity alias → conv.channelId resolves to conv.channel_id
    // ch = raw table alias → ch.id, ch.type are literal SQL column names
    const byChannelRaw = await this.conversationRepository
      .createQueryBuilder('conv')
      .innerJoin('channels', 'ch', 'ch.id = conv.channelId')
      .select(
        `CASE
          WHEN ch.type::text IN ('whatsapp_official', 'whatsapp_qr') THEN 'whatsapp'
          ELSE ch.type::text
        END`,
        'channel',
      )
      .addSelect('COUNT(*)', 'count')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.createdAt BETWEEN :start AND :end', {
        start: range.startDate,
        end: range.endDate,
      })
      .groupBy(
        `CASE
          WHEN ch.type::text IN ('whatsapp_official', 'whatsapp_qr') THEN 'whatsapp'
          ELSE ch.type::text
        END`,
      )
      .orderBy('count', 'DESC')
      .getRawMany();

    // ─── ✅ FIX: المحادثات حسب الحالة — مع فلتر تاريخ ───
    // الأصلي كان بدون فلتر تاريخ → يعرض كل البيانات من بداية الحساب
    const byStatus = await this.conversationRepository
      .createQueryBuilder('conv')
      .select('conv.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.createdAt BETWEEN :start AND :end', {
        start: range.startDate,
        end: range.endDate,
      })
      .groupBy('conv.status')
      .getRawMany();

    // ─── أوقات الذروة ───
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
      byChannel: byChannelRaw.map(c => ({
        channel: c.channel || 'other',
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
   * ✅ FIX #7:  avgResponseTime — حقيقي (كان hardcoded: 3)
   * ✅ FIX #8:  avgResolutionTime — حقيقي (كان hardcoded: 15)
   * ✅ FIX #9:  satisfactionRate — نسبة الحل الحقيقية (كان hardcoded: 95)
   * ✅ FIX #10: assignedAgentId → assigned_to_id (العمود الحقيقي)
   * ✅ FIX:     UserRole = owner, manager, agent, marketing (لا يوجد admin/support)
   *
   * ⚠️ TypeORM CONTEXT RULES:
   * user = ENTITY alias (userRepository.createQueryBuilder)
   *   → user.tenantId resolves → "user"."tenant_id"
   *   → user.firstName resolves → "user"."first_name"
   *   → user.lastName resolves → "user"."last_name"
   *   → user.role resolves → "user"."role"
   *
   * conv = RAW TABLE alias (leftJoin with string table name)
   *   → MUST use SQL column names:
   *     conv.assigned_to_id (NOT conv.assignedToId)
   *     conv.created_at (NOT conv.createdAt)
   *     conv.first_response_at (NOT conv.firstResponseAt)
   *     conv.resolved_at (NOT conv.resolvedAt)
   *     conv.status (same either way)
   *     conv.id (same either way)
   */
  async getTeamPerformance(
    tenantId: string,
    range: DateRange,
  ): Promise<TeamPerformance> {
    const agents = await this.userRepository
      .createQueryBuilder('user')
      // conv = RAW table alias → ALL conv columns use SQL names
      .leftJoin(
        'conversations',
        'conv',
        'conv.assigned_to_id = user.id AND conv.created_at BETWEEN :start AND :end',
        { start: range.startDate, end: range.endDate },
      )
      // user = entity alias → TypeORM resolves property names
      .select('user.id', 'id')
      .addSelect("CONCAT(user.firstName, ' ', user.lastName)", 'name')
      .addSelect('COUNT(conv.id)', 'conversationsHandled')
      // conv = raw alias → SQL column names in raw expressions
      .addSelect(
        'ROUND(AVG(EXTRACT(EPOCH FROM (conv.first_response_at - conv.created_at)) / 60))',
        'avgResponseTime',
      )
      .addSelect(
        'ROUND(AVG(EXTRACT(EPOCH FROM (conv.resolved_at - conv.created_at)) / 60))',
        'avgResolutionTime',
      )
      .addSelect(
        `CASE WHEN COUNT(conv.id) > 0
          THEN ROUND(
            COUNT(CASE WHEN conv.status IN ('resolved', 'closed') THEN 1 END)
            * 100.0 / COUNT(conv.id)
          )
          ELSE 0
        END`,
        'satisfactionRate',
      )
      .where('user.tenantId = :tenantId', { tenantId })
      // ✅ الأدوار الحقيقية من UserRole enum (لا يوجد admin أو support)
      .andWhere('user.role IN (:...roles)', {
        roles: ['owner', 'manager', 'agent', 'marketing'],
      })
      // PostgreSQL GROUP BY — primary key + explicit name columns
      .groupBy('user.id')
      .addGroupBy('user.firstName')
      .addGroupBy('user.lastName')
      .orderBy('COUNT(conv.id)', 'DESC')
      .getRawMany();

    return {
      agents: agents.map(a => ({
        id: a.id,
        name: a.name?.trim() || 'غير معروف',
        conversationsHandled: parseInt(a.conversationsHandled) || 0,
        avgResponseTime: parseInt(a.avgResponseTime) || 0,
        avgResolutionTime: parseInt(a.avgResolutionTime) || 0,
        satisfactionRate: parseInt(a.satisfactionRate) || 0,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📣 Campaign Stats
  // ═══════════════════════════════════════════════════════════════════════════════

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

  async getTrends(
    tenantId: string,
    metric: 'conversations' | 'messages' | 'customers',
    days: number = 30,
  ) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let queryBuilder;
    switch (metric) {
      case 'conversations':
        queryBuilder = this.conversationRepository.createQueryBuilder('entity');
        break;
      case 'messages':
        queryBuilder = this.messageRepository.createQueryBuilder('entity');
        break;
      case 'customers':
        queryBuilder = this.customerRepository.createQueryBuilder('entity');
        break;
    }

    const data = await queryBuilder
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
        data = await this.getOverview(tenantId, range);
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
        data = await this.getOverview(tenantId, range);
        filename = 'report';
    }

    if (format === 'csv') {
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

  private jsonToCsv(data: unknown): string {
    if (Array.isArray(data)) {
      if (data.length === 0) return '';
      const headers = Object.keys(data[0]);
      const rows = data.map(row =>
        headers
          .map(h => JSON.stringify((row as Record<string, unknown>)[h] ?? ''))
          .join(','),
      );
      return [headers.join(','), ...rows].join('\n');
    }

    const entries = Object.entries(data as Record<string, unknown>);
    return entries
      .map(([key, value]) => `${key},${JSON.stringify(value)}`)
      .join('\n');
  }
}
