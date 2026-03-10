/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Contacts Module (CRM)                            ║
 * ║                                                                                ║
 * ║  ✅ v2: Added StoresModule import for Salla customer sync                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer, Conversation, Order, Store } from '@database/entities';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Conversation, Order, Store]),
    StoresModule,
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
