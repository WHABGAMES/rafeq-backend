/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Element Analytics Service                             ║
 * ║                                                                                ║
 * ║  Handles:                                                                      ║
 * ║  1. Dashboard queries (reads from pre-aggregated daily table)                 ║
 * ║  2. CRON job for daily rollup aggregation                                     ║
 * ║  3. Element comparison and funnel analysis                                    ║
 * ║  4. A/B test statistical analysis                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ElementAnalyticsDaily } from '../entities/element-analytics-daily.entity';
import { ConversionElement } from '../entities/conversion-element.entity';
import { ABTest, ABTestStatus } from '../entities/ab-test.entity';

@Injectable()
export class ElementAnalyticsService {
  private readonly logger = new Logger(ElementAnalyticsService.name);

  constructor(
    @InjectRepository(ElementAnalyticsDaily)
    private readonly dailyRepo: Repository<ElementAnalyticsDaily>,

    @InjectRepository(ConversionElement)
    private readonly elementRepo: Repository<ConversionElement>,

    @InjectRepository(ABTest)
    private readonly abTestRepo: Repository<ABTest>,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  DASHBOARD QUERIES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get overview stats for a store's conversion elements.
   */
  async getOverview(storeId: string, tenantId: string, startDate: string, endDate: string) {
    const daily = await this.dailyRepo
      .createQueryBuilder('d')
      .select([
        'SUM(d.views)::int AS "totalViews"',
        'SUM(d.clicks)::int AS "totalClicks"',
        'SUM(d.purchases)::int AS "totalPurchases"',
        'SUM(d.revenue)::numeric AS "totalRevenue"',
        'SUM(d.submits)::int AS "totalSubmits"',
        'SUM(d.add_to_carts)::int AS "totalAddToCarts"',
        'CASE WHEN SUM(d.views) > 0 THEN ROUND(SUM(d.clicks)::numeric / SUM(d.views) * 100, 2) ELSE 0 END AS "ctr"',
        'CASE WHEN SUM(d.views) > 0 THEN ROUND(SUM(d.purchases)::numeric / SUM(d.views) * 100, 2) ELSE 0 END AS "conversionRate"',
        'CASE WHEN SUM(d.purchases) > 0 THEN ROUND(SUM(d.revenue)::numeric / SUM(d.purchases), 2) ELSE 0 END AS "avgOrderValue"',
      ])
      .where('d.store_id = :storeId', { storeId })
      .andWhere('d.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    // Active elements count
    const activeCount = await this.elementRepo.count({
      where: { storeId, tenantId, status: 'active' as any },
    });

    return {
      ...daily,
      activeElements: activeCount,
    };
  }

  /**
   * Get daily time series for charts.
   */
  async getTimeSeries(
    storeId: string,
    startDate: string,
    endDate: string,
    elementId?: string,
  ) {
    const qb = this.dailyRepo
      .createQueryBuilder('d')
      .select([
        'd.date AS date',
        'SUM(d.views)::int AS views',
        'SUM(d.clicks)::int AS clicks',
        'SUM(d.purchases)::int AS purchases',
        'SUM(d.revenue)::numeric AS revenue',
        'CASE WHEN SUM(d.views) > 0 THEN ROUND(SUM(d.clicks)::numeric / SUM(d.views) * 100, 2) ELSE 0 END AS ctr',
        'CASE WHEN SUM(d.views) > 0 THEN ROUND(SUM(d.purchases)::numeric / SUM(d.views) * 100, 2) ELSE 0 END AS "conversionRate"',
      ])
      .where('d.store_id = :storeId', { storeId })
      .andWhere('d.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('d.date')
      .orderBy('d.date', 'ASC');

    if (elementId) {
      qb.andWhere('d.element_id = :elementId', { elementId });
    }

    return qb.getRawMany();
  }

  /**
   * Get per-element performance breakdown.
   */
  async getElementsPerformance(storeId: string, startDate: string, endDate: string) {
    return this.dailyRepo
      .createQueryBuilder('d')
      .select([
        'd.element_id AS "elementId"',
        'd.element_type AS "elementType"',
        'SUM(d.views)::int AS views',
        'SUM(d.clicks)::int AS clicks',
        'SUM(d.purchases)::int AS purchases',
        'SUM(d.revenue)::numeric AS revenue',
        'CASE WHEN SUM(d.views) > 0 THEN ROUND(SUM(d.clicks)::numeric / SUM(d.views) * 100, 2) ELSE 0 END AS ctr',
        'CASE WHEN SUM(d.views) > 0 THEN ROUND(SUM(d.purchases)::numeric / SUM(d.views) * 100, 2) ELSE 0 END AS "conversionRate"',
      ])
      .where('d.store_id = :storeId', { storeId })
      .andWhere('d.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('d.element_id')
      .addGroupBy('d.element_type')
      .orderBy('revenue', 'DESC')
      .getRawMany();
  }

  /**
   * Get funnel data: View → Click → Add to Cart → Purchase
   */
  async getFunnel(storeId: string, startDate: string, endDate: string, elementId?: string) {
    const qb = this.dailyRepo
      .createQueryBuilder('d')
      .select([
        'SUM(d.views)::int AS views',
        'SUM(d.clicks)::int AS clicks',
        'SUM(d.add_to_carts)::int AS "addToCarts"',
        'SUM(d.purchases)::int AS purchases',
      ])
      .where('d.store_id = :storeId', { storeId })
      .andWhere('d.date BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (elementId) {
      qb.andWhere('d.element_id = :elementId', { elementId });
    }

    const raw = await qb.getRawOne();

    const views = parseInt(raw.views) || 0;
    return {
      steps: [
        { name: 'المشاهدات', value: views, rate: 100 },
        { name: 'النقرات', value: parseInt(raw.clicks) || 0, rate: views > 0 ? Math.round(((parseInt(raw.clicks) || 0) / views) * 100) : 0 },
        { name: 'أُضيف للسلة', value: parseInt(raw.addToCarts) || 0, rate: views > 0 ? Math.round(((parseInt(raw.addToCarts) || 0) / views) * 100) : 0 },
        { name: 'شراء', value: parseInt(raw.purchases) || 0, rate: views > 0 ? Math.round(((parseInt(raw.purchases) || 0) / views) * 100) : 0 },
      ],
    };
  }

  /**
   * Get A/B test comparison data.
   */
  async getABTestResults(testId: string, tenantId: string) {
    const test = await this.abTestRepo.findOne({ where: { id: testId, tenantId } });
    if (!test) return null;

    const [variantA, variantB] = await Promise.all([
      this.getVariantStats(test.elementAId),
      this.getVariantStats(test.elementBId),
    ]);

    return {
      test,
      variantA: { label: 'A', elementId: test.elementAId, ...variantA },
      variantB: { label: 'B', elementId: test.elementBId, ...variantB },
      recommendation: this.calculateWinner(variantA, variantB, test),
    };
  }

  private async getVariantStats(elementId: string) {
    const raw = await this.dailyRepo
      .createQueryBuilder('d')
      .select([
        'SUM(d.views)::int AS views',
        'SUM(d.clicks)::int AS clicks',
        'SUM(d.purchases)::int AS purchases',
        'SUM(d.revenue)::numeric AS revenue',
      ])
      .where('d.element_id = :elementId', { elementId })
      .getRawOne();

    const views = parseInt(raw?.views) || 0;
    const clicks = parseInt(raw?.clicks) || 0;
    const purchases = parseInt(raw?.purchases) || 0;
    const revenue = parseFloat(raw?.revenue) || 0;

    return {
      views,
      clicks,
      purchases,
      revenue,
      ctr: views > 0 ? Math.round((clicks / views) * 10000) / 100 : 0,
      conversionRate: views > 0 ? Math.round((purchases / views) * 10000) / 100 : 0,
      avgOrderValue: purchases > 0 ? Math.round((revenue / purchases) * 100) / 100 : 0,
    };
  }

  private calculateWinner(a: any, b: any, test: ABTest) {
    const minViews = test.minViewsPerVariant;
    if (a.views < minViews || b.views < minViews) {
      return { ready: false, message: `يحتاج ${minViews} مشاهدة على الأقل لكل نسخة` };
    }

    // Simple Z-test for proportions
    const pA = a.conversionRate / 100;
    const pB = b.conversionRate / 100;
    const nA = a.views;
    const nB = b.views;
    const pPool = (pA * nA + pB * nB) / (nA + nB);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
    const z = se > 0 ? Math.abs(pA - pB) / se : 0;

    // Z-score to confidence level
    const confidence = z >= 2.58 ? 99 : z >= 1.96 ? 95 : z >= 1.645 ? 90 : Math.round(z * 38);

    const winner = a.conversionRate >= b.conversionRate ? 'A' : 'B';

    return {
      ready: true,
      winner,
      confidence,
      significant: confidence >= test.confidenceThreshold,
      message: confidence >= test.confidenceThreshold
        ? `النسخة ${winner} هي الأفضل بثقة ${confidence}%`
        : `لا يوجد فرق كافي بعد (ثقة ${confidence}%)`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  DAILY ROLLUP CRON
  // ═══════════════════════════════════════════════════════════════

  /**
   * Runs every hour — aggregates raw events into daily stats.
   * Idempotent: uses UPSERT (INSERT ON CONFLICT UPDATE).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async aggregateDailyStats(): Promise<void> {
    this.logger.log('Starting daily element analytics aggregation...');

    try {
      // Aggregate yesterday and today (handles timezone edge cases)
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      for (const date of [yesterday, today]) {
        await this.aggregateForDate(date);
      }

      this.logger.log('Daily element analytics aggregation completed');
    } catch (error: unknown) {
      const e = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Aggregation failed: ${e.message}`, e.stack);
    }
  }

  private async aggregateForDate(date: string): Promise<void> {
    const startOfDay = `${date} 00:00:00`;
    const endOfDay = `${date} 23:59:59`;

    // Raw SQL for efficient aggregation with UPSERT
    await this.dailyRepo.query(`
      INSERT INTO element_analytics_daily (
        id, store_id, tenant_id, element_id, element_type, variant_label, date,
        views, clicks, closes, submits, cta_clicks, add_to_carts, purchases,
        revenue, avg_order_value, ctr, conversion_rate,
        unique_visitors, unique_clickers, mobile_views, desktop_views,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        e.store_id,
        e.tenant_id,
        e.element_id,
        ce.type,
        e.variant_label,
        $1::date,
        COUNT(*) FILTER (WHERE e.event_type = 'element_view'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_click'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_close'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_submit'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_cta_click'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_add_to_cart'),
        COUNT(*) FILTER (WHERE e.event_type = 'purchase_from_element'),
        COALESCE(SUM(e.order_value) FILTER (WHERE e.event_type = 'purchase_from_element'), 0),
        CASE 
          WHEN COUNT(*) FILTER (WHERE e.event_type = 'purchase_from_element') > 0 
          THEN COALESCE(SUM(e.order_value) FILTER (WHERE e.event_type = 'purchase_from_element'), 0) 
               / COUNT(*) FILTER (WHERE e.event_type = 'purchase_from_element')
          ELSE 0
        END,
        CASE 
          WHEN COUNT(*) FILTER (WHERE e.event_type = 'element_view') > 0 
          THEN ROUND(COUNT(*) FILTER (WHERE e.event_type = 'element_click')::numeric 
               / COUNT(*) FILTER (WHERE e.event_type = 'element_view') * 100, 2)
          ELSE 0
        END,
        CASE 
          WHEN COUNT(*) FILTER (WHERE e.event_type = 'element_view') > 0 
          THEN ROUND(COUNT(*) FILTER (WHERE e.event_type = 'purchase_from_element')::numeric 
               / COUNT(*) FILTER (WHERE e.event_type = 'element_view') * 100, 2)
          ELSE 0
        END,
        COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'element_view'),
        COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'element_click'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_view' AND e.device_type = 'mobile'),
        COUNT(*) FILTER (WHERE e.event_type = 'element_view' AND e.device_type = 'desktop'),
        NOW(),
        NOW()
      FROM element_events e
      JOIN conversion_elements ce ON ce.id = e.element_id
      WHERE e.created_at >= $2::timestamptz
        AND e.created_at <= $3::timestamptz
      GROUP BY e.store_id, e.tenant_id, e.element_id, ce.type, e.variant_label
      ON CONFLICT (element_id, date)
      DO UPDATE SET
        views = EXCLUDED.views,
        clicks = EXCLUDED.clicks,
        closes = EXCLUDED.closes,
        submits = EXCLUDED.submits,
        cta_clicks = EXCLUDED.cta_clicks,
        add_to_carts = EXCLUDED.add_to_carts,
        purchases = EXCLUDED.purchases,
        revenue = EXCLUDED.revenue,
        avg_order_value = EXCLUDED.avg_order_value,
        ctr = EXCLUDED.ctr,
        conversion_rate = EXCLUDED.conversion_rate,
        unique_visitors = EXCLUDED.unique_visitors,
        unique_clickers = EXCLUDED.unique_clickers,
        mobile_views = EXCLUDED.mobile_views,
        desktop_views = EXCLUDED.desktop_views,
        updated_at = NOW()
    `, [date, startOfDay, endOfDay]);
  }

  /**
   * Auto-complete A/B tests when sufficient data exists.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async autoCompleteABTests(): Promise<void> {
    const runningTests = await this.abTestRepo.find({
      where: { status: ABTestStatus.RUNNING },
    });

    for (const test of runningTests) {
      try {
        const [a, b] = await Promise.all([
          this.getVariantStats(test.elementAId),
          this.getVariantStats(test.elementBId),
        ]);

        if (a.views >= test.minViewsPerVariant && b.views >= test.minViewsPerVariant) {
          const result = this.calculateWinner(a, b, test);
          if (result.ready && result.significant) {
            test.status = ABTestStatus.COMPLETED;
            test.winnerVariant = result.winner;
            test.winnerElementId = result.winner === 'A' ? test.elementAId : test.elementBId;
            test.confidenceLevel = result.confidence;
            test.completedAt = new Date();
            await this.abTestRepo.save(test);

            // Pause loser
            const loserId = result.winner === 'A' ? test.elementBId : test.elementAId;
            await this.elementRepo.update(loserId, { status: 'paused' as any });

            this.logger.log(`A/B test ${test.id} auto-completed: winner = ${result.winner}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to evaluate A/B test ${test.id}: ${msg}`);
      }
    }
  }
}
