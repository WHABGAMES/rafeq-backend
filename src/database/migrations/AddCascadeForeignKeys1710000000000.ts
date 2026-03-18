/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Add FK Constraints + ON DELETE CASCADE              ║
 * ║                                                                                ║
 * ║  🔐 يضيف FOREIGN KEY لجداول conversations + messages                        ║
 * ║  📌 آمنة: IF NOT EXISTS + تتحقق من وجود الجداول أولاً                        ║
 * ║  📌 Idempotent: تشغيلها أكثر من مرة لا يسبب أخطاء                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCascadeForeignKeys1710000000000 implements MigrationInterface {
  name = 'AddCascadeForeignKeys1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── تحقق من وجود الجداول (تُنشأ في message.service.ts onModuleInit) ──
    const tablesExist = await queryRunner.query(`
      SELECT COUNT(*) as cnt FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('conversations', 'messages', 'channels');
    `);
    if (parseInt(tablesExist?.[0]?.cnt || '0', 10) < 3) {
      console.log('⏭️  Tables not ready yet — skipping FK migration (will run on next deploy)');
      return;
    }

    // ── تنظيف رسائل يتيمة (محادثة محذوفة) ────────────────────────────
    const orphanedMsgs = await queryRunner.query(`
      DELETE FROM messages
      WHERE conversation_id NOT IN (SELECT id FROM conversations);
    `);
    console.log(`🧹 Cleaned orphaned messages: ${orphanedMsgs?.[1] ?? 0}`);

    // ── تنظيف محادثات يتيمة (قناة محذوفة) ─────────────────────────────
    const orphanedConvs = await queryRunner.query(`
      DELETE FROM conversations
      WHERE channel_id NOT IN (SELECT id FROM channels);
    `);
    console.log(`🧹 Cleaned orphaned conversations: ${orphanedConvs?.[1] ?? 0}`);

    // ── FK: conversations.channel_id → channels.id ON DELETE CASCADE ───
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_conv_channel_cascade'
        ) THEN
          ALTER TABLE conversations
            ADD CONSTRAINT fk_conv_channel_cascade
            FOREIGN KEY (channel_id)
            REFERENCES channels(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    console.log('✅ FK: conversations.channel_id → channels(id) CASCADE');

    // ── FK: messages.conversation_id → conversations.id CASCADE ────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_msg_conversation_cascade'
        ) THEN
          ALTER TABLE messages
            ADD CONSTRAINT fk_msg_conversation_cascade
            FOREIGN KEY (conversation_id)
            REFERENCES conversations(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    console.log('✅ FK: messages.conversation_id → conversations(id) CASCADE');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_msg_conversation_cascade;`);
    await queryRunner.query(`ALTER TABLE conversations DROP CONSTRAINT IF EXISTS fk_conv_channel_cascade;`);
  }
}
