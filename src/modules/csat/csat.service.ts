/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - CSAT Service                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UpdateCsatSettingsDto, SubmitCsatDto } from './dto';

export interface CsatSettings {
  enabled: boolean;
  type: 'csat' | 'nps' | 'ces' | 'thumbs';
  question: string;
  questionAr: string;
  showAfter: 'conversation_closed' | 'agent_reply' | 'delay';
  delay?: number;
  followUpEnabled: boolean;
  followUpQuestion?: string;
  channels: string[];
}

export interface SurveyFilters {
  type?: string;
  rating?: number;
  agentId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

@Injectable()
export class CsatService {
  private readonly logger = new Logger(CsatService.name);
  
  private settings: Map<string, CsatSettings> = new Map();
  private surveys: Map<string, any> = new Map();

  async getSettings(tenantId: string): Promise<CsatSettings> {
    const settings = this.settings.get(tenantId);

    if (!settings) {
      return {
        enabled: true,
        type: 'csat',
        question: 'How would you rate your experience?',
        questionAr: 'كيف تقيم تجربتك معنا؟',
        showAfter: 'conversation_closed',
        followUpEnabled: true,
        followUpQuestion: 'كيف يمكننا تحسين خدمتنا؟',
        channels: ['whatsapp', 'instagram', 'telegram', 'webchat'],
      };
    }

    return settings;
  }

  async updateSettings(tenantId: string, dto: UpdateCsatSettingsDto): Promise<CsatSettings> {
    const currentSettings = await this.getSettings(tenantId);

    const newSettings: CsatSettings = {
      ...currentSettings,
      ...dto,
    };

    this.settings.set(tenantId, newSettings);

    this.logger.log(`CSAT settings updated`, { tenantId });

    return newSettings;
  }

  async getSurveys(tenantId: string, filters: SurveyFilters) {
    const { page, limit } = filters;

    let surveys = Array.from(this.surveys.values())
      .filter((s) => s.tenantId === tenantId);

    if (filters.type) {
      surveys = surveys.filter((s) => s.type === filters.type);
    }

    if (filters.rating !== undefined) {
      surveys = surveys.filter((s) => s.rating === filters.rating);
    }

    if (filters.agentId) {
      surveys = surveys.filter((s) => s.agentId === filters.agentId);
    }

    surveys.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = surveys.length;
    const start = (page - 1) * limit;
    const data = surveys.slice(start, start + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSurveyById(id: string, tenantId: string) {
    const survey = this.surveys.get(id);

    if (!survey || survey.tenantId !== tenantId) {
      throw new NotFoundException('التقييم غير موجود');
    }

    return survey;
  }

  async submitSurvey(token: string, dto: SubmitCsatDto) {
    const context = this.decodeToken(token);

    const surveyId = `survey-${Date.now()}`;

    const survey = {
      id: surveyId,
      tenantId: context.tenantId,
      conversationId: context.conversationId,
      customerId: context.customerId,
      agentId: context.agentId,
      type: dto.type || 'csat',
      rating: dto.rating,
      feedback: dto.feedback,
      createdAt: new Date(),
    };

    this.surveys.set(surveyId, survey);

    this.logger.log(`CSAT survey submitted`, {
      surveyId,
      rating: dto.rating,
    });

    return {
      success: true,
      message: 'شكراً لك على تقييمك!',
      surveyId,
    };
  }

  async getAnalytics(
    tenantId: string,
    params: { period: string; from?: string; to?: string },
  ) {
    const surveys = Array.from(this.surveys.values())
      .filter((s) => s.tenantId === tenantId);

    const totalSurveys = surveys.length;
    const ratings = surveys.map((s) => s.rating).filter((r) => r !== undefined);

    const avgCsat = ratings.length > 0
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0;

    const distribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: ratings.filter((r) => r === rating).length,
      percentage: totalSurveys > 0
        ? (ratings.filter((r) => r === rating).length / totalSurveys) * 100
        : 0,
    }));

    const totalConversations = 100;
    const responseRate = totalConversations > 0
      ? (totalSurveys / totalConversations) * 100
      : 0;

    return {
      summary: {
        totalSurveys,
        averageRating: Math.round(avgCsat * 100) / 100,
        responseRate: Math.round(responseRate * 100) / 100,
        satisfiedCustomers: ratings.filter((r) => r >= 4).length,
        unsatisfiedCustomers: ratings.filter((r) => r <= 2).length,
      },
      distribution,
      period: params.period,
    };
  }

  async getAgentRatings(
    tenantId: string,
    _params: { from?: string; to?: string },
  ) {
    const surveys = Array.from(this.surveys.values())
      .filter((s) => s.tenantId === tenantId && s.agentId);

    const agentMap = new Map<string, number[]>();

    for (const survey of surveys) {
      if (!agentMap.has(survey.agentId)) {
        agentMap.set(survey.agentId, []);
      }
      agentMap.get(survey.agentId)!.push(survey.rating);
    }

    const agentRatings = Array.from(agentMap.entries()).map(([agentId, ratings]) => ({
      agentId,
      totalSurveys: ratings.length,
      averageRating: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100,
      satisfiedCount: ratings.filter((r) => r >= 4).length,
      unsatisfiedCount: ratings.filter((r) => r <= 2).length,
    }));

    agentRatings.sort((a, b) => b.averageRating - a.averageRating);

    return {
      agents: agentRatings,
      total: agentRatings.length,
    };
  }

  async getTrends(
    _tenantId: string,
    params: { period: string; groupBy: 'day' | 'week' | 'month' },
  ) {
    return {
      trends: [],
      period: params.period,
      groupBy: params.groupBy,
    };
  }

  async exportSurveys(
    _tenantId: string,
    _params: { format: string; from?: string; to?: string },
  ) {
    return {
      success: true,
      downloadUrl: '/api/v1/csat/export/download/file-id',
      expiresAt: new Date(Date.now() + 3600000),
    };
  }

  async createSurveyLink(
    tenantId: string,
    conversationId: string,
    customerId: string,
    agentId?: string,
  ): Promise<string> {
    const token = this.generateToken({
      tenantId,
      conversationId,
      customerId,
      agentId,
    });

    return `https://app.rafiq.ai/csat/${token}`;
  }

  private generateToken(data: any): string {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  private decodeToken(token: string): any {
    try {
      return JSON.parse(Buffer.from(token, 'base64').toString());
    } catch {
      return {};
    }
  }
}
