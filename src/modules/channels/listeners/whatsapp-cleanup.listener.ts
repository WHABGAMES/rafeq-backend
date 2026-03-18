/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - WhatsApp Cleanup Listener                           ║
 * ║                                                                                ║
 * ║  🧹 المسؤوليات:                                                               ║
 * ║  1. يستمع لأحداث فصل الواتساب وينظف المحادثات + الرسائل تلقائياً            ║
 * ║  2. يُصدّر cleanupChannelData() لاستخدامه من ChannelsService                 ║
 * ║                                                                                ║
 * ║  ⚠️ لماذا هذا الملف مطلوب:                                                    ║
 * ║  جداول conversations + messages أُنشئت بـ raw SQL بدون FOREIGN KEY            ║
 * ║  لذلك ON DELETE CASCADE في TypeORM Entity لا يعمل فعلياً                      ║
 * ║  هذا الـ Listener يحذف البيانات صريحاً بالترتيب الصحيح                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

// ═══════════════════════════════════════════════════════════════════════════════
// 🧹 WHATSAPP CLEANUP LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class WhatsAppCleanupListener {
  private readonly logger = new Logger(WhatsAppCleanupListener.name);

  constructor(
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 📡 EVENT LISTENERS — تتطابق مع الأحداث في whatsapp-baileys.service.ts
  // ═══════════════════════════════════════════════════════════════════════════

  /** المستخدم سجّل خروج من واتساب على هاتفه */
  @OnEvent('whatsapp.logged_out', { async: true })
  async handleLoggedOut(payload: { channelId: string }): Promise<void> {
    this.logger.warn(`🔴 WhatsApp logged_out: ${payload.channelId}`);
    await this.cleanupChannelData(payload.channelId);
  }

  /** جهاز آخر أخذ الجلسة */
  @OnEvent('whatsapp.session_replaced', { async: true })
  async handleSessionReplaced(payload: { channelId: string }): Promise<void> {
    this.logger.warn(`🔄 WhatsApp session_replaced: ${payload.channelId}`);
    await this.cleanupChannelData(payload.channelId);
  }

  /** فشلت كل محاولات إعادة الاتصال */
  @OnEvent('whatsapp.max_retries', { async: true })
  async handleMaxRetries(payload: { channelId: string }): Promise<void> {
    this.logger.warn(`❌ WhatsApp max_retries: ${payload.channelId}`);
    await this.cleanupChannelData(payload.channelId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🧹 CORE CLEANUP — يُستدعى من Event Listeners + ChannelsService
  //
  //  يحذف بالترتيب: الرسائل أولاً → المحادثات ثانياً
  //  يستخدم raw SQL + transaction لأداء وسلامة أفضل
  //  Idempotent: استدعاؤه أكثر من مرة لنفس القناة آمن (يجد 0 rows)
  // ═══════════════════════════════════════════════════════════════════════════

  async cleanupChannelData(channelId: string): Promise<{ conversations: number; messages: number }> {
    // حماية من null/undefined — لو جاء channelId فارغ من event payload
    if (!channelId) {
      this.logger.warn('⚠️ cleanupChannelData called with empty channelId — skipping');
      return { conversations: 0, messages: 0 };
    }

    const startTime = Date.now();

    try {
      // ── خطوة 1: عدّ المحادثات (للتقارير فقط) ───────────────────────
      const countResult = await this.dataSource.query(
        `SELECT COUNT(*) as cnt FROM conversations WHERE channel_id = $1`,
        [channelId],
      );
      const conversationsCount = parseInt(countResult?.[0]?.cnt || '0', 10);

      if (conversationsCount === 0) {
        this.logger.log(`🧹 Channel ${channelId}: no conversations to clean`);
        return { conversations: 0, messages: 0 };
      }

      // ── خطوة 2: حذف بـ Transaction ──────────────────────────────────
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let messagesDeleted = 0;
      let conversationsDeleted = 0;

      try {
        // ① حذف الرسائل أولاً (subquery — لا يحمّل IDs في الذاكرة)
        const msgResult = await queryRunner.query(
          `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE channel_id = $1)`,
          [channelId],
        );
        messagesDeleted = Array.isArray(msgResult) ? 0 : (msgResult?.rowCount ?? 0);

        // ② حذف المحادثات
        const convResult = await queryRunner.query(
          `DELETE FROM conversations WHERE channel_id = $1`,
          [channelId],
        );
        conversationsDeleted = Array.isArray(convResult) ? 0 : (convResult?.rowCount ?? 0);

        await queryRunner.commitTransaction();
      } catch (txError) {
        await queryRunner.rollbackTransaction();
        throw txError;
      } finally {
        await queryRunner.release();
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `🧹 Channel ${channelId}: deleted ~${conversationsCount} conversations + messages (${duration}ms)`,
      );

      return { conversations: conversationsDeleted || conversationsCount, messages: messagesDeleted };

    } catch (error) {
      this.logger.error(
        `❌ Cleanup failed for channel ${channelId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      // لا نعيد الخطأ — التنظيف لا يجب أن يمنع عملية الفصل
      return { conversations: 0, messages: 0 };
    }
  }
}
