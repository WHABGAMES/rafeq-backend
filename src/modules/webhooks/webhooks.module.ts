import { Store } from '../stores/entities/store.entity';

...
// Other existing imports here

TypeOrmModule.forFeature([
  WebhookEvent,
  WebhookLog,
  Order,
  Customer,
  ScheduledTemplateSend,
  Store,  // ✅ ADD THIS
]),
