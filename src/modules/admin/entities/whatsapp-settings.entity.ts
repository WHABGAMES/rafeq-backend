import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WhatsappProvider {
  META = 'meta',
  TWILIO = 'twilio',
  CUSTOM = 'custom',
}

@Entity('whatsapp_settings')
@Index(['tenantId'], { unique: true, where: '"tenant_id" IS NOT NULL' })
export class WhatsappSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * ✅ FIX: إضافة tenant_id لعزل إعدادات واتساب لكل تاجر
   *
   * كل تاجر لديه إعداداته الخاصة (رقم واتساب، توكن، إلخ)
   * بدون هذا الحقل، كل التجار يشاركون نفس الإعدادات!
   */
  @Column({
    name: 'tenant_id',
    type: 'uuid',
    nullable: true,
    comment: 'معرّف التاجر — كل تاجر لديه إعدادات واتساب مستقلة',
  })
  @Index()
  tenantId?: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 30 })
  phoneNumber: string;

  @Column({ type: 'enum', enum: WhatsappProvider, default: WhatsappProvider.META })
  provider: WhatsappProvider;

  /**
   * Encrypted access token — decrypted at runtime via EncryptionUtil
   */
  @Column({ name: 'access_token_encrypted', type: 'text' })
  accessTokenEncrypted: string;

  @Column({ name: 'business_account_id', type: 'varchar', length: 100, nullable: true })
  businessAccountId?: string;

  @Column({ name: 'phone_number_id', type: 'varchar', length: 100, nullable: true })
  phoneNumberId?: string;

  @Column({ name: 'webhook_url', type: 'varchar', length: 500, nullable: true })
  webhookUrl?: string;

  @Column({ name: 'webhook_verify_token', type: 'varchar', length: 255, nullable: true })
  webhookVerifyToken?: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ name: 'last_test_sent_at', type: 'timestamptz', nullable: true })
  lastTestSentAt?: Date;

  @Column({ name: 'connection_status', type: 'varchar', length: 50, default: 'unknown' })
  connectionStatus: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
