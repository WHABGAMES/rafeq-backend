import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // 🚀 على بداية التطبيق — تأكد أن جدول audit_logs موجود في قاعدة البيانات
  //
  //  نستخدم IF NOT EXISTS لأن:
  //  ✅ آمن — لا يُدمّر بيانات موجودة
  //  ✅ لا يفشل إذا الجدول موجود مسبقاً
  //  ✅ synchronize=false لذا TypeORM لا يصنع الجداول تلقائياً
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
          created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
      `);

      // الـ Indexes — IF NOT EXISTS متوفرة في PostgreSQL 9.5+
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs (actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs (action);
        CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_logs (target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
      `);

      // قواعد الحماية — تمنع التعديل والحذف على سجلات التدقيق
      // CREATE RULE لا تدعم IF NOT EXISTS لذا نتحقق أولاً
      const ruleExists = await this.dataSource.query(`
        SELECT COUNT(*) AS cnt
        FROM pg_rules
        WHERE tablename = 'audit_logs'
          AND rulename IN ('no_update_audit', 'no_delete_audit')
      `);

      if (+ruleExists[0].cnt < 2) {
        await this.dataSource.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_rules
              WHERE tablename = 'audit_logs' AND rulename = 'no_update_audit'
            ) THEN
              CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
            END IF;

            IF NOT EXISTS (
              SELECT 1 FROM pg_rules
              WHERE tablename = 'audit_logs' AND rulename = 'no_delete_audit'
            ) THEN
              CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
            END IF;
          END $$;
        `);
      }

      this.logger.log('✅ audit_logs table ready');
    } catch (err) {
      // نُسجّل الخطأ ولكن لا نوقف التطبيق
      this.logger.error('❌ Failed to initialize audit_logs table', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // تسجيل حدث جديد في سجل التدقيق
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
      // لا نرمي خطأ — فشل التسجيل لا يجب أن يوقف العملية الأساسية
      this.logger.error('Failed to write audit log', {
        action: input.action,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // استرجاع سجلات التدقيق مع فلاتر
  // ─────────────────────────────────────────────────────────────────────────
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

    if (filters.actorId)    qb.andWhere('log.actorId = :actorId',       { actorId:    filters.actorId });
    if (filters.targetType) qb.andWhere('log.targetType = :targetType', { targetType: filters.targetType });
    if (filters.targetId)   qb.andWhere('log.targetId = :targetId',     { targetId:   filters.targetId });
    if (filters.action)     qb.andWhere('log.action = :action',         { action:     filters.action });
    if (filters.from)       qb.andWhere('log.createdAt >= :from',       { from:       filters.from });
    if (filters.to)         qb.andWhere('log.createdAt <= :to',         { to:         filters.to });

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }
}
