import {
  Entity,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum InventoryStatus {
  AVAILABLE = 'available',
  ASSIGNED = 'assigned',
  EXPIRED = 'expired',
}

@Entity('otp_inventory_items')
@Index(['configId', 'status'])
@Index(['tenantId', 'configId'])
@Index(['assignedToOrder', 'configId'])
export class OtpInventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'config_id', type: 'uuid' })
  configId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'account_data', type: 'text' })
  accountData: string;

  @Column({ name: 'account_label', type: 'varchar', length: 100, nullable: true })
  accountLabel?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string;

  @Column({ type: 'enum', enum: InventoryStatus, default: InventoryStatus.AVAILABLE })
  status: InventoryStatus;

  @Column({ name: 'assigned_to_order', type: 'varchar', length: 100, nullable: true })
  assignedToOrder?: string;

  @Column({ name: 'assigned_to_username', type: 'varchar', length: 255, nullable: true })
  assignedToUsername?: string;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('otp_compensations')
@Index(['configId', 'orderNumber'])
@Index(['tenantId', 'createdAt'])
export class OtpCompensation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'config_id', type: 'uuid' })
  configId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'inventory_item_id', type: 'uuid' })
  inventoryItemId: string;

  @Column({ name: 'order_number', type: 'varchar', length: 100 })
  orderNumber: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username?: string;

  @Column({ name: 'account_data_snapshot', type: 'text' })
  accountDataSnapshot: string;

  @Column({ name: 'customer_name', type: 'varchar', length: 255, nullable: true })
  customerName?: string;

  @Column({ name: 'customer_phone', type: 'varchar', length: 20, nullable: true })
  customerPhone?: string;

  @Column({ name: 'client_ip', type: 'varchar', length: 50, nullable: true })
  clientIp?: string;

  // ── Method & Status ──
  @Column({ type: 'varchar', length: 20, default: 'auto', comment: 'manual | auto' })
  method: string;

  @Column({ type: 'varchar', length: 20, default: 'completed', comment: 'pending | completed | rejected' })
  status: string;

  @Column({ type: 'text', nullable: true, comment: 'سبب طلب التعويض (للطريقة اليدوية)' })
  reason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
