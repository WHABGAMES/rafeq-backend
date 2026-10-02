import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FEATURE_CATALOG } from './feature-catalog';

function readTypeScriptFiles(directory: string): string {
  return readdirSync(directory).map((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? readTypeScriptFiles(path)
      : path.endsWith('.ts') && !path.endsWith('.spec.ts')
        ? readFileSync(path, 'utf8')
        : '';
  }).join('\n');
}

describe('FEATURE_CATALOG', () => {
  it('contains unique keys and no orphaned child features', () => {
    const keys = FEATURE_CATALOG.map(feature => feature.key);
    expect(new Set(keys).size).toBe(keys.length);

    const keySet = new Set(keys);
    for (const feature of FEATURE_CATALOG) {
      if (feature.parentKey) expect(keySet.has(feature.parentKey)).toBe(true);
    }
  });

  it('covers every dashboard product section and its required branches', () => {
    const keys = new Set(FEATURE_CATALOG.map(feature => feature.key));
    const required = [
      'inbox', 'quick_replies', 'contacts',
      'templates', 'campaigns', 'whatsapp_widget', 'conversion_elements',
      'short_links', 'ai_assistant', 'otp',
      'channels', 'analytics', 'csat', 'staff_notifications', 'settings',
      'contacts.sync', 'ai_assistant.knowledge', 'otp.compensation',
      'channels.whatsapp', 'csat.responses', 'settings.general',
    ];

    for (const key of required) expect(keys.has(key)).toBe(true);
  });

  it('keeps child features out of the main navigation', () => {
    const children = FEATURE_CATALOG.filter(feature => feature.parentKey);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(feature => feature.showInNavigation === false)).toBe(true);
  });

  it('does not expose controls that cannot be enforced independently', () => {
    const keys = new Set(FEATURE_CATALOG.map(feature => feature.key));
    const unsupported = [
      'inbox.messages', 'customer_database.export', 'ai_assistant.settings',
      'otp.design', 'stores.connect', 'csat.surveys', 'staff.manage',
      'billing.plans', 'settings.account', 'suggestions.create',
      'campaigns.create', 'templates.create', 'analytics.export',
      'quick_replies.manage', 'otp.links', 'csat.analytics',
    ];

    for (const key of unsupported) expect(keys.has(key)).toBe(false);
  });

  it('backs every child feature with a server-side feature guard', () => {
    const source = readTypeScriptFiles(join(process.cwd(), 'src', 'modules'));
    const children = FEATURE_CATALOG.filter(feature => feature.parentKey);

    for (const feature of children) {
      expect(source).toContain(`RequirePlatformFeature('${feature.key}')`);
    }
  });
});
