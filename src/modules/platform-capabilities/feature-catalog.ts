export interface FeatureDefinition {
  key: string;
  name: string;
  category: 'core' | 'communication' | 'growth' | 'automation' | 'management';
  route: string;
  order: number;
  requiredPermission?: string;
  requiredPlanFeature?: string;
  parentKey?: string;
  showInNavigation?: boolean;
}

/**
 * Stable product capability identifiers. Database rows configure targeting;
 * this catalog owns immutable defaults and keeps existing features visible.
 */
export const FEATURE_CATALOG: readonly FeatureDefinition[] = [
  { key: 'inbox', name: 'المحادثات', category: 'communication', route: '/dashboard/inbox', order: 20, requiredPermission: 'conversations' },
  { key: 'quick_replies', name: 'الردود السريعة', category: 'communication', route: '/dashboard/quick-replies', order: 21 },
  { key: 'contacts', name: 'العملاء', category: 'communication', route: '/dashboard/contacts', order: 30, requiredPermission: 'contacts' },
  { key: 'templates', name: 'القوالب', category: 'communication', route: '/dashboard/templates', order: 40, requiredPermission: 'templates', requiredPlanFeature: 'templates' },
  { key: 'campaigns', name: 'الحملات', category: 'growth', route: '/dashboard/campaigns', order: 50, requiredPermission: 'campaigns', requiredPlanFeature: 'campaigns' },
  { key: 'whatsapp_widget', name: 'ويدجت واتساب', category: 'growth', route: '/dashboard/widget', order: 60 },
  { key: 'conversion_elements', name: 'تحسين التحويل', category: 'growth', route: '/dashboard/conversion-elements', order: 70 },
  { key: 'short_links', name: 'الروابط المختصرة', category: 'growth', route: '/dashboard/short-links', order: 80 },
  { key: 'ai_assistant', name: 'موظف إسعاد العملاء', category: 'automation', route: '/dashboard/ai', order: 90, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'otp', name: 'رموز التحقق', category: 'automation', route: '/dashboard/otp', order: 100 },
  { key: 'channels', name: 'القنوات', category: 'management', route: '/dashboard/channels', order: 130 },
  { key: 'analytics', name: 'التحليلات', category: 'management', route: '/dashboard/analytics', order: 140, requiredPermission: 'analytics', requiredPlanFeature: 'advancedAnalytics' },
  { key: 'csat', name: 'رضا العملاء', category: 'management', route: '/dashboard/csat', order: 141 },
  { key: 'staff_notifications', name: 'تنبيهات الموظفين', category: 'management', route: '/dashboard/staff/notifications', order: 151 },
  { key: 'settings', name: 'الإعدادات', category: 'management', route: '/dashboard/settings', order: 170 },
  { key: 'ai_assistant.knowledge', name: 'قاعدة المعرفة', category: 'automation', route: '/dashboard/ai', order: 521, parentKey: 'ai_assistant', showInNavigation: false, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'ai_assistant.learning', name: 'التعلم الذاتي', category: 'automation', route: '/dashboard/ai', order: 522, parentKey: 'ai_assistant', showInNavigation: false, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'contacts.manage', name: 'إدارة العملاء', category: 'communication', route: '/dashboard/contacts', order: 301, parentKey: 'contacts', showInNavigation: false, requiredPermission: 'contacts' },
  { key: 'contacts.sync', name: 'مزامنة العملاء', category: 'communication', route: '/dashboard/contacts', order: 302, parentKey: 'contacts', showInNavigation: false, requiredPermission: 'contacts' },
  { key: 'contacts.export', name: 'تصدير العملاء', category: 'communication', route: '/dashboard/contacts', order: 305, parentKey: 'contacts', showInNavigation: false, requiredPermission: 'contacts' },
  { key: 'short_links.manage', name: 'إدارة الروابط المختصرة', category: 'growth', route: '/dashboard/short-links', order: 801, parentKey: 'short_links', showInNavigation: false },
  { key: 'short_links.analytics', name: 'تحليلات الروابط المختصرة', category: 'growth', route: '/dashboard/short-links', order: 802, parentKey: 'short_links', showInNavigation: false },
  { key: 'otp.compensation', name: 'تعويض عمليات التحقق', category: 'automation', route: '/dashboard/otp', order: 1004, parentKey: 'otp', showInNavigation: false },
  { key: 'channels.whatsapp', name: 'قناة واتساب', category: 'management', route: '/dashboard/channels', order: 1301, parentKey: 'channels', showInNavigation: false },
  { key: 'channels.instagram', name: 'قناة إنستغرام', category: 'management', route: '/dashboard/channels', order: 1302, parentKey: 'channels', showInNavigation: false },
  { key: 'channels.discord', name: 'قناة ديسكورد', category: 'management', route: '/dashboard/channels', order: 1303, parentKey: 'channels', showInNavigation: false },
  { key: 'channels.store_assignment', name: 'ربط القنوات بالمتاجر', category: 'management', route: '/dashboard/channels', order: 1306, parentKey: 'channels', showInNavigation: false },
  { key: 'csat.overview', name: 'نظرة عامة على رضا العملاء', category: 'management', route: '/dashboard/csat', order: 1411, parentKey: 'csat', showInNavigation: false },
  { key: 'csat.responses', name: 'ردود رضا العملاء', category: 'management', route: '/dashboard/csat', order: 1412, parentKey: 'csat', showInNavigation: false },
  { key: 'csat.export', name: 'تصدير تقارير رضا العملاء', category: 'management', route: '/dashboard/csat', order: 1418, parentKey: 'csat', showInNavigation: false },
  { key: 'settings.general', name: 'الإعدادات العامة', category: 'management', route: '/dashboard/settings', order: 1702, parentKey: 'settings', showInNavigation: false },
  { key: 'settings.notifications', name: 'إعدادات التنبيهات', category: 'management', route: '/dashboard/settings', order: 1704, parentKey: 'settings', showInNavigation: false },
] as const;
