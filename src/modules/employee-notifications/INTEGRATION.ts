/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  🔗 كود التكامل: إضافة emit('webhook.processed') في الـ Processor الحالي     ║
 * ║                                                                                ║
 * ║  هذا الكود يُضاف داخل الـ webhook processor الموجود (مثل salla-webhooks.       ║
 * ║  processor.ts) بعد المعالجة الناجحة لكل حدث.                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 *
 * مسار التدفق الكامل:
 *
 *   Salla API
 *     ↓ webhook HTTP POST
 *   SallaWebhooksController
 *     ↓ validates & calls
 *   SallaWebhooksService.queueWebhook()
 *     ↓ saves to DB + adds to Queue
 *     ↓ emit('webhook.received')      ← حدث موجود
 *   BullMQ Queue
 *     ↓ processes job
 *   SallaWebhookProcessor.process()
 *     ↓ handles the event (orders, customers, etc.)
 *     ↓ emit('webhook.processed')     ← ⭐ هذا اللي نضيفه
 *   NotificationEventListener
 *     ↓ catches 'webhook.processed'
 *   EmployeeNotificationsService.processEvent()
 *     ↓ finds matching rules → resolves recipients → renders templates
 *   NotificationQueue
 *     ↓ sends via channels (dashboard, email, whatsapp)
 *   ✅ Done
 */

// ═══════════════════════════════════════════════════════════
// أضف هذا في الـ webhook processor الحالي
// ═══════════════════════════════════════════════════════════

/*

// في ملف: salla-webhooks.processor.ts
// بعد المعالجة الناجحة لأي حدث:

import { EventEmitter2 } from '@nestjs/event-emitter';

// في الـ constructor:
constructor(
  private readonly eventEmitter: EventEmitter2,
  // ... باقي الـ dependencies
) { super(); }

// في نهاية process() بعد المعالجة الناجحة:
async process(job: Job<WebhookJobData>): Promise<void> {
  const { webhookEventId, eventType, data, tenantId, storeId } = job.data;

  try {
    // ... معالجة الحدث الحالية (الكود الموجود) ...

    // ⭐ أضف هذا السطر بعد المعالجة الناجحة:
    this.eventEmitter.emit('webhook.processed', {
      webhookEventId,
      eventType,
      tenantId,
      storeId,
      data,
    });

  } catch (error) {
    // ... error handling ...
  }
}

*/

// ═══════════════════════════════════════════════════════════
// أضف الـ Module في app.module.ts
// ═══════════════════════════════════════════════════════════

/*

// في ملف: app.module.ts
import { EmployeeNotificationsModule } from './modules/employee-notifications/employee-notifications.module';

@Module({
  imports: [
    // ... الموديولات الحالية ...
    EmployeeNotificationsModule,  // ⭐ أضف هذا
  ],
})
export class AppModule {}

*/

// ═══════════════════════════════════════════════════════════
// Migration: إنشاء الجداول في قاعدة البيانات
// ═══════════════════════════════════════════════════════════

/*

-- PostgreSQL Migration

CREATE TABLE notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_event VARCHAR(100) NOT NULL,
  channels TEXT NOT NULL,  -- simple-array: "dashboard,email,whatsapp"
  recipient_type VARCHAR(50) NOT NULL DEFAULT 'all_employees',
  specific_employee_ids TEXT,  -- JSON array
  target_roles TEXT,  -- JSON array
  dashboard_title VARCHAR(255),
  dashboard_template TEXT,
  email_subject VARCHAR(255),
  email_template TEXT,
  whatsapp_template TEXT,
  conditions TEXT,  -- JSON object
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 3,
  sent_count INT NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMP,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_rules_tenant_active ON notification_rules(tenant_id, is_active);
CREATE INDEX idx_notification_rules_tenant_event ON notification_rules(tenant_id, trigger_event);

CREATE TABLE employee_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  rule_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP,
  event_data TEXT,  -- JSON
  action_url VARCHAR(500),
  priority INT NOT NULL DEFAULT 3,
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  webhook_event_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_notifications_tenant_emp ON employee_notifications(tenant_id, employee_id, is_read);
CREATE INDEX idx_employee_notifications_tenant_date ON employee_notifications(tenant_id, created_at);
CREATE INDEX idx_employee_notifications_rule ON employee_notifications(rule_id);

*/

export {};
