import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AuditLog, AuditAction } from '../entities/audit-log.entity';
import { AdminUser } from '../entities/admin-user.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Input Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuditLogCreateInput {
  actor: AdminUser;
  action: AuditAction | string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface TenantAuditInput {
  actorId: string;
  actorEmail: string;
  actorRole?: string;
  tenantId?: string;
  tenantName?: string;
  storeName?: string;
  action: AuditAction | string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Ensure audit_logs table + new columns exist
  // ─────────────────────────────────────────────────────────────────────────
  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          actor_id      UUID        NOT NULL,
          actor_email   VARCHAR(255) NOT NULL,
          actor_role    VARCHAR(50)  NOT NULL,
          action        VARCHAR(100) NOT NULL,
          target_type   VARCHAR(100),
          target_id     VARCHAR(255),
          metadata      JSONB        NOT NULL DEFAULT '{}',
          ip_address    VARCHAR(45),
          user_agent    TEXT,
          created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          tenant_id     UUID,
          tenant_name   VARCHAR(255),
          store_name    VARCHAR(255)
        );
      `);

      // Add new columns if table existed before this update
      await this.dataSource.query(`
        ALTER TABLE audit_logs
          ADD COLUMN IF NOT EXISTS tenant_id   UUID,
          ADD COLUMN IF NOT EXISTS tenant_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS store_name  VARCHAR(255);
      `);

      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs (actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs (action);
        CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_logs (target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_tenant  ON audit_logs (tenant_id);
      `);

      // Immutability rules
      const ruleExists = await this.dataSource.query(`
        SELECT COUNT(*) AS cnt FROM pg_rules
        WHERE tablename = 'audit_logs'
          AND rulename IN ('no_update_audit', 'no_delete_audit')
      `);

      if (+ruleExists[0].cnt < 2) {
        await this.dataSource.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_rules WHERE tablename = 'audit_logs' AND rulename = 'no_update_audit'
            ) THEN
              CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM pg_rules WHERE tablename = 'audit_logs' AND rulename = 'no_delete_audit'
            ) THEN
              CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
            END IF;
          END $$;
        `);
      }

      this.logger.log('✅ audit_logs table ready (with tenant columns)');
    } catch (err) {
      this.logger.error('❌ Failed to initialize audit_logs table', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin audit log (existing — backward compatible)
  // ─────────────────────────────────────────────────────────────────────────
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
      this.logger.error('Failed to write admin audit log', {
        action: input.action,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tenant (merchant) audit log — NEW
  // ─────────────────────────────────────────────────────────────────────────
  async logTenant(input: TenantAuditInput): Promise<void> {
    try {
      const log = this.auditLogRepository.create({
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole || 'tenant',
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        storeName: input.storeName,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata || {},
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      await this.auditLogRepository.save(log);
    } catch (err) {
      this.logger.error('Failed to write tenant audit log', {
        action: input.action,
        tenantId: input.tenantId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query logs — supports both admin and tenant filters
  // ─────────────────────────────────────────────────────────────────────────
  async getAuditLogs(filters: {
    actorId?: string;
    tenantId?: string;
    targetType?: string;
    targetId?: string;
    action?: string;
    actionPrefix?: string;
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

    if (filters.actorId)      qb.andWhere('log.actorId = :actorId',       { actorId:    filters.actorId });
    if (filters.tenantId)     qb.andWhere('log.tenantId = :tenantId',     { tenantId:   filters.tenantId });
    if (filters.targetType)   qb.andWhere('log.targetType = :targetType', { targetType: filters.targetType });
    if (filters.targetId)     qb.andWhere('log.targetId = :targetId',     { targetId:   filters.targetId });
    if (filters.action)       qb.andWhere('log.action = :action',         { action:     filters.action });
    if (filters.actionPrefix) qb.andWhere('log.action LIKE :prefix',      { prefix:     `${filters.actionPrefix}%` });
    if (filters.from)         qb.andWhere('log.createdAt >= :from',       { from:       filters.from });
    if (filters.to)           qb.andWhere('log.createdAt <= :to',         { to:         filters.to });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }
}
