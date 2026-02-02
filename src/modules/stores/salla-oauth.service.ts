/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║     RAFEQ - تحديث handleAppStoreAuthorize في salla-oauth.service.ts          ║
 * ║                                                                                ║
 * ║  📌 أضف هذا الكود بدلاً من الـ method الحالي                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1️⃣ أضف هذا الـ import في الأعلى
// ═══════════════════════════════════════════════════════════════════════════════

import { AutoRegistrationService } from '../auth/auto-registration.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 2️⃣ أضف في الـ constructor
// ═══════════════════════════════════════════════════════════════════════════════

private readonly autoRegistrationService: AutoRegistrationService,

// ═══════════════════════════════════════════════════════════════════════════════
// 3️⃣ استبدل method handleAppStoreAuthorize بالتالي
// ═══════════════════════════════════════════════════════════════════════════════

async handleAppStoreAuthorize(
  merchantId: number,
  data: SallaAppAuthorizeData,
  createdAt: string,
): Promise<Store> {
  this.logger.log(`🚀 App Store authorize for merchant ${merchantId}`, { createdAt });

  const merchantInfo = await this.fetchMerchantInfo(data.access_token);
  let store = await this.storeRepository.findOne({ where: { sallaMerchantId: merchantId } });
  const expiresIn = data.expires || 3600;

  if (store) {
    // ════════════════════════════════════════════════════════════════
    // 📦 المتجر موجود - تحديث البيانات
    // ════════════════════════════════════════════════════════════════
    if (!store.tenantId) {
      const tenant = await this.tenantsService.createTenantFromSalla({
        merchantId,
        name: merchantInfo.name || merchantInfo.username || `متجر سلة`,
        email: merchantInfo.email,
        phone: merchantInfo.mobile,
        logo: merchantInfo.avatar,
        website: merchantInfo.domain,
      });
      store.tenantId = tenant.id;
    }
    
    store.accessToken = data.access_token;
    store.refreshToken = data.refresh_token;
    store.tokenExpiresAt = this.calculateTokenExpiry(expiresIn);
    store.lastTokenRefreshAt = new Date();
    store.status = StoreStatus.ACTIVE;
    store.consecutiveErrors = 0;
    store.lastError = undefined;
    store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
    store.sallaEmail = merchantInfo.email || store.sallaEmail;
    store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
    store.sallaDomain = merchantInfo.domain || store.sallaDomain;
    store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
    store.sallaPlan = merchantInfo.plan || store.sallaPlan;
    
    this.logger.log(`📦 Updated store for merchant ${merchantId}`);
  } else {
    // ════════════════════════════════════════════════════════════════
    // 🆕 متجر جديد - إنشاء Tenant + Store
    // ════════════════════════════════════════════════════════════════
    const tenant = await this.tenantsService.createTenantFromSalla({
      merchantId,
      name: merchantInfo.name || merchantInfo.username || `متجر سلة`,
      email: merchantInfo.email,
      phone: merchantInfo.mobile,
      logo: merchantInfo.avatar,
      website: merchantInfo.domain,
    });

    store = this.storeRepository.create({
      tenantId: tenant.id,
      name: merchantInfo.name || merchantInfo.username || `متجر سلة`,
      platform: StorePlatform.SALLA,
      status: StoreStatus.ACTIVE,
      sallaMerchantId: merchantId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: this.calculateTokenExpiry(expiresIn),
      sallaStoreName: merchantInfo.name,
      sallaEmail: merchantInfo.email,
      sallaMobile: merchantInfo.mobile,
      sallaDomain: merchantInfo.domain,
      sallaAvatar: merchantInfo.avatar,
      sallaPlan: merchantInfo.plan,
      lastSyncedAt: new Date(),
      settings: {},
      subscribedEvents: [],
    });

    this.logger.log(`🆕 Created new store for merchant ${merchantId}`);
  }

  const savedStore = await this.storeRepository.save(store);

  // ════════════════════════════════════════════════════════════════
  // 👤 إنشاء/تحديث المستخدم + إرسال بيانات الدخول
  // ════════════════════════════════════════════════════════════════
  try {
    const result = await this.autoRegistrationService.handleAppInstallation(
      {
        merchantId,
        email: merchantInfo.email,
        mobile: merchantInfo.mobile,
        name: merchantInfo.name || merchantInfo.username,
        storeName: merchantInfo.name,
        avatar: merchantInfo.avatar,
      },
      savedStore,
    );

    this.logger.log(`✅ Auto-registration completed`, {
      merchantId,
      userId: result.userId,
      isNewUser: result.isNewUser,
      email: result.email,
    });
  } catch (error: any) {
    this.logger.error(`❌ Auto-registration failed: ${error.message}`, {
      merchantId,
      email: merchantInfo.email,
    });
    // لا نرمي الخطأ - المتجر تم إنشاؤه بنجاح
  }

  return savedStore;
}
