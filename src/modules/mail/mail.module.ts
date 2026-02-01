/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Mail Module                                     ║
 * ║                                                                               ║
 * ║  📧 وحدة إرسال البريد الإلكتروني للنظام                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';

@Global() // متاح عالمياً لكل الـ modules
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
