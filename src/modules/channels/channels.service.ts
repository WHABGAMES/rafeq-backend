/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Service                           ║
 * ║                                                                                ║
 * ║  ✅ WhatsApp Official + QR + Phone Code + Instagram + Discord                 ║
 * ║  ✅ Fix: منع تكرار الأرقام                                                     ║
 * ║  ✅ Fix: تنظيف القنوات المنقطعة عند إعادة الربط                                 ║
 * ║  ✅ New: ربط القناة بمتجر واحد أو عدة متاجر                                    ║
 * ║                                                                                ║
 * ║  📌 Audit: v2 - Fixed 5 bugs from initial review                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

import { Channel, ChannelType, ChannelStatus } from './entities/channel.entity';
import { WhatsAppBaileysService, QRSessionResult } from './whatsapp/whatsapp-baileys.service';


// ═══════════════════════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConnectWhatsAppOfficialDto {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  verifyToken?: string;
}

export interface ConnectDiscordDto {
  botToken: string;
  guildId?: string;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    
    private readonly httpService: HttpService,
    
    private readonly whatsappBaileysService: WhatsAppBaileysService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Phone Normalization Helper
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تحويل رقم الهاتف لشكل موحّد (أرقام فقط)
   * مثال: "+971 524 395 552" → "971524395552"
   */
  private normalizePhone(phone: string | undefined | null): string {
    return (phone || '').replace(/[^0-9]/g, '');
  }

