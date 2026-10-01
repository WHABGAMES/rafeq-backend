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
  { key: 'dashboard', name: 'الرئيسية', category: 'core', route: '/dashboard', order: 10 },
  { key: 'inbox', name: 'المحادثات', category: 'communication', route: '/dashboard/inbox', order: 20, requiredPermission: 'conversations' },
  { key: 'quick_replies', name: 'الردود السريعة', category: 'communication', route: '/dashboard/quick-replies', order: 21 },
  { key: 'contacts', name: 'العملاء', category: 'communication', route: '/dashboard/contacts', order: 30, requiredPermission: 'contacts' },
  { key: 'customer_database', name: 'قاعدة بيانات العملاء', category: 'communication', route: '/dashboard/inbox/settings', order: 31 },
  { key: 'templates', name: 'القوالب', category: 'communication', route: '/dashboard/templates', order: 40, requiredPermission: 'templates', requiredPlanFeature: 'templates' },
  { key: 'campaigns', name: 'الحملات', category: 'growth', route: '/dashboard/campaigns', order: 50, requiredPermission: 'campaigns', requiredPlanFeature: 'campaigns' },
  { key: 'whatsapp_widget', name: 'ويدجت واتساب', category: 'growth', route: '/dashboard/widget', order: 60 },
  { key: 'conversion_elements', name: 'تحسين التحويل', category: 'growth', route: '/dashboard/conversion-elements', order: 70 },
  { key: 'short_links', name: 'الروابط المختصرة', category: 'growth', route: '/dashboard/short-links', order: 80 },
  { key: 'ai_assistant', name: 'موظف إسعاد العملاء', category: 'automation', route: '/dashboard/ai', order: 90, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'otp', name: 'رموز التحقق', category: 'automation', route: '/dashboard/otp', order: 100 },
  { key: 'stores', name: 'المتاجر', category: 'management', route: '/dashboard/stores', order: 110 },
  { key: 'store_settings', name: 'إعدادات المنصة', category: 'management', route: '/dashboard/store-settings', order: 120 },
  { key: 'channels', name: 'القنوات', category: 'management', route: '/dashboard/channels', order: 130 },
  { key: 'analytics', name: 'التحليلات', category: 'management', route: '/dashboard/analytics', order: 140, requiredPermission: 'analytics', requiredPlanFeature: 'advancedAnalytics' },
  { key: 'csat', name: 'رضا العملاء', category: 'management', route: '/dashboard/csat', order: 141 },
  { key: 'staff', name: 'الموظفون', category: 'management', route: '/dashboard/staff', order: 150, requiredPermission: 'staff' },
  { key: 'staff_notifications', name: 'تنبيهات الموظفين', category: 'management', route: '/dashboard/staff/notifications', order: 151 },
  { key: 'billing', name: 'الاشتراكات', category: 'management', route: '/dashboard/billing', order: 160 },
  { key: 'settings', name: 'الإعدادات', category: 'management', route: '/dashboard/settings', order: 170 },
  { key: 'suggestions', name: 'الاقتراحات', category: 'management', route: '/dashboard/suggestions', order: 180 },
  { key: 'campaigns.create', name: 'إنشاء حملة', category: 'growth', route: '/dashboard/campaigns', order: 501, parentKey: 'campaigns', showInNavigation: false, requiredPermission: 'campaigns', requiredPlanFeature: 'campaigns' },
  { key: 'campaigns.schedule', name: 'جدولة الحملات', category: 'growth', route: '/dashboard/campaigns', order: 502, parentKey: 'campaigns', showInNavigation: false, requiredPermission: 'campaigns', requiredPlanFeature: 'campaigns' },
  { key: 'campaigns.send', name: 'إرسال الحملات', category: 'growth', route: '/dashboard/campaigns', order: 503, parentKey: 'campaigns', showInNavigation: false, requiredPermission: 'campaigns', requiredPlanFeature: 'campaigns' },
  { key: 'campaigns.analytics', name: 'تقارير الحملات', category: 'growth', route: '/dashboard/campaigns', order: 504, parentKey: 'campaigns', showInNavigation: false, requiredPermission: 'campaigns', requiredPlanFeature: 'campaigns' },
  { key: 'templates.create', name: 'إنشاء القوالب', category: 'communication', route: '/dashboard/templates', order: 511, parentKey: 'templates', showInNavigation: false, requiredPermission: 'templates', requiredPlanFeature: 'templates' },
  { key: 'templates.edit', name: 'تعديل القوالب', category: 'communication', route: '/dashboard/templates', order: 512, parentKey: 'templates', showInNavigation: false, requiredPermission: 'templates', requiredPlanFeature: 'templates' },
  { key: 'ai_assistant.knowledge', name: 'قاعدة المعرفة', category: 'automation', route: '/dashboard/ai', order: 521, parentKey: 'ai_assistant', showInNavigation: false, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'ai_assistant.learning', name: 'التعلم الذاتي', category: 'automation', route: '/dashboard/ai', order: 522, parentKey: 'ai_assistant', showInNavigation: false, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'ai_assistant.auto_reply', name: 'الرد الآلي', category: 'automation', route: '/dashboard/ai', order: 523, parentKey: 'ai_assistant', showInNavigation: false, requiredPermission: 'ai', requiredPlanFeature: 'aiBot' },
  { key: 'analytics.overview', name: 'نظرة التحليلات العامة', category: 'management', route: '/dashboard/analytics', order: 531, parentKey: 'analytics', showInNavigation: false, requiredPermission: 'analytics', requiredPlanFeature: 'advancedAnalytics' },
  { key: 'analytics.team', name: 'تحليلات الفريق', category: 'management', route: '/dashboard/analytics', order: 532, parentKey: 'analytics', showInNavigation: false, requiredPermission: 'analytics', requiredPlanFeature: 'advancedAnalytics' },
  { key: 'analytics.export', name: 'تصدير التقارير', category: 'management', route: '/dashboard/analytics', order: 533, parentKey: 'analytics', showInNavigation: false, requiredPermission: 'analytics', requiredPlanFeature: 'advancedAnalytics' },
  { key: 'conversion_elements.manage', name: 'إدارة عناصر التحويل', category: 'growth', route: '/dashboard/conversion-elements', order: 541, parentKey: 'conversion_elements', showInNavigation: false },
  { key: 'conversion_elements.analytics', name: 'تحليلات عناصر التحويل', category: 'growth', route: '/dashboard/conversion-elements', order: 542, parentKey: 'conversion_elements', showInNavigation: false },
  { key: 'conversion_elements.ab_tests', name: 'اختبارات A/B', category: 'growth', route: '/dashboard/conversion-elements', order: 543, parentKey: 'conversion_elements', showInNavigation: false },
  { key: 'whatsapp_widget.settings', name: 'إعدادات ويدجت واتساب', category: 'growth', route: '/dashboard/widget', order: 551, parentKey: 'whatsapp_widget', showInNavigation: false },
] as const;
