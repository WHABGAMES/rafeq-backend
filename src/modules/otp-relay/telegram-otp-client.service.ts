/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║     RAFIQ PLATFORM — Telegram OTP Client Service                              ║
 * ║                                                                               ║
 * ║  حساب Telegram مركزي لرفيق للتواصل مع بوتات التجار                            ║
 * ║                                                                               ║
 * ║  ✅ Mutex per bot — طلب واحد فقط لكل بوت في نفس الوقت                         ║
 * ║  ✅ Rate limiting — حماية من حظر Telegram                                     ║
 * ║  ✅ اعتماد صريح — Telegram مطلوب ومتحقق منه عند البناء                         ║
 * ║  ✅ Graceful shutdown + cleanup                                               ║
 * ║                                                                               ║
 * ║  ⚠️ ENV: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { NewMessage, NewMessageEvent } from 'teleproto/events';
import type { Entity } from 'teleproto/define';
import { getErrorMessage } from '@common/utils/error.util';
import {
  asJsonRecord,
  getJsonArray,
  getJsonString,
} from '@common/utils/json-record.util';

interface ResponseWaiter {
  botUsername: string;
  resolve: (message: Api.Message | null) => void;
  timeout: NodeJS.Timeout;
}

export function isPermanentTelegramSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('auth_key_duplicated') ||
    normalized.includes('concurrent usage of the current session') ||
    normalized.includes('session was invalidated by the server')
  );
}

@Injectable()
export class TelegramOtpClientService implements OnModuleInit, OnModuleDestroy {
  private static readonly LEASE_KEY = 'rafeq:telegram-otp:connection-owner';
  private static readonly LEASE_TTL_SECONDS = 60;
  private static readonly LEASE_RENEW_INTERVAL_MS = 20_000;
  private static readonly LEASE_RETRY_INTERVAL_MS = 10_000;
  private static readonly RELEASE_LEASE_LUA = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;
  private static readonly RENEW_LEASE_LUA = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    return 0
  `;

  private readonly logger = new Logger('TelegramOtpClient');
  private client: TelegramClient | null = null;
  private connected = false;
  private available = false;
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly sessionString: string;
  private readonly leaseOwner = randomUUID();
  private leaseRenewTimer: NodeJS.Timeout | null = null;
  private leaseRetryTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  // ── Mutex: طلب واحد فقط لكل بوت في نفس الوقت ──
  private botLocks = new Map<string, Promise<void>>();

  // ── Response listener ──
  private responseWaiter: ResponseWaiter | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.apiId = Number(this.config.get<string>('TELEGRAM_API_ID') || '0');
    this.apiHash = this.config.get<string>('TELEGRAM_API_HASH') || '';
    this.sessionString = this.config.get<string>('TELEGRAM_SESSION') || '';
  }

  async onModuleInit(): Promise<void> {
    if (!this.apiId || !this.apiHash || !this.sessionString) {
      this.logger.warn('⚠️ Telegram OTP disabled — missing ENV: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION');
      return;
    }
    try {
      this.available = true;
      await this.initializeConnection();
    } catch (error: unknown) {
      this.logger.warn(`⚠️ Telegram OTP initialization failed: ${getErrorMessage(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.leaseRetryTimer) {
      clearTimeout(this.leaseRetryTimer);
      this.leaseRetryTimer = null;
    }
    if (this.leaseRenewTimer) {
      clearInterval(this.leaseRenewTimer);
      this.leaseRenewTimer = null;
    }
    if (this.responseWaiter) {
      clearTimeout(this.responseWaiter.timeout);
      this.responseWaiter = null;
    }
    if (this.client && this.connected) {
      try {
        await this.client.disconnect();
      } catch (error: unknown) {
        this.logger.debug(`Telegram disconnect failed during shutdown: ${getErrorMessage(error)}`);
      }
    }
    await this.releaseLease();
  }

  isAvailable(): boolean { return this.available && this.connected; }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════════