  /**
   * مقارنة رقمين بعد التوحيد
   * يدعم المقارنة الجزئية (الرقم القصير يطابق نهاية الرقم الطويل)
   */
  private phonesMatch(phone1: string, phone2: string): boolean {
    const n1 = this.normalizePhone(phone1);
    const n2 = this.normalizePhone(phone2);
    if (!n1 || !n2) return false;
    // مقارنة من نهاية الرقم (بدون كود الدولة أحياناً)
    return n1.endsWith(n2) || n2.endsWith(n1);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  async findAll(storeId: string): Promise<Channel[]> {
    return this.channelRepository.find({
      where: { storeId, isAdminChannel: false },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, storeId: string): Promise<Channel> {
    const channel = await this.channelRepository.findOne({ where: { id, storeId, isAdminChannel: false } });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  /**
   * ✅ Fix: الفصل الآن ينظف القناة بشكل كامل
   * - يحذف الجلسة من Baileys
   * - يحذف السجل من قاعدة البيانات (hard delete)
   * - يمنع بقاء قنوات "شبحية" في القائمة
   */
  async disconnect(id: string, storeId: string): Promise<void> {
    const channel = await this.findById(id, storeId);

    // ② حذف الجلسة من Baileys (إذا كانت WhatsApp QR)
    if (channel.type === ChannelType.WHATSAPP_QR) {
      try {
        await this.whatsappBaileysService.deleteSession(id);
      } catch (error) {
        this.logger.warn(`Failed to delete Baileys session for ${id}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // ✅ FIX: تحقق من وجود محادثات — لو فيه محادثات → soft disconnect بدل حذف
    // حذف القناة ممكن يسبب CASCADE DELETE للمحادثات (FK constraint)
    const convCount = await this.channelRepository.manager.query(
      `SELECT COUNT(*) as cnt FROM conversations WHERE channel_id = $1`, [id],
    );
    const hasConversations = parseInt(convCount?.[0]?.cnt || '0', 10) > 0;

    if (hasConversations) {
      // محادثات موجودة → soft disconnect (يحتفظ بالبيانات)
      await this.channelRepository.update(id, {
        status: ChannelStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        whatsappAccessToken: null as any,
        sessionData: null as any,
      });
      this.logger.log(`✅ Channel ${id} soft-disconnected for store ${storeId} (${convCount[0].cnt} conversations preserved)`);
    } else {
      // بدون محادثات → حذف آمن
      await this.channelRepository.remove(channel);
      this.logger.log(`✅ Channel ${id} removed for store ${storeId} (no conversations)`);
    }
  }

  /**
   * ✅ إضافة: فصل بدون حذف (للحالات اللي يبي التاجر يحتفظ بالسجل)
   *
   * 🔧 Fix BUG#1+#4: استخدام null بدل undefined لمسح القيم في TypeORM
   */
  async softDisconnect(id: string, storeId: string): Promise<void> {
    const channel = await this.findById(id, storeId);

    // ✅ FIX: لا نحذف المحادثات — بيانات تجارية يجب الاحتفاظ بها

    // ② حذف جلسة Baileys
    if (channel.type === ChannelType.WHATSAPP_QR) {
      try {
        await this.whatsappBaileysService.deleteSession(id);
      } catch (error) {
        this.logger.warn(`Failed to delete Baileys session: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // ③ تحديث حالة القناة (بدون حذف السجل)
    // ✅ Fix: null يمسح القيمة في DB. undefined يتخطاها (لا تُحدَّث).
    await this.channelRepository.update(id, {
      status: ChannelStatus.DISCONNECTED,
      disconnectedAt: new Date(),
      whatsappAccessToken: null as any,
      sessionData: null as any,
      discordBotToken: null as any,
      instagramAccessToken: null as any,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 WhatsApp Official (Meta Business API)
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectWhatsAppOfficial(storeId: string, dto: ConnectWhatsAppOfficialDto): Promise<Channel> {
    this.logger.log(`Connecting WhatsApp Official for store ${storeId}`);
    const phoneInfo = await this.verifyWhatsAppCredentials(dto);

    // ✅ Fix: تحقق من التكرار عبر كل المتاجر (مو بس المتجر الحالي)
    const existingGlobal = await this.channelRepository.findOne({
      where: { type: ChannelType.WHATSAPP_OFFICIAL, whatsappPhoneNumberId: dto.phoneNumberId },
    });

    if (existingGlobal) {
      if (existingGlobal.storeId === storeId && existingGlobal.status === ChannelStatus.CONNECTED) {
        throw new BadRequestException('هذا الرقم مربوط بالفعل بهذا المتجر');
      }
      if (existingGlobal.storeId !== storeId && existingGlobal.status === ChannelStatus.CONNECTED) {
        throw new BadRequestException('هذا الرقم مربوط بالفعل بمتجر آخر');
      }

      // ✅ إذا كان موجود لكن غير متصل → أعد استخدامه
      existingGlobal.storeId = storeId;
      existingGlobal.status = ChannelStatus.CONNECTED;
      existingGlobal.whatsappAccessToken = dto.accessToken;
      existingGlobal.whatsappBusinessAccountId = dto.businessAccountId;
      existingGlobal.whatsappPhoneNumber = phoneInfo.display_phone_number;
      existingGlobal.whatsappDisplayName = phoneInfo.verified_name;
      existingGlobal.connectedAt = new Date();
      // ✅ Fix BUG#1: null يمسح القيمة في DB, undefined لا يفعل شيء
      existingGlobal.disconnectedAt = null as any;
      existingGlobal.lastError = null as any;
      existingGlobal.errorCount = 0;

      this.logger.log(`♻️ Reusing existing channel ${existingGlobal.id} for WhatsApp Official`);
      return this.channelRepository.save(existingGlobal);
    }

    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.WHATSAPP_OFFICIAL,
      name: phoneInfo.display_phone_number || 'WhatsApp Business',
      status: ChannelStatus.CONNECTED,
      isOfficial: true,
      whatsappPhoneNumberId: dto.phoneNumberId,
      whatsappBusinessAccountId: dto.businessAccountId,
      whatsappAccessToken: dto.accessToken,
      whatsappPhoneNumber: phoneInfo.display_phone_number,
      whatsappDisplayName: phoneInfo.verified_name,
      connectedAt: new Date(),
      settings: { verifyToken: dto.verifyToken || this.generateVerifyToken() },
    });

    return this.channelRepository.save(channel);
  }

  private async verifyWhatsAppCredentials(dto: ConnectWhatsAppOfficialDto): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`https://graph.facebook.com/v21.0/${dto.phoneNumberId}`, {
          headers: { Authorization: `Bearer ${dto.accessToken}` },
        }),
      );
      return response.data;
    } catch (error: any) {
      throw new BadRequestException('Invalid WhatsApp credentials');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp QR (Baileys)
  // ═══════════════════════════════════════════════════════════════════════════════

  async initWhatsAppSession(storeId: string): Promise<QRSessionResult> {
    this.logger.log(`[QR] Init for store ${storeId}`);
    return this.createWhatsAppQRChannel(storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Phone Code (Baileys)
  // ═══════════════════════════════════════════════════════════════════════════════


  /**
   * ✅ Fix: إنشاء قناة WhatsApp QR/Phone مع منع التكرار
   * 
   * المنطق الجديد:
   * 1. ننظف أي قنوات PENDING/DISCONNECTED/ERROR قديمة لنفس المتجر
   * 2. نتحقق من وجود قناة متصلة بنفس الرقم
   * 3. إذا وُجدت قناة متصلة بنفس الرقم → خطأ
   * 4. إذا لم توجد → ننشئ واحدة جديدة
   */
  private async createWhatsAppQRChannel(
    storeId: string,
  ): Promise<QRSessionResult> {

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ خطوة 1: البحث عن قناة موجودة يمكن إعادة استخدامها
    // ⚠️ FIX CRITICAL: لا نحذف القنوات! الحذف يسبب CASCADE DELETE للمحادثات
    // بدلاً من ذلك، نعيد استخدام القناة القديمة (نحافظ على المحادثات)
    // ═══════════════════════════════════════════════════════════════════════════
    const existingChannels = await this.channelRepository.find({
      where: {
        storeId,
        type: ChannelType.WHATSAPP_QR,
        status: In([
          ChannelStatus.PENDING,
          ChannelStatus.DISCONNECTED,
          ChannelStatus.ERROR,
          ChannelStatus.EXPIRED,
        ]),
      },
      order: { createdAt: 'DESC' },
    });

    // إذا فيه قناة قديمة → نعيد استخدامها (بدون حذف!)
    if (existingChannels.length > 0) {
      const reuseChannel = existingChannels[0]; // أحدث قناة
      this.logger.log(`♻️ Reusing existing channel ${reuseChannel.id} for store ${storeId} (preserving conversations)`);

      // حذف الجلسات القديمة من الملفات فقط (مو من الداتابيس)
      try {
        await this.whatsappBaileysService.deleteSession(reuseChannel.id);
      } catch { /* ignore */ }

      // إعادة تعيين القناة
      reuseChannel.status = ChannelStatus.PENDING;
      reuseChannel.sessionData = null as any;
      reuseChannel.lastError = null as any;
      reuseChannel.lastErrorAt = null as any;
      reuseChannel.disconnectedAt = null as any;
      reuseChannel.errorCount = 0;
      await this.channelRepository.save(reuseChannel);

      // حذف القنوات الزائدة (إذا فيه أكثر من واحدة) — فقط اللي ما عليها محادثات
      if (existingChannels.length > 1) {
        try {
          for (let i = 1; i < existingChannels.length; i++) {
            const extra = existingChannels[i];
            const convCount = await this.channelRepository.manager.query(
              `SELECT COUNT(*) as cnt FROM conversations WHERE channel_id = $1`,
              [extra.id],
            );
            if (parseInt(convCount?.[0]?.cnt || '0', 10) === 0) {
              this.logger.log(`🧹 Removing empty duplicate channel ${extra.id}`);
              try { await this.whatsappBaileysService.deleteSession(extra.id); } catch { /* ignore */ }
              await this.channelRepository.remove(extra);
            } else {
              this.logger.log(`⏭️ Keeping channel ${extra.id} (has ${convCount[0].cnt} conversations)`);
            }
          }
        } catch (cleanupErr) {
          this.logger.warn(`⚠️ Extras cleanup failed (non-blocking): ${cleanupErr instanceof Error ? cleanupErr.message : 'Unknown'}`);
        }
      }

      // إنشاء جلسة QR على القناة المعاد استخدامها
      try {
        const session = await this.whatsappBaileysService.initSession(reuseChannel.id);

        await this.channelRepository.update(reuseChannel.id, {
          status: session.status === 'connected' ? ChannelStatus.CONNECTED : ChannelStatus.PENDING,
          sessionId: session.sessionId,
        });

        return session;
      } catch (error: any) {
        // ⚠️ فشل إنشاء الجلسة — نرجّع القناة لـ DISCONNECTED (لا نحذفها!)
        this.logger.error(`Failed to init session on reused channel ${reuseChannel.id}: ${error.message}`);
        await this.channelRepository.update(reuseChannel.id, {
          status: ChannelStatus.DISCONNECTED,
          lastError: error.message || 'فشل إنشاء جلسة QR',
          lastErrorAt: new Date(),
        });
        throw new BadRequestException(error.message || 'فشل إنشاء جلسة واتساب — حاول مرة أخرى');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ خطوة 2: تحقق من وجود قناة QR متصلة بالفعل لهذا المتجر
    // ═══════════════════════════════════════════════════════════════════════════
    const existingConnected = await this.channelRepository.findOne({
      where: {
        storeId,
        type: ChannelType.WHATSAPP_QR,
        status: ChannelStatus.CONNECTED,
      },
    });

    if (existingConnected) {
      throw new BadRequestException(
        `يوجد رقم واتساب متصل بالفعل (${existingConnected.whatsappPhoneNumber || existingConnected.name}). ` +
        'افصله أولاً قبل ربط رقم جديد.',
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ خطوة 4: إنشاء قناة جديدة نظيفة
    // ═══════════════════════════════════════════════════════════════════════════
    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.WHATSAPP_QR,
      name: 'WhatsApp (QR)',
      status: ChannelStatus.PENDING,
      isOfficial: false,
    });

    const savedChannel = await this.channelRepository.save(channel);

    try {
      let session: QRSessionResult;

      session = await this.whatsappBaileysService.initSession(savedChannel.id);

      await this.channelRepository.update(savedChannel.id, {
        status: session.status === 'connected' ? ChannelStatus.CONNECTED : ChannelStatus.PENDING,
        sessionId: session.sessionId,
      });

      return session;
    } catch (error: any) {
      // ✅ Fix: حذف كامل عند الفشل (بدل ترك سجل يتيم)
      await this.channelRepository.remove(savedChannel);
      this.logger.error('Failed to init WhatsApp session', error.message);
      throw new BadRequestException(error.message || 'Failed to initialize WhatsApp session');
    }
  }

  async getWhatsAppSessionStatus(sessionId: string): Promise<QRSessionResult> {
    const status = await this.whatsappBaileysService.getSessionStatus(sessionId);
    if (!status) throw new NotFoundException('Session not found');

    if (status.status === 'connected') {
      // ✅ Fix: تحقق من التكرار عند الاتصال الناجح
      // إذا وصل الرقم ووجدنا قناة قديمة بنفس الرقم → ننظفها
      if (status.phoneNumber) {
        await this.cleanupDuplicatesByPhone(sessionId, status.phoneNumber);
      }

      await this.channelRepository.update(sessionId, {
        status: ChannelStatus.CONNECTED,
        connectedAt: new Date(),
        whatsappPhoneNumber: status.phoneNumber,
      });
    }

    return status;
  }

  /**
   * ✅ جديد: تنظيف القنوات المكررة بنفس الرقم
   * يبقي فقط القناة الحالية ويحذف الباقي
   *
   * 🔧 Fix BUG#3: فلترة على مستوى التطبيق بدل REPLACE في SQL
   */
  private async cleanupDuplicatesByPhone(
    keepChannelId: string,
    phoneNumber: string,
  ): Promise<void> {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    if (!normalizedPhone) return;

    // ✅ جلب كل قنوات QR ومقارنة الأرقام في التطبيق
    const allQRChannels = await this.channelRepository.find({
      where: {
        type: ChannelType.WHATSAPP_QR,
      },
    });

    const duplicates = allQRChannels.filter(ch => {
      if (ch.id === keepChannelId) return false;
      if (ch.isAdminChannel) return false; // حماية قنوات الأدمن
      if (!ch.whatsappPhoneNumber) return false;
      return this.phonesMatch(ch.whatsappPhoneNumber, normalizedPhone);
    });

    if (duplicates.length > 0) {
      this.logger.warn(
        `🧹 Found ${duplicates.length} duplicate channel(s) for phone ${phoneNumber}. Cleaning up...`,
      );
      for (const dup of duplicates) {
        try {
          await this.whatsappBaileysService.deleteSession(dup.id);
        } catch {
          // تجاهل
        }
      }
      // ✅ FIX: حذف فقط القنوات بدون محادثات
      for (const dup of duplicates) {
        const cc = await this.channelRepository.manager.query(
          `SELECT COUNT(*) as cnt FROM conversations WHERE channel_id = $1`, [dup.id],
        );
        if (parseInt(cc?.[0]?.cnt || '0', 10) === 0) {
          await this.channelRepository.remove(dup);
        } else {
          this.logger.warn(`⏭️ Keeping duplicate channel ${dup.id} — has ${cc[0].cnt} conversations`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 ربط القناة بمتجر / عدة متاجر
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ جديد: تغيير المتجر المرتبط بالقناة
   */
  async assignToStore(channelId: string, currentStoreId: string, newStoreId: string): Promise<Channel> {
    const channel = await this.findById(channelId, currentStoreId);

    // التحقق من أن المتجر الجديد لا يملك قناة بنفس النوع متصلة
    const conflicting = await this.channelRepository.findOne({
      where: {
        storeId: newStoreId,
        type: channel.type,
        status: ChannelStatus.CONNECTED,
      },
    });

    if (conflicting) {
      throw new BadRequestException(
        'المتجر المستهدف لديه قناة واتساب متصلة بالفعل. افصلها أولاً.',
      );
    }

    channel.storeId = newStoreId;
    const updated = await this.channelRepository.save(channel);

    this.logger.log(`✅ Channel ${channelId} assigned to store ${newStoreId}`);
    return updated;
  }

  /**
   * ✅ جديد: نسخ/مشاركة القناة مع عدة متاجر
   * ينشئ سجل "مرآة" مرتبط بنفس الجلسة
   * 
   * هذا يسمح لنفس الرقم بخدمة عدة متاجر
   */
  async shareWithStores(channelId: string, currentStoreId: string, targetStoreIds: string[]): Promise<Channel[]> {
    const sourceChannel = await this.findById(channelId, currentStoreId);

    if (sourceChannel.status !== ChannelStatus.CONNECTED) {
      throw new BadRequestException('يجب أن تكون القناة متصلة قبل مشاركتها');
    }

    const createdChannels: Channel[] = [];

    for (const targetStoreId of targetStoreIds) {
      // تجنب التكرار: لا تنشئ إذا كان المتجر نفسه
      if (targetStoreId === currentStoreId) continue;

      const existing = await this.channelRepository.findOne({
        where: {
          storeId: targetStoreId,
          type: sourceChannel.type,
          whatsappPhoneNumber: sourceChannel.whatsappPhoneNumber,
        },
      });

      if (existing) {
        // حدّث القناة الموجودة بدل إنشاء جديدة
        existing.status = ChannelStatus.CONNECTED;
        existing.sessionId = sourceChannel.sessionId;
        existing.connectedAt = new Date();
        existing.lastError = null as any;
        existing.errorCount = 0;
        await this.channelRepository.save(existing);
        createdChannels.push(existing);
        continue;
      }

      const mirrorChannel = this.channelRepository.create({
        storeId: targetStoreId,
        type: sourceChannel.type,
        name: sourceChannel.name,
        status: ChannelStatus.CONNECTED,
        isOfficial: sourceChannel.isOfficial,
        whatsappPhoneNumberId: sourceChannel.whatsappPhoneNumberId,
        whatsappBusinessAccountId: sourceChannel.whatsappBusinessAccountId,
        whatsappAccessToken: sourceChannel.whatsappAccessToken,
        whatsappPhoneNumber: sourceChannel.whatsappPhoneNumber,
        whatsappDisplayName: sourceChannel.whatsappDisplayName,
        sessionId: sourceChannel.sessionId,
        connectedAt: new Date(),
        settings: {
          ...((sourceChannel.settings as Record<string, unknown>) || {}),
          sharedFromChannelId: channelId,
          sharedFromStoreId: currentStoreId,
        },
      });

      const saved = await this.channelRepository.save(mirrorChannel);
      createdChannels.push(saved);
      this.logger.log(`✅ Channel shared: ${channelId} → store ${targetStoreId} (mirror: ${saved.id})`);
    }

    return createdChannels;
  }

  /**
   * ✅ جديد: إزالة مشاركة القناة من متجر
   */
  async unshareFromStore(channelId: string, storeId: string): Promise<void> {
    const channel = await this.findById(channelId, storeId);

    // لا تحذف الجلسة لأنها مشتركة - فقط احذف السجل
    const settings = (channel.settings || {}) as Record<string, unknown>;
    const isShared = !!settings.sharedFromChannelId;

    if (isShared) {
      // هذه قناة مرآة → تحقق من المحادثات أولاً
      const cc = await this.channelRepository.manager.query(
        `SELECT COUNT(*) as cnt FROM conversations WHERE channel_id = $1`, [channelId],
      );
      if (parseInt(cc?.[0]?.cnt || '0', 10) === 0) {
        await this.channelRepository.remove(channel);
        this.logger.log(`✅ Removed shared channel ${channelId} from store ${storeId}`);
      } else {
        // ✅ FIX: محادثات موجودة → soft disconnect بدل حذف
        await this.channelRepository.update(channelId, {
          status: ChannelStatus.DISCONNECTED,
          disconnectedAt: new Date(),
        });
        this.logger.log(`✅ Soft-disconnected shared channel ${channelId} (${cc[0].cnt} conversations preserved)`);
      }
    } else {
      // هذه القناة الأصلية → فصل عادي
      await this.disconnect(channelId, storeId);
    }
  }

  /**
   * ✅ جديد: جلب المتاجر المرتبطة بقناة (بنفس الرقم)
   */
  async getLinkedStores(phoneNumber: string): Promise<{ storeId: string; channelId: string; status: ChannelStatus }[]> {
    if (!phoneNumber) return [];

    const normalizedInput = this.normalizePhone(phoneNumber);
    if (!normalizedInput) return [];

    // ✅ Fix: فلترة على مستوى التطبيق بدل SQL
    const allChannels = await this.channelRepository.find({
      select: ['id', 'storeId', 'status', 'whatsappPhoneNumber'],
    });

    return allChannels
      .filter(ch => ch.whatsappPhoneNumber && this.phonesMatch(ch.whatsappPhoneNumber, normalizedInput))
      .map(ch => ({
        storeId: ch.storeId,
        channelId: ch.id,
        status: ch.status,
      }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧹 تنظيف البيانات
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ جديد: تنظيف جميع القنوات المكررة/الميتة لمتجر معين
   * يستخدم لإصلاح البيانات الموجودة حالياً
   */
  async cleanupDeadChannels(storeId: string): Promise<{ removed: number; kept: number }> {
    const allChannels = await this.channelRepository.find({
      where: { storeId, type: ChannelType.WHATSAPP_QR },
      order: { createdAt: 'DESC' },
    });

    // تجميع حسب الرقم
    const byPhone = new Map<string, Channel[]>();
    const noPhone: Channel[] = [];

    for (const ch of allChannels) {
      const phone = this.normalizePhone(ch.whatsappPhoneNumber);
      if (!phone) {
        noPhone.push(ch);
        continue;
      }
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(ch);
    }

    const toRemove: Channel[] = [];

    // لكل رقم: ابقِ أحدث قناة متصلة، احذف الباقي
    for (const [, channels] of byPhone) {
      const connected = channels.find(c => c.status === ChannelStatus.CONNECTED);
      const keep = connected || channels[0]; // أحدث واحدة (مرتبة بـ createdAt DESC)

      for (const ch of channels) {
        if (ch.id !== keep.id) {
          toRemove.push(ch);
        }
      }
    }

    // القنوات بدون رقم واللي حالتها غير متصلة → حذف
    for (const ch of noPhone) {
      if (ch.status !== ChannelStatus.CONNECTED) {
        toRemove.push(ch);
      }
    }

    if (toRemove.length > 0) {
      for (const ch of toRemove) {
        try {
          // ✅ FIX: فقط نحذف الجلسة — المحادثات لا تنحذف
          await this.whatsappBaileysService.deleteSession(ch.id);
        } catch {
          // تجاهل
        }
      }
      // ✅ FIX: حذف فقط القنوات بدون محادثات
      const safeToRemove: typeof toRemove = [];
      for (const ch of toRemove) {
        const cc = await this.channelRepository.manager.query(
          `SELECT COUNT(*) as cnt FROM conversations WHERE channel_id = $1`, [ch.id],
        );
        if (parseInt(cc?.[0]?.cnt || '0', 10) === 0) {
          safeToRemove.push(ch);
        } else {
          this.logger.warn(`⏭️ Keeping channel ${ch.id} — has ${cc[0].cnt} conversations`);
        }
      }
      if (safeToRemove.length > 0) {
        await this.channelRepository.remove(safeToRemove);
      }
    }

    this.logger.log(
      `🧹 Cleanup for store ${storeId}: removed ${toRemove.length}, kept ${allChannels.length - toRemove.length}`,
    );

    return {
      removed: toRemove.length,
      kept: allChannels.length - toRemove.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 Send Message
  // ═══════════════════════════════════════════════════════════════════════════════

  async sendWhatsAppMessage(channelId: string, to: string, message: string, storeId?: string): Promise<{ messageId: string }> {
    // 🔧 FIX M-04: Include storeId in query when available to prevent IDOR
    const whereClause: Record<string, unknown> = { id: channelId };
    if (storeId) {
      whereClause.storeId = storeId;
    }
    const channel = await this.channelRepository.findOne({ where: whereClause });
    if (!channel) throw new NotFoundException('Channel not found');

    if (channel.type === ChannelType.WHATSAPP_QR) {
      return this.whatsappBaileysService.sendTextMessage(channelId, to, message);
    } else if (channel.type === ChannelType.WHATSAPP_OFFICIAL) {
      return this.sendWhatsAppOfficialMessage(channel, to, message);
    }

    throw new BadRequestException('Invalid channel type');
  }

  private async sendWhatsAppOfficialMessage(channel: Channel, to: string, message: string): Promise<{ messageId: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v21.0/${channel.whatsappPhoneNumberId}/messages`,
          { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
          { headers: { Authorization: `Bearer ${channel.whatsappAccessToken}`, 'Content-Type': 'application/json' } },
        ),
      );
      return { messageId: response.data.messages?.[0]?.id || '' };
    } catch (error: any) {
      throw new BadRequestException('Failed to send message');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📸 Instagram
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectInstagram(storeId: string, accessToken: string, userId: string, pageId: string): Promise<Channel> {
    const userInfo = await this.getInstagramUserInfo(accessToken, userId);
    const existing = await this.channelRepository.findOne({
      where: { storeId, type: ChannelType.INSTAGRAM, instagramUserId: userId },
    });

    if (existing) {
      existing.instagramAccessToken = accessToken;
      existing.status = ChannelStatus.CONNECTED;
      return this.channelRepository.save(existing);
    }

    const channel = this.channelRepository.create({
      storeId, type: ChannelType.INSTAGRAM,
      name: userInfo.username || 'Instagram',
      status: ChannelStatus.CONNECTED, isOfficial: true,
      instagramUserId: userId, instagramUsername: userInfo.username,
      instagramAccessToken: accessToken, instagramPageId: pageId,
      connectedAt: new Date(),
    });
    return this.channelRepository.save(channel);
  }

  private async getInstagramUserInfo(accessToken: string, userId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`https://graph.facebook.com/v21.0/${userId}`, {
          params: { fields: 'username,name,profile_picture_url', access_token: accessToken },
        }),
      );
      return response.data;
    } catch {
      throw new BadRequestException('Failed to get Instagram account info');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 Discord
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectDiscord(storeId: string, dto: ConnectDiscordDto): Promise<Channel> {
    const botInfo = await this.verifyDiscordBot(dto.botToken);
    const existing = await this.channelRepository.findOne({
      where: { storeId, type: ChannelType.DISCORD, discordBotId: botInfo.id },
    });
    if (existing) throw new BadRequestException('This Discord bot is already connected');

    const channel = this.channelRepository.create({
      storeId, type: ChannelType.DISCORD,
      name: botInfo.username || 'Discord Bot',
      status: ChannelStatus.CONNECTED, isOfficial: true,
      discordBotToken: dto.botToken, discordGuildId: dto.guildId,
      discordBotId: botInfo.id, discordBotUsername: botInfo.username,
      connectedAt: new Date(),
    });
    return this.channelRepository.save(channel);
  }

  private async verifyDiscordBot(botToken: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${botToken}` },
        }),
      );
      return response.data;
    } catch {
      throw new BadRequestException('Invalid Discord bot token');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateVerifyToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async updateStatus(id: string, status: ChannelStatus, error?: string): Promise<void> {
    const updateData: any = { status };
    if (error) { updateData.lastError = error; updateData.lastErrorAt = new Date(); }
    if (status === ChannelStatus.CONNECTED) { updateData.connectedAt = new Date(); updateData.errorCount = 0; }
    await this.channelRepository.update(id, updateData);
  }

  async incrementMessageCount(id: string, type: 'sent' | 'received'): Promise<void> {
    const field = type === 'sent' ? 'messagesSent' : 'messagesReceived';
    await this.channelRepository.increment({ id }, field, 1);
    await this.channelRepository.update(id, { lastActivityAt: new Date() });
  }
}
