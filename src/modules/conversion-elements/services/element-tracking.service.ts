/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Element Tracking Service                             ║
 * ║                                                                                ║
 * ║  High-performance event ingestion for element interactions.                   ║
 * ║                                                                                ║
 * ║  Architecture:                                                                 ║
 * ║  1. HTTP endpoint receives events                                             ║
 * ║  2. StoreId resolved → UUID + tenantId (cached in memory)                     ║
 * ║  3. Events pushed to BullMQ queue (non-blocking, < 5ms response)              ║
 * ║  4. Worker adds events to thread-safe in-memory buffer                        ║
 * ║  5. Buffer flushed every 5s via atomic swap + batch INSERT                    ║
 * ║  6. Counter cache updated via atomic INCREMENT (real-time)                    ║
 * ║  7. Daily CRON rollup aggregates into element_analytics_daily                 ║
 * ║                                                                                ║
 * ║  ✅ Properly resolves Salla numeric IDs → UUID                                 ║
 * ║  ✅ Properly resolves tenantId from Store record                               ║
 * ║  ✅ Thread-safe buffer (atomic swap, no splice race)                           ║
 * ║  ✅ Implements OnModuleDestroy for graceful shutdown                           ║
 * ║  ✅ In-memory cache for store lookups (5min TTL)                               ║
 * ║  ✅ Chunk inserts (max 500 per query) to avoid query limits                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { ElementEvent, ElementEventType } from '../entities/element-event.entity';
import { ConversionElement } from '../entities/conversion-element.entity';
import { Store } from '../../stores/entities/store.entity';
import { TrackEventDto } from '../dto';

// Queue name constant — exported for module registration
export const ELEMENT_EVENTS_QUEUE = 'element-events';

/** Cached store lookup result */
interface StoreIdentity {
  storeId: string;
  tenantId: string;
}

@Injectable()
export class ElementTrackingService implements OnModuleDestroy {
  private readonly logger = new Logger(ElementTrackingService.name);

  // ─── Thread-safe buffer ────────────────────────────────────
  private eventBuffer: Partial<ElementEvent>[] = [];
  private bufferLock = false;
  private readonly flushInterval: NodeJS.Timeout;

  // ─── In-memory cache: identifier → resolved store identity ─
  // Avoids DB hit per tracking event. TTL: 5 minutes.
  private readonly storeCache = new Map<string, { data: StoreIdentity; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(ElementEvent)
    private readonly eventRepo: Repository<ElementEvent>,

    @InjectRepository(ConversionElement)
    private readonly elementRepo: Repository<ConversionElement>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,

    @InjectQueue(ELEMENT_EVENTS_QUEUE)
    private readonly eventQueue: Queue,
  ) {
    this.flushInterval = setInterval(() => this.flushBuffer(), 5000);
  }

