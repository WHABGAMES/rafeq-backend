/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Database Entities Index                    ║
 * ║                                                                                ║
 * ║  📌 هذا الملف يُصدّر كل الـ Entities من مكان واحد                                ║
 * ║                                                                                ║
 * ║  الاستخدام:                                                                     ║
 * ║  import { User, Tenant, Store, Customer } from '@database/entities';          ║
 * ║                                                                                ║
 * ║  📊 إحصائيات:                                                                   ║
 * ║  - 15 Entity إجمالي                                                           ║
 * ║  - 1 Base Entity (للوراثة)                                                    ║
 * ║  - 4 Core Entities (tenant, user, store, channel)                             ║
 * ║  - 2 Messaging Entities (conversation, message)                               ║
 * ║  - 2 Customer/Order Entities (customer, order)                                ║
 * ║  - 2 Campaign Entities (campaign, message-template)                           ║
 * ║  - 1 Webhook Entity (webhook-event)                                           ║
 * ║  - 2 Billing Entities (subscription-plan, subscription)                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BASE ENTITY - الكيان الأساسي الذي ترث منه كل الكيانات
// ═══════════════════════════════════════════════════════════════════════════════
export { BaseEntity } from './base.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// CORE ENTITIES - الكيانات الأساسية للنظام
// ═══════════════════════════════════════════════════════════════════════════════
export { Tenant, TenantStatus } from './tenant.entity';
export { User, UserStatus, UserRole } from './user.entity';
export { Store } from './store.entity';
export { Channel, ChannelType, ChannelStatus } from './channel.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGING ENTITIES - كيانات المحادثات والرسائل
// ═══════════════════════════════════════════════════════════════════════════════
export { Conversation, ConversationStatus, ConversationPriority, ConversationHandler } from './conversation.entity';
export { Message, MessageDirection, MessageStatus, MessageType } from './message.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER & ORDER ENTITIES - كيانات العملاء والطلبات
// ═══════════════════════════════════════════════════════════════════════════════
export { Customer } from './customer.entity';
export { Order, OrderStatus } from './order.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN ENTITIES - كيانات الحملات التسويقية
// ═══════════════════════════════════════════════════════════════════════════════
export { Campaign, CampaignType, CampaignStatus } from './campaign.entity';
export { MessageTemplate, TemplateStatus, TemplateCategory } from './message-template.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK ENTITY - كيان الـ Webhooks للـ Idempotency
// ═══════════════════════════════════════════════════════════════════════════════
export { WebhookEvent } from './webhook-event.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING ENTITIES - كيانات الفوترة والاشتراكات
// ═══════════════════════════════════════════════════════════════════════════════
export { SubscriptionPlan, PlanStatus } from './subscription-plan.entity';
export { Subscription, SubscriptionStatus, BillingInterval, PaymentProvider, UsageStats } from './subscription.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// ALL ENTITIES ARRAY - مصفوفة كل الكيانات (للـ TypeORM)
// ═══════════════════════════════════════════════════════════════════════════════
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { Store } from './store.entity';
import { Channel } from './channel.entity';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { Customer } from './customer.entity';
import { Order } from './order.entity';
import { Campaign } from './campaign.entity';
import { MessageTemplate } from './message-template.entity';
import { WebhookEvent } from './webhook-event.entity';
import { SubscriptionPlan } from './subscription-plan.entity';
import { Subscription } from './subscription.entity';

/**
 * 📋 مصفوفة كل الكيانات
 * تُستخدم في تكوين TypeORM
 */
export const allEntities = [
  Tenant,
  User,
  Store,
  Channel,
  Conversation,
  Message,
  Customer,
  Order,
  Campaign,
  MessageTemplate,
  WebhookEvent,
  SubscriptionPlan,
  Subscription,
];
