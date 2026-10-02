import { CsatController } from '../csat/csat.controller';
import { SettingsController } from '../settings/settings.controller';

jest.mock('../channels/channels.service', () => ({ ChannelsService: class {} }));
jest.mock('../channels/whatsapp/whatsapp-baileys.service', () => ({ WhatsAppBaileysService: class {} }));

import { ChannelsController } from '../channels/channels.controller';
import { ContactsController } from '../contacts/contacts.controller';
import { OtpRelayController } from '../otp-relay/otp-relay.controller';
import { ShortLinksController } from '../short-links/short-links.controller';
import { PLATFORM_FEATURE_KEY } from './platform-feature.decorator';

function requiredFeature(controller: object, method: string): string | undefined {
  const handler = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(controller), method)?.value as unknown;
  return Reflect.getMetadata(PLATFORM_FEATURE_KEY, handler as object) as string | undefined;
}

describe('platform subfeature endpoint coverage', () => {
  const csat = Object.create(CsatController.prototype) as CsatController;
  const settings = Object.create(SettingsController.prototype) as SettingsController;
  const channels = Object.create(ChannelsController.prototype) as ChannelsController;
  const contacts = Object.create(ContactsController.prototype) as ContactsController;
  const otp = Object.create(OtpRelayController.prototype) as OtpRelayController;
  const shortLinks = Object.create(ShortLinksController.prototype) as ShortLinksController;

  it.each([
    ['getSurveys', 'csat.responses'],
    ['getOverview', 'csat.overview'],
    ['exportSurveys', 'csat.export'],
  ])('protects CSAT %s with %s', (method, featureKey) => {
    expect(requiredFeature(csat, method)).toBe(featureKey);
  });

  it.each([
    ['getGeneralSettings', 'settings.general'],
    ['updateGeneralSettings', 'settings.general'],
    ['getNotificationSettings', 'settings.notifications'],
    ['updateNotificationSettings', 'settings.notifications'],
  ])('protects settings %s with %s', (method, featureKey) => {
    expect(requiredFeature(settings, method)).toBe(featureKey);
  });

  it.each([
    ['connectWhatsAppOfficial', 'channels.whatsapp'],
    ['initWhatsAppQR', 'channels.whatsapp'],
    ['connectInstagram', 'channels.instagram'],
    ['connectDiscord', 'channels.discord'],
    ['assignToStore', 'channels.store_assignment'],
    ['shareWithStores', 'channels.store_assignment'],
  ])('protects channel %s with %s', (method, featureKey) => {
    expect(requiredFeature(channels, method)).toBe(featureKey);
  });

  it.each([
    ['findAll', 'contacts.manage'],
    ['syncCustomers', 'contacts.sync'],
    ['getSegments', 'contacts'],
    ['importContacts', 'contacts'],
    ['exportContacts', 'contacts.export'],
  ])('protects contacts %s with %s', (method, featureKey) => {
    expect(requiredFeature(contacts, method)).toBe(featureKey);
  });

  it.each([
    ['getConfigs', 'otp'],
    ['test', 'otp'],
    ['analytics', 'otp'],
    ['listInventory', 'otp'],
    ['listCompensations', 'otp.compensation'],
  ])('protects OTP %s with %s', (method, featureKey) => {
    expect(requiredFeature(otp, method)).toBe(featureKey);
  });

  it.each([
    ['list', 'short_links.manage'],
    ['create', 'short_links.manage'],
    ['stats', 'short_links.analytics'],
    ['delete', 'short_links.manage'],
  ])('protects short links %s with %s', (method, featureKey) => {
    expect(requiredFeature(shortLinks, method)).toBe(featureKey);
  });
});