  // ═══════════════════════════════════════════════════════════════
  //  STORE IDENTITY RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Resolves a store identifier (UUID or Salla numeric ID) to
   * the canonical { storeId (UUID), tenantId (UUID) } pair.
   *
   * Uses an in-memory cache with 5min TTL to avoid DB queries per event.
   */
  async resolveStoreIdentity(identifier: string): Promise<StoreIdentity | null> {
    // Check cache first
    const cached = this.storeCache.get(identifier);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    let store: Pick<Store, 'id' | 'tenantId'> | null = null;

    // UUID format — direct lookup
    if (identifier.includes('-') && identifier.length > 30) {
      store = await this.storeRepo.findOne({
        where: { id: identifier },
        select: ['id', 'tenantId'],
      });
    } else {
      // Salla numeric merchant ID — resolve via sallaMerchantId
      const numericId = parseInt(identifier, 10);
      if (!isNaN(numericId)) {
        store = await this.storeRepo.findOne({
          where: { sallaMerchantId: numericId } as any,
          select: ['id', 'tenantId'],
        });
      }
    }

    if (!store || !store.tenantId) {
      return null;
    }

    const identity: StoreIdentity = {
      storeId: store.id,
      tenantId: store.tenantId,
    };

    // Cache the resolution
    this.storeCache.set(identifier, {
      data: identity,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return identity;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENT INGESTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Track a single event — non-blocking, pushes to queue.
   * Called from the public tracking endpoint.
   *
   * @param identifier - Store UUID or Salla numeric merchant ID (raw from URL)
   */
  async trackEvent(identifier: string, dto: TrackEventDto): Promise<void> {
    // Validate event type
    if (!Object.values(ElementEventType).includes(dto.eventType as ElementEventType)) {
      return; // silently ignore unknown events
    }

    // Resolve store identity (UUID + tenantId)
    const identity = await this.resolveStoreIdentity(identifier);
    if (!identity) {
      return; // unknown store — silently ignore
    }

    await this.eventQueue.add('track', {
      storeId: identity.storeId,
      tenantId: identity.tenantId,
      ...dto,
      timestamp: new Date().toISOString(),
    }, {
      removeOnComplete: 100,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }

  /**
   * Track batch of events — for the embed script's batch endpoint.
   * Resolves store identity ONCE for the batch.
   * Up to 50 events per request.
   */
  async trackBatch(identifier: string, events: TrackEventDto[]): Promise<void> {
    // Resolve store identity ONCE for the entire batch
    const identity = await this.resolveStoreIdentity(identifier);
    if (!identity) return;

    const jobs = events.slice(0, 50).map((dto) => ({
      name: 'track',
      data: {
        storeId: identity.storeId,
        tenantId: identity.tenantId,
        ...dto,
        timestamp: new Date().toISOString(),
      },
      opts: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 1000 },
      },
    }));

    await this.eventQueue.addBulk(jobs);
  }

  /**
   * Called by the queue worker — processes a single event.
   * Adds to in-memory buffer for batch insert.
   */
  async processEvent(data: TrackEventDto & { storeId: string; tenantId: string; timestamp: string }): Promise<void> {
    const event: Partial<ElementEvent> = {
      storeId: data.storeId,
      tenantId: data.tenantId,
      elementId: data.elementId,
      eventType: data.eventType as ElementEventType,
      sessionId: data.sessionId,
      visitorId: data.visitorId,
      customerId: data.customerId,
      pageUrl: data.pageUrl,
      pageType: data.pageType,
      productId: data.productId,
      cartValue: data.cartValue,
      cartItems: data.cartItems,
      orderId: data.orderId,
      orderValue: data.orderValue,
      deviceType: data.deviceType,
      country: data.country,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      variantLabel: data.variantLabel,
      metadata: data.metadata,
    };

    this.eventBuffer.push(event);

    // Update real-time counters on the element (fire-and-forget)
    this.updateElementCounters(data.elementId, data.eventType as ElementEventType, data.orderValue)
      .catch(() => {}); // non-critical — counters reconciled by daily rollup
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUFFER FLUSH (THREAD-SAFE)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Flush in-memory buffer to database using bulk insert.
   *
   * Uses ATOMIC SWAP pattern: swap the buffer reference first,
   * then process the old buffer. This prevents race conditions
   * with concurrent processEvent calls from the BullMQ worker.
   */
  private async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;
    if (this.bufferLock) return; // prevent overlapping flushes

    this.bufferLock = true;

    // ATOMIC SWAP: grab current buffer, replace with empty array
    // Any new events arriving during flush go to the NEW array
    const batch = this.eventBuffer;
    this.eventBuffer = [];

    try {
      // Batch insert in chunks of 500 to avoid query size limits
      for (let i = 0; i < batch.length; i += 500) {
        const chunk = batch.slice(i, i + 500);
        await this.eventRepo
          .createQueryBuilder()
          .insert()
          .into(ElementEvent)
          .values(chunk as any)
          .execute();
      }

      if (batch.length > 10) {
        this.logger.log(`Flushed ${batch.length} element events to DB`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to flush ${batch.length} events: ${msg}`);
      // Re-add failed events to NEW buffer (with limit to prevent memory leak)
      if (this.eventBuffer.length + batch.length < 50000) {
        this.eventBuffer = [...batch, ...this.eventBuffer];
      } else {
        this.logger.error(`Dropping ${batch.length} events — buffer overflow protection (50K limit)`);
      }
    } finally {
      this.bufferLock = false;
    }
  }

  /**
   * Atomically increment cached counters on the element.
   * These are denormalized for fast dashboard reads.
   */
  private async updateElementCounters(
    elementId: string,
    eventType: ElementEventType,
    orderValue?: number,
  ): Promise<void> {
    switch (eventType) {
      case ElementEventType.VIEW:
        await this.elementRepo.increment({ id: elementId }, 'totalViews', 1);
        break;
      case ElementEventType.CLICK:
      case ElementEventType.CTA_CLICK:
        await this.elementRepo.increment({ id: elementId }, 'totalClicks', 1);
        break;
      case ElementEventType.PURCHASE:
        await this.elementRepo.increment({ id: elementId }, 'totalConversions', 1);
        if (orderValue) {
          await this.elementRepo.increment({ id: elementId }, 'totalRevenue', orderValue);
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  NestJS LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Graceful shutdown — flush remaining events before destroying.
   */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flushBuffer().catch((err) => {
      this.logger.error(`Final flush on shutdown failed: ${err.message}`);
    });
    this.logger.log(`ElementTrackingService destroyed. Buffer flushed.`);
  }
}
