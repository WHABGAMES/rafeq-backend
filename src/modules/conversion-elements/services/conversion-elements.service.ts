/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Conversion Elements Service                          ║
 * ║                                                                                ║
 * ║  Core CRUD + business logic for conversion elements.                          ║
 * ║  Handles element lifecycle, validation, and public config delivery.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConversionElement, ElementStatus, TriggerType } from '../entities/conversion-element.entity';
import { ABTest, ABTestStatus } from '../entities/ab-test.entity';
import { Store } from '../../stores/entities/store.entity';
import { CreateElementDto, UpdateElementDto, CreateABTestDto } from '../dto';

@Injectable()
export class ConversionElementsService {
  private readonly logger = new Logger(ConversionElementsService.name);

  constructor(
    @InjectRepository(ConversionElement)
    private readonly elementRepo: Repository<ConversionElement>,

    @InjectRepository(ABTest)
    private readonly abTestRepo: Repository<ABTest>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  CRUD
  // ═══════════════════════════════════════════════════════════════

  async create(storeId: string, tenantId: string, dto: CreateElementDto): Promise<ConversionElement> {
    const store = await this.storeRepo.findOne({ where: { id: storeId, tenantId } });
    if (!store) throw new ForbiddenException('Store not found or access denied');

    const element = this.elementRepo.create({
      storeId,
      tenantId,
      name: dto.name,
      type: dto.type,
      position: dto.position,
      content: (dto.content || {}) as any,
      design: (dto.design || {}) as any,
      behavior: (dto.behavior || { trigger: TriggerType.IMMEDIATE }) as any,
      targeting: (dto.targeting || {}) as any,
      status: ElementStatus.DRAFT,
      platform: store.platform,
    });

    const saved = await this.elementRepo.save(element);
    this.logger.log(`Element created: ${saved.id} (${saved.type}) for store ${storeId}`);
    return saved;
  }

  async findAll(storeId: string, tenantId: string): Promise<ConversionElement[]> {
    return this.elementRepo.find({
      where: { storeId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<ConversionElement> {
    const element = await this.elementRepo.findOne({ where: { id, tenantId } });
    if (!element) throw new NotFoundException('Element not found');
    return element;
  }

  async update(id: string, tenantId: string, dto: UpdateElementDto): Promise<ConversionElement> {
    const element = await this.findOne(id, tenantId);

    // Merge JSONB fields (deep merge, not replace)
    if (dto.content) element.content = { ...element.content, ...dto.content };
    if (dto.design) element.design = { ...element.design, ...dto.design };
    if (dto.behavior) element.behavior = { ...element.behavior, ...dto.behavior };
    if (dto.targeting) element.targeting = { ...element.targeting, ...dto.targeting };

    if (dto.name !== undefined) element.name = dto.name;
    if (dto.status !== undefined) element.status = dto.status;
    if (dto.position !== undefined) element.position = dto.position;
    if (dto.startsAt !== undefined) element.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) element.endsAt = new Date(dto.endsAt);

    return this.elementRepo.save(element);
  }

  async updateStatus(id: string, tenantId: string, status: ElementStatus): Promise<ConversionElement> {
    const element = await this.findOne(id, tenantId);
    element.status = status;
    return this.elementRepo.save(element);
  }

  async duplicate(id: string, tenantId: string): Promise<ConversionElement> {
    const original = await this.findOne(id, tenantId);

    const clone = this.elementRepo.create({
      ...original,
      id: undefined,
      name: `${original.name} (نسخة)`,
      status: ElementStatus.DRAFT,
      totalViews: 0,
      totalClicks: 0,
      totalConversions: 0,
      totalRevenue: 0,
      abTestId: undefined,
      variantLabel: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      deletedAt: undefined,
    });

    return this.elementRepo.save(clone);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const element = await this.findOne(id, tenantId);
    await this.elementRepo.softRemove(element);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC CONFIG — called by embed.js from storefront
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns all ACTIVE elements for a store (called by embed script).
   * Accepts UUID or Salla merchant ID.
   */
  async getPublicElements(identifier: string): Promise<Record<string, unknown>[]> {
    const storeId = await this.resolveStoreId(identifier);
    if (!storeId) return [];

    const now = new Date();

    const elements = await this.elementRepo
      .createQueryBuilder('e')
      .where('e.store_id = :storeId', { storeId })
      .andWhere('e.status = :status', { status: ElementStatus.ACTIVE })
      .andWhere('(e.starts_at IS NULL OR e.starts_at <= :now)', { now })
      .andWhere('(e.ends_at IS NULL OR e.ends_at >= :now)', { now })
      .andWhere('e.deleted_at IS NULL')
      .orderBy('COALESCE((e.behavior->>\'priority\')::int, 0)', 'DESC')
      .getMany();

    // Map to lightweight public format (no internal IDs exposed)
    return elements.map(el => ({
      id: el.id,
      type: el.type,
      position: el.position,
      content: el.content,
      design: el.design,
      behavior: el.behavior,
      targeting: el.targeting,
      variant: el.variantLabel || null,
      abTestId: el.abTestId || null,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  //  A/B TESTING
  // ═══════════════════════════════════════════════════════════════

  async createABTest(storeId: string, tenantId: string, dto: CreateABTestDto): Promise<ABTest> {
    const [elA, elB] = await Promise.all([
      this.findOne(dto.elementAId, tenantId),
      this.findOne(dto.elementBId, tenantId),
    ]);

    if (elA.type !== elB.type) {
      throw new BadRequestException('A/B test variants must be the same element type');
    }

    const test = this.abTestRepo.create({
      storeId,
      tenantId,
      name: dto.name,
      elementAId: dto.elementAId,
      elementBId: dto.elementBId,
      trafficSplit: dto.trafficSplit || 50,
      minViewsPerVariant: dto.minViewsPerVariant || 100,
      status: ABTestStatus.RUNNING,
    });

    const saved = await this.abTestRepo.save(test);

    // Tag elements
    elA.abTestId = saved.id;
    elA.variantLabel = 'A';
    elA.status = ElementStatus.ACTIVE;

    elB.abTestId = saved.id;
    elB.variantLabel = 'B';
    elB.status = ElementStatus.ACTIVE;

    await this.elementRepo.save([elA, elB]);

    return saved;
  }

  async getABTests(storeId: string, tenantId: string): Promise<ABTest[]> {
    return this.abTestRepo.find({
      where: { storeId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async completeABTest(testId: string, tenantId: string, winnerVariant: 'A' | 'B'): Promise<ABTest> {
    const test = await this.abTestRepo.findOne({ where: { id: testId, tenantId } });
    if (!test) throw new NotFoundException('A/B test not found');

    test.status = ABTestStatus.COMPLETED;
    test.winnerVariant = winnerVariant;
    test.winnerElementId = winnerVariant === 'A' ? test.elementAId : test.elementBId;
    test.completedAt = new Date();

    // Deactivate loser
    const loserId = winnerVariant === 'A' ? test.elementBId : test.elementAId;
    await this.elementRepo.update(loserId, { status: ElementStatus.PAUSED });

    return this.abTestRepo.save(test);
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════

  private async resolveStoreId(identifier: string): Promise<string | null> {
    if (identifier.includes('-') && identifier.length > 30) return identifier;

    const numericId = parseInt(identifier, 10);
    if (!isNaN(numericId)) {
      const store = await this.storeRepo.findOne({
        where: { sallaMerchantId: numericId },
        select: ['id'],
      });
      return store?.id || null;
    }

    return null;
  }
}
