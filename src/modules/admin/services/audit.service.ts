import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction } from '../entities/audit-log.entity';
import { AdminUser } from '../entities/admin-user.entity';

export interface AuditLogCreateInput {
  actor: AdminUser;
  action: AuditAction | string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(input: AuditLogCreateInput): Promise<void> {
    try {
      const log = this.auditLogRepository.create({
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        actorRole: input.actor.role,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata || {},
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      await this.auditLogRepository.save(log);
    } catch (err) {
      // Never throw — audit logging failure should not break business logic
      this.logger.error('Failed to write audit log', {
        action: input.action,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  async getAuditLogs(filters: {
    actorId?: string;
    targetType?: string;
    targetId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 50 } = filters;

    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(Math.min(limit, 200));

    if (filters.actorId) qb.andWhere('log.actorId = :actorId', { actorId: filters.actorId });
    if (filters.targetType) qb.andWhere('log.targetType = :targetType', { targetType: filters.targetType });
    if (filters.targetId) qb.andWhere('log.targetId = :targetId', { targetId: filters.targetId });
    if (filters.action) qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.from) qb.andWhere('log.createdAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('log.createdAt <= :to', { to: filters.to });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }
}