  private async initializeConnection(): Promise<void> {
    if (this.shuttingDown || this.connected) return;

    const acquired = await this.acquireLease();
    if (!acquired) {
      this.logger.log('Telegram OTP is in standby; another application instance owns the connection lease');
      this.scheduleLeaseRetry();
      return;
    }

    const result = await this.connect();
    if (result === 'connected') {
      this.startLeaseRenewal();
      return;
    }

    await this.releaseLease();
    if (result === 'failed') {
      this.scheduleLeaseRetry();
    } else {
      this.available = false;
      this.logger.error(
        'Telegram OTP disabled because TELEGRAM_SESSION was permanently invalidated; rotate the session before re-enabling it',
      );
    }
  }

  private async acquireLease(): Promise<boolean> {
    const result = await this.redis.set(
      TelegramOtpClientService.LEASE_KEY,
      this.leaseOwner,
      'EX',
      TelegramOtpClientService.LEASE_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  private scheduleLeaseRetry(): void {
    if (this.shuttingDown || this.leaseRetryTimer) return;
    this.leaseRetryTimer = setTimeout(() => {
      this.leaseRetryTimer = null;
      void this.initializeConnection().catch((error: unknown) => {
        this.logger.warn(`Telegram lease retry failed: ${getErrorMessage(error)}`);
        this.scheduleLeaseRetry();
      });
    }, TelegramOtpClientService.LEASE_RETRY_INTERVAL_MS);
  }

  private startLeaseRenewal(): void {
    if (this.leaseRenewTimer) clearInterval(this.leaseRenewTimer);
    this.leaseRenewTimer = setInterval(() => {
      void this.renewLease();
    }, TelegramOtpClientService.LEASE_RENEW_INTERVAL_MS);
  }

  private async renewLease(): Promise<void> {
    const renewed = Number(await this.redis.eval(
      TelegramOtpClientService.RENEW_LEASE_LUA,
      1,
      TelegramOtpClientService.LEASE_KEY,
      this.leaseOwner,
      String(TelegramOtpClientService.LEASE_TTL_SECONDS),
    ));
    if (renewed === 1 || this.shuttingDown) return;

    this.logger.error('Telegram connection lease was lost; disconnecting this instance to prevent session duplication');
    this.connected = false;
    if (this.leaseRenewTimer) {
      clearInterval(this.leaseRenewTimer);
      this.leaseRenewTimer = null;
    }
    try {
      await this.client?.disconnect();
    } catch (error: unknown) {
      this.logger.debug(`Telegram disconnect after lease loss failed: ${getErrorMessage(error)}`);
    }
    this.client = null;
    this.scheduleLeaseRetry();
  }

  private async releaseLease(): Promise<void> {
    try {
      await this.redis.eval(
        TelegramOtpClientService.RELEASE_LEASE_LUA,
        1,
        TelegramOtpClientService.LEASE_KEY,
        this.leaseOwner,
      );
    } catch (error: unknown) {
      this.logger.debug(`Telegram lease release failed: ${getErrorMessage(error)}`);
    }
  }

  private async connect(): Promise<'connected' | 'duplicate' | 'failed'> {
    try {
      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 3,
        autoReconnect: true,
      });
      await this.client.connect();
      this.connected = true;

      // Listen for messages
      this.client.addEventHandler((event: NewMessageEvent) => this.onMessage(event), new NewMessage({}));

      const me = await this.client.getMe();
      this.logger.log(`✅ Telegram connected: ${me.phone || me.username}`);
      return 'connected';
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(`❌ Telegram connect failed: ${message}`);
      this.connected = false;
      this.client = null;
      // Telegram permanently invalidates a duplicated auth key. Retrying the
      // same value only creates log noise; an operator must rotate the session.
      return isPermanentTelegramSessionError(message) ? 'duplicate' : 'failed';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // BOT FLOW — with MUTEX (one request per bot at a time)
  // ═══════════════════════════════════════════════════════════════════════════════

  async executeBotFlow(botUsername: string, flow: BotFlowStep[]): Promise<BotFlowResult> {
    if (!this.isAvailable()) {
      return { success: false, error: 'Telegram client not available' };
    }

    const key = botUsername.toLowerCase().replace('@', '');

    // ── Mutex: انتظر لو فيه طلب سابق لنفس البوت ──
    while (this.botLocks.has(key)) {
      this.logger.debug(`⏳ Queued for @${key} — waiting for previous request`);
      await this.botLocks.get(key);
    }

    // ── Lock this bot ──
    let releaseLock: () => void;
    const lockPromise = new Promise<void>(r => { releaseLock = r; });
    this.botLocks.set(key, lockPromise);

    try {
      const result = await this.executeFlowInternal(key, flow);
      return result;
    } finally {
      this.botLocks.delete(key);
      releaseLock!();
    }
  }

  private async executeFlowInternal(botUsername: string, flow: BotFlowStep[]): Promise<BotFlowResult> {
    const client = this.client;
    if (!client) {
      return { success: false, error: 'Telegram client not initialized' };
    }

    try {
      const botEntity = await client.getEntity(botUsername);
      if (!botEntity) return { success: false, error: `Bot @${botUsername} not found` };

      this.logger.log(`🤖 Flow start: @${botUsername} (${flow.length} steps)`);

      let lastResponse: Api.Message | null = null;

      for (let i = 0; i < flow.length; i++) {
        const step = flow[i];
        const nextStep = flow[i + 1];

        switch (step.action) {
          case 'send_message':
            // ✅ FIX: إذا الخطوة التالية wait_response → جهّز المستمع قبل الإرسال
            if (nextStep?.action === 'wait_response') {
              const responsePromise = this.waitForBotResponse(botUsername, nextStep.timeout || 15000);
              await client.sendMessage(botEntity, { message: step.text! });
              this.logger.debug(`  [${i + 1}] sent: "${step.text}"`);
              // انتظر الرد (المستمع جاهز من قبل الإرسال)
              if (step.delayAfter) await this.sleep(step.delayAfter);
              lastResponse = await responsePromise;
              if (!lastResponse) return { success: false, error: `Timeout waiting for bot after: "${step.text}"` };
              this.logger.debug(`  [${i + 2}] received: ${(lastResponse.text || '').slice(0, 50)}...`);
              i++; // تخطّي الـ wait_response لأنه تم
            } else {
              await client.sendMessage(botEntity, { message: step.text! });
              this.logger.debug(`  [${i + 1}] sent: "${step.text}"`);
            }
            break;

          case 'wait_response':
            lastResponse = await this.waitForBotResponse(botUsername, step.timeout || 15000);
            if (!lastResponse) {
              return { success: false, error: `Timeout at step ${i + 1}` };
            }
            this.logger.debug(`  [${i + 1}] received: ${(lastResponse.text || '').slice(0, 50)}...`);
            break;

          case 'click_button':
            if (!lastResponse) return { success: false, error: 'No message to click button on' };
            // ✅ FIX: جهّز المستمع قبل الضغط
            if (nextStep?.action === 'wait_response') {
              const responsePromise = this.waitForBotResponse(botUsername, nextStep.timeout || 15000);
              const clicked = await this.clickButton(botEntity, lastResponse, step.buttonText!);
              if (!clicked) return { success: false, error: `Button "${step.buttonText}" not found` };
              this.logger.debug(`  [${i + 1}] clicked: "${step.buttonText}"`);
              if (step.delayAfter) await this.sleep(step.delayAfter);
              lastResponse = await responsePromise;
              if (!lastResponse) return { success: false, error: `Timeout waiting for bot after clicking: "${step.buttonText}"` };
              this.logger.debug(`  [${i + 2}] received: ${(lastResponse.text || '').slice(0, 50)}...`);
              i++; // تخطّي الـ wait_response
            } else {
              const clicked = await this.clickButton(botEntity, lastResponse, step.buttonText!);
              if (!clicked) return { success: false, error: `Button "${step.buttonText}" not found` };
              this.logger.debug(`  [${i + 1}] clicked: "${step.buttonText}"`);
            }
            break;

          case 'extract_code': {
            if (!lastResponse?.text) return { success: false, error: 'No text to extract from' };
            const re = new RegExp(step.regex || '(\\d{4,8})', 'i');
            const m = lastResponse.text.match(re);
            if (m?.[1]) {
              this.logger.log(`  [${i + 1}] ✅ code: ***${m[1].slice(-2)}`);
              return { success: true, code: m[1], fullResponse: lastResponse.text };
            }
            return { success: false, error: 'Code not found in response', fullResponse: lastResponse.text };
          }
        }

        // Rate limit: delay between steps (only if not already handled above)
        if (step.action !== 'send_message' && step.action !== 'click_button' && i < flow.length - 1 && (step.action as string) !== 'extract_code') {
          await this.sleep(step.delayAfter || 1000);
        }
      }

      return { success: false, error: 'Flow ended without code' };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(`❌ Flow error @${botUsername}: ${message}`);
      return { success: false, error: message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  private onMessage(event: NewMessageEvent): void {
    try {
      const msg = event.message;
      if (!msg) return;
      const senderUsername = getJsonString(asJsonRecord(msg._sender), 'username')?.toLowerCase();
      if (!senderUsername || !this.responseWaiter) return;

      if (this.responseWaiter.botUsername === senderUsername) {
        clearTimeout(this.responseWaiter.timeout);
        const waiter = this.responseWaiter;
        this.responseWaiter = null;
        waiter.resolve(msg);
      }
    } catch (error: unknown) {
      this.logger.debug(`Telegram message listener ignored malformed event: ${getErrorMessage(error)}`);
    }
  }

  private waitForBotResponse(botUsername: string, timeoutMs: number): Promise<Api.Message | null> {
    // Clear any stale waiter
    if (this.responseWaiter) {
      clearTimeout(this.responseWaiter.timeout);
      this.responseWaiter = null;
    }

    return new Promise<Api.Message | null>(resolve => {
      const timeout = setTimeout(() => {
        this.responseWaiter = null;
        resolve(null);
      }, timeoutMs);

      this.responseWaiter = {
        botUsername: botUsername.toLowerCase(),
        resolve,
        timeout,
      };
    });
  }

  private async clickButton(botEntity: Entity, message: Api.Message, buttonText: string): Promise<boolean> {
    const client = this.client;
    if (!client) return false;

    try {
      const replyMarkup = asJsonRecord(message.replyMarkup);
      const rows = getJsonArray(replyMarkup, 'rows') ?? [];
      for (const rowValue of rows) {
        const buttons = getJsonArray(asJsonRecord(rowValue), 'buttons') ?? [];
        for (const buttonValue of buttons) {
          const button = asJsonRecord(buttonValue);
          const text = getJsonString(button, 'text');
          if (!text?.includes(buttonText)) continue;

          const data = button?.data;
          if (Buffer.isBuffer(data)) {
            // Inline callback button
            await client.invoke(new Api.messages.GetBotCallbackAnswer({
              peer: botEntity,
              msgId: message.id,
              data,
            }));
          } else {
            // Keyboard text button
            await client.sendMessage(botEntity, { message: text });
          }
          return true;
        }
      }
    } catch (error: unknown) {
      this.logger.warn(`Button click failed: ${getErrorMessage(error)}`);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface BotFlowStep {
  action: 'send_message' | 'wait_response' | 'click_button' | 'extract_code';
  text?: string;
  buttonText?: string;
  regex?: string;
  timeout?: number;
  delayAfter?: number;
}

export interface BotFlowResult {
  success: boolean;
  code?: string;
  fullResponse?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREDEFINED BOT FLOWS
// ═══════════════════════════════════════════════════════════════════════════════

export const PREDEFINED_BOT_FLOWS: Record<string, {
  label: string;
  description: string;
  botUsername: string;
  buildFlow: (email: string) => BotFlowStep[];
}> = {
  netflix_household: {
    label: 'Netflix HouseHold',
    description: 'بوت استخراج كود Netflix + رابط التلفاز',
    botUsername: 'ZkaHousebot',
    buildFlow: (email: string): BotFlowStep[] => [
      // إرسال إيميل العميل مباشرة (المحادثة مفتوحة مسبقاً)
      { action: 'send_message', text: email, delayAfter: 5000 },
      // البوت يرد بأزرار: "كود الدخول / رابط التلفاز" + "تحديث السكن / السفر"
      { action: 'wait_response', timeout: 5000 },
      // اضغط "كود الدخول"
      { action: 'click_button', buttonText: 'كود', delayAfter: 7000 },
      // البوت يرسل الكود
      { action: 'wait_response', timeout: 7000 },
      // استخراج الكود (4-6 أرقام)
      { action: 'extract_code', regex: '(\\d{4,6})' },
    ],
  },
};
