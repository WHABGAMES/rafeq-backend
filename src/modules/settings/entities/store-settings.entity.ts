/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Store Settings Entity                            ║
 * ║                                                                                ║
 * ║  ✅ إعدادات مخزّنة في قاعدة البيانات لكل متجر بشكل منفصل                      ║
 * ║  ✅ تبقى محفوظة حتى بعد إعادة النشر                                            ║
 * ║  ✅ كل متجر له إعداداته الخاصة المستقلة                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { Store } from '../../stores/entities/store.entity';

@Entity('store_settings')
@Unique(['storeId', 'settingsKey'])
@Index(['tenantId'])
@Index(['storeId'])
export class StoreSettings extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  /**
   * مفتاح الإعدادات
   * مثال: 'general', 'notifications', 'working_hours', 'auto_replies', 'team', 'ai'
   */
  @Column({ name: 'settings_key', type: 'varchar', length: 100 })
  settingsKey: string;

  /**
   * قيمة الإعدادات - JSONB مرن لأي نوع إعدادات
   */
  @Column({ name: 'settings_value', type: 'jsonb', default: {} })
  settingsValue: Record<string, unknown>;
}
