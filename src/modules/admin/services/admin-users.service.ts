/**
 * AdminUsersService — Platform User Management
 * Audited 2026-02-21
 *
 * FIX [TS2305]: Removed IsolationLevel import — not exported in all TypeORM versions
 *   Used string literal 'SERIALIZABLE' directly (TypeORM accepts both)
 * FIX [TS2307]: argon2 requires: npm install argon2
 *
 * NOTE: This service operates on the PLATFORM users table (not admin_users)
 * Column names depend on the main app schema: users, tenants, stores
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
// ✅ FIX [TS2305]: IsolationLevel removed — use string literal directly
import { Repository, DataSource } from 'typeorm';
// ✅ FIX [TS2307]: requires npm install argon2
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { AuditService } from './audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { AdminUser } from '../entities/admin-user.entity';
import { MergeHistory, MergeStatus } from '../entities/merge-history.entity';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(MergeHistory)
    private readonly mergeHistoryRepository: Repository<MergeHistory>,

    private readonly auditService: AuditService,
  ) {}

  // ─── User Listing ──────────────────────────────────────────────────────────

  async getAllUsers(filters: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    role?: string;
    emailDomain?: string;
    hasMultipleStores?: boolean;
    newRegistrations?: boolean;
  }) {
    const { page = 1, limit = 50 } = filters;

    // ✅ WHERE conditions مبنية بشكل منفصل لتُطبَّق على query و count
    const whereConditions: string[] = ['1=1'];
    const params: any[] = [];
    let idx = 1;

    if (filters.search) {
      whereConditions.push(
        `(u.email ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx})`,
      );
      params.push(`%${filters.search}%`);
      idx++;
    }

    if (filters.status) {
      whereConditions.push(`u.status = $${idx}`);
      params.push(filters.status);
      idx++;
    }

    if (filters.role) {
      whereConditions.push(`u.role = $${idx}`);
      params.push(filters.role);
      idx++;
    }

    if (filters.emailDomain) {
      whereConditions.push(`u.email ILIKE $${idx}`);
      params.push(`%@${filters.emailDomain}`);
      idx++;
    }

    // ✅ newRegistrations في WHERE — وليس HAVING (صحيح semantically)
    if (filters.newRegistrations) {
      whereConditions.push(`u.created_at > NOW() - INTERVAL '7 days'`);
    }

    const whereClause = whereConditions.join(' AND ');

    // ✅ يُرجع stores كـ json array — لا يُرجع password أو refresh_token
    let dataQuery = `
      SELECT
        u.id, u.email, u.first_name, u.last_name, u.role, u.status,
        u.email_verified, u.last_login_at, u.created_at,
        t.id AS tenant_id, t.name AS tenant_name, t.status AS tenant_status,
        COUNT(DISTINCT s.id)::int AS store_count,
        json_agg(
          json_build_object('id', s.id, 'name', s.name, 'platform', s.platform, 'status', s.status)
        ) FILTER (WHERE s.id IS NOT NULL) AS stores
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN stores s ON s.tenant_id = t.id
      WHERE ${whereClause}
      GROUP BY u.id, t.id
    `;

    if (filters.hasMultipleStores) {
      dataQuery += ` HAVING COUNT(DISTINCT s.id) > 1`;
    }

    dataQuery += ` ORDER BY u.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    const dataParams = [...params, limit, (page - 1) * limit];

    // ✅ Count query يطبّق نفس الـ WHERE — pagination صحيح
    const baseCountQuery = `
      SELECT COUNT(DISTINCT u.id) AS count
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN stores s ON s.tenant_id = t.id
      WHERE ${whereClause}
    `;

    const finalCountQuery = filters.hasMultipleStores
      ? `SELECT COUNT(*) AS count FROM (${baseCountQuery} GROUP BY u.id HAVING COUNT(DISTINCT s.id) > 1) sub`
      : baseCountQuery;

    const [results, countResult] = await Promise.all([
      this.dataSource.query(dataQuery, dataParams),
      this.dataSource.query(finalCountQuery, params),
    ]);

    return {
      items: results,
      total: parseInt(countResult[0]?.count || '0'),
      page,
      limit,
    };
  }

  async getUserById(userId: string) {
    // ✅ أعمدة محددة صراحةً — لا password، لا refresh_token
    const [user] = await this.dataSource.query(
      `
      SELECT
        u.id, u.email, u.first_name, u.last_name, u.role, u.status,
        u.email_verified, u.phone, u.last_login_at, u.created_at, u.updated_at,
        u.tenant_id,
        t.name AS tenant_name, t.status AS tenant_status,
        json_agg(json_build_object(
          'id', s.id, 'name', s.name, 'platform', s.platform, 'status', s.status
        )) FILTER (WHERE s.id IS NOT NULL) AS stores
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN stores s ON s.tenant_id = t.id
      WHERE u.id = $1
      GROUP BY u.id, t.id
      `,
      [userId],
    );

    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  // ─── Suspend / Reactivate ──────────────────────────────────────────────────

  async suspendUser(userId: string, reason: string, admin: AdminUser, ipAddress: string) {
    const user = await this.getUserById(userId);

    await this.dataSource.query(
      `UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    // ✅ إلغاء كل الجلسات النشطة — المستخدم لا يستطيع الدخول فورًا
    await this.dataSource.query(
      `UPDATE users SET refresh_token = NULL WHERE id = $1`,
      [userId],
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.USER_SUSPENDED,
      targetType: 'user',
      targetId: userId,
      metadata: { reason, userEmail: user.email },
      ipAddress,
    });

    this.logger.log(`User ${userId} suspended by admin ${admin.email}`);
    return { success: true };
  }

  async reactivateUser(userId: string, admin: AdminUser, ipAddress: string) {
    await this.getUserById(userId); // يرمي NotFoundException إذا لم يُوجد

    await this.dataSource.query(
      `UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.USER_REACTIVATED,
      targetType: 'user',
      targetId: userId,
      ipAddress,
    });

    return { success: true };
  }

  // ─── Password Reset ────────────────────────────────────────────────────────

  async forcePasswordReset(userId: string, admin: AdminUser, ipAddress: string) {
    const user = await this.getUserById(userId);

    // كلمة مرور مؤقتة آمنة — 16 حرف base64url
    const tempPassword = randomBytes(12).toString('base64url');
    const hash = await argon2.hash(tempPassword, ARGON2_OPTIONS);

    await this.dataSource.query(
      `UPDATE users SET password = $1, refresh_token = NULL, updated_at = NOW() WHERE id = $2`,
      [hash, userId],
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.USER_PASSWORD_RESET,
      targetType: 'user',
      targetId: userId,
      metadata: { userEmail: user.email },
      ipAddress,
    });

    // ✅ tempPassword يُرسَل للمستخدم عبر قناة آمنة (WhatsApp/Email)
    // لا يُخزَّن في قاعدة البيانات
    return { tempPassword };
  }

  // ─── Email Change ──────────────────────────────────────────────────────────

  async changeUserEmail(userId: string, newEmail: string, admin: AdminUser, ipAddress: string) {
    const user = await this.getUserById(userId);

    // ✅ تحقق من عدم وجود حساب بنفس الإيميل
    const [existing] = await this.dataSource.query(
      `SELECT id FROM users WHERE email = $1 AND id != $2`,
      [newEmail, userId],
    );
    if (existing) throw new ConflictException(`Email ${newEmail} is already in use`);

    await this.dataSource.query(
      `UPDATE users SET email = $1, email_verified = false, refresh_token = NULL, updated_at = NOW() WHERE id = $2`,
      [newEmail, userId],
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.USER_EMAIL_CHANGED,
      targetType: 'user',
      targetId: userId,
      metadata: { oldEmail: user.email, newEmail },
      ipAddress,
    });

    return { success: true };
  }

  // ─── Soft Delete ───────────────────────────────────────────────────────────

  async softDeleteUser(userId: string, admin: AdminUser, ipAddress: string) {
    const user = await this.getUserById(userId);

    // ✅ anonymize الإيميل — لا حذف حقيقي للبيانات (GDPR-friendly)
    const anonymizedEmail = `deleted_${Date.now()}@deleted.rafeq.ai`;

    await this.dataSource.query(
      `UPDATE users SET
        status = 'inactive',
        email = $1,
        refresh_token = NULL,
        updated_at = NOW()
       WHERE id = $2`,
      [anonymizedEmail, userId],
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.USER_SOFT_DELETED,
      targetType: 'user',
      targetId: userId,
      metadata: { originalEmail: user.email },
      ipAddress,
    });

    return { success: true };
  }

  // ─── Account Merge ─────────────────────────────────────────────────────────

  async previewMerge(sourceUserId: string, targetUserId: string) {
    if (sourceUserId === targetUserId) {
      throw new BadRequestException('Cannot merge user with themselves');
    }

    const [source] = await this.dataSource.query(
      `SELECT id, email, status FROM users WHERE id = $1`, [sourceUserId],
    );
    const [target] = await this.dataSource.query(
      `SELECT id, email, status FROM users WHERE id = $1`, [targetUserId],
    );

    if (!source) throw new NotFoundException(`Source user ${sourceUserId} not found`);
    if (!target) throw new NotFoundException(`Target user ${targetUserId} not found`);

    const sourceStores = await this.dataSource.query(
      `SELECT s.id, s.name, s.platform FROM stores s
       JOIN tenants t ON t.id = s.tenant_id
       JOIN users u ON u.tenant_id = t.id
       WHERE u.id = $1`, [sourceUserId],
    );
    const targetStores = await this.dataSource.query(
      `SELECT s.id, s.name, s.platform FROM stores s
       JOIN tenants t ON t.id = s.tenant_id
       JOIN users u ON u.tenant_id = t.id
       WHERE u.id = $1`, [targetUserId],
    );

    const conflicts: string[] = [];
    if (source.status !== 'active') conflicts.push(`Source user status is '${source.status}'`);

    return {
      source: { id: source.id, email: source.email, status: source.status, stores: sourceStores },
      target: { id: target.id, email: target.email, status: target.status, stores: targetStores },
      storesToTransfer: sourceStores.length,
      conflicts,
      canMerge: conflicts.length === 0,
    };
  }

  async mergeAccounts(
    sourceUserId: string,
    targetUserId: string,
    admin: AdminUser,
    ipAddress: string,
  ) {
    const preview = await this.previewMerge(sourceUserId, targetUserId);

    if (!preview.canMerge) {
      throw new ConflictException(`Cannot merge: ${preview.conflicts.join('; ')}`);
    }

    const mergeRecord = this.mergeHistoryRepository.create({
      sourceUserId,
      sourceEmail: preview.source.email,
      targetUserId,
      targetEmail: preview.target.email,
      performedBy: admin.id,
      performedByEmail: admin.email,
      status: MergeStatus.PENDING,
    });
    const savedMerge = await this.mergeHistoryRepository.save(mergeRecord);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    // ✅ FIX [TS2305]: string literal مباشرة — لا حاجة لاستيراد IsolationLevel
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      // ✅ Advisory lock يمنع الـ concurrent merges على نفس المستخدمين
      await queryRunner.query(`SELECT pg_advisory_xact_lock($1)`, [this.hashForLock(sourceUserId)]);
      await queryRunner.query(`SELECT pg_advisory_xact_lock($1)`, [this.hashForLock(targetUserId)]);

      const [sourceUser] = await queryRunner.query(
        `SELECT tenant_id FROM users WHERE id = $1`, [sourceUserId],
      );
      const [targetUser] = await queryRunner.query(
        `SELECT tenant_id FROM users WHERE id = $1`, [targetUserId],
      );

      // نقل المتاجر من tenant المصدر → tenant الهدف
      const transferredStores = await queryRunner.query(
        `UPDATE stores SET tenant_id = $1, updated_at = NOW()
         WHERE tenant_id = $2 RETURNING id`,
        [targetUser.tenant_id, sourceUser.tenant_id],
      );

      const transferredIds: string[] = transferredStores.map((s: any) => s.id);

      // إلغاء تفعيل حساب المصدر وأنونيمايزيشن إيميله
      await queryRunner.query(
        `UPDATE users SET
          status = 'inactive',
          email = $1,
          refresh_token = NULL,
          updated_at = NOW()
         WHERE id = $2`,
        [`merged_${Date.now()}_${preview.source.email}`, sourceUserId],
      );

      await queryRunner.commitTransaction();

      await this.mergeHistoryRepository.update(savedMerge.id, {
        status: MergeStatus.COMPLETED,
        storesTransferred: transferredIds.length,
        transferredStoreIds: transferredIds,
      });

      await this.auditService.log({
        actor: admin,
        action: AuditAction.USER_MERGED,
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
          sourceUserId,
          sourceEmail: preview.source.email,
          targetEmail: preview.target.email,
          storesTransferred: transferredIds.length,
          mergeId: savedMerge.id,
        },
        ipAddress,
      });

      return {
        success: true,
        mergeId: savedMerge.id,
        storesTransferred: transferredIds.length,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.mergeHistoryRepository.update(savedMerge.id, {
        status: MergeStatus.FAILED,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      this.logger.error('Account merge failed — rolled back', { sourceUserId, targetUserId });
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Store Transfer ────────────────────────────────────────────────────────

  async transferStore(storeId: string, targetUserId: string, admin: AdminUser, ipAddress: string) {
    const [store] = await this.dataSource.query(
      `SELECT id, name, tenant_id FROM stores WHERE id = $1`,
      [storeId],
    );
    if (!store) throw new NotFoundException(`Store ${storeId} not found`);

    const [targetUser] = await this.dataSource.query(
      `SELECT id, tenant_id, email FROM users WHERE id = $1`,
      [targetUserId],
    );
    if (!targetUser) throw new NotFoundException(`User ${targetUserId} not found`);

    await this.dataSource.query(
      `UPDATE stores SET tenant_id = $1, updated_at = NOW() WHERE id = $2`,
      [targetUser.tenant_id, storeId],
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.STORE_TRANSFERRED,
      targetType: 'store',
      targetId: storeId,
      metadata: {
        storeName: store.name,
        fromTenantId: store.tenant_id,
        toTenantId: targetUser.tenant_id,
        toUserEmail: targetUser.email,
      },
      ipAddress,
    });

    return { success: true };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * يحوّل UUID إلى رقم int لاستخدامه في pg_advisory_xact_lock
   * يضمن نفس الـ lock لنفس الـ UUID في كل مرة
   */
  private hashForLock(uuid: string): number {
    let hash = 0;
    for (let i = 0; i < uuid.length; i++) {
      hash = (Math.imul(31, hash) + uuid.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
}
