/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Database Entities Index                    ║
 * ║                                                                                ║
 * ║  ✅ تم تصحيح جميع مسارات Import                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BASE ENTITY
// ═══════════════════════════════════════════════════════════════════════════════
export { BaseEntity } from './base.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// CORE ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════
export { Tenant, TenantStatus } from './tenant.entity';
export { User, UserStatus, UserRole, AuthProvider } from './user.entity';

// ✅ Store - يُستورد مباشرة من الموقع الجديد
export { Store, StoreStatus, StorePlatform } from '../../modules/stores/entities/store.entity';

export { Channel, ChannelType, ChannelStatus } from '../../modules/channels/entities/channel.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGING ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════
export { Conversation, ConversationStatus, ConversationPriority, ConversationHandler } from './conversation.entity';
export { Message, MessageDirection, MessageStatus, MessageType } from './message.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER & ORDER ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════
export { Customer, CustomerStatus, CustomerGender } from './customer.entity';
export { Order, OrderStatus } from './order.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════
export { Campaign, CampaignType, CampaignStatus } from './campaign.entity';
export { 
  MessageTemplate, 
  TemplateStatus, 
  TemplateCategory,
  TemplateChannel,
  TemplateLanguage,
  SendingMode,
} from './message-template.entity';
export type { TemplateSendSettings } from './message-template.entity';
export { ScheduledTemplateSend, ScheduledSendStatus } from './scheduled-template-send.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK ENTITY
// ═══════════════════════════════════════════════════════════════════════════════
export { WebhookEvent } from './webhook-event.entity';
export { WebhookLog, WebhookLogAction } from '../../modules/webhooks/entities/webhook-log.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════
export { SubscriptionPlan, PlanStatus } from './subscription-plan.entity';
export { Subscription, SubscriptionStatus, BillingInterval, PaymentProvider, UsageStats } from './subscription.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// ALL ENTITIES ARRAY
// ═══════════════════════════════════════════════════════════════════════════════
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
// ✅ Store - يُستورد مباشرة من الموقع الجديد
import { Store } from '../../modules/stores/entities/store.entity';
import { Channel } from '../../modules/channels/entities/channel.entity';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { Customer } from './customer.entity';
import { Order } from './order.entity';
import { Campaign } from './campaign.entity';
import { MessageTemplate } from './message-template.entity';
import { WebhookEvent } from './webhook-event.entity';
import { WebhookLog } from '../../modules/webhooks/entities/webhook-log.entity';
import { SubscriptionPlan } from './subscription-plan.entity';
import { Subscription } from './subscription.entity';
import { ScheduledTemplateSend } from './scheduled-template-send.entity';

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
  WebhookLog,
  SubscriptionPlan,
  Subscription,
  ScheduledTemplateSend,
];
