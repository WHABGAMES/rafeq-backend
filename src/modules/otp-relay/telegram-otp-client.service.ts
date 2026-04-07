/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║     RAFIQ PLATFORM — Telegram OTP Client Service                              ║
 * ║                                                                               ║
 * ║  حساب Telegram مركزي لرفيق للتواصل مع بوتات التجار                            ║
 * ║                                                                               ║
 * ║  ✅ Mutex per bot — طلب واحد فقط لكل بوت في نفس الوقت                         ║
 * ║  ✅ Rate limiting — حماية من حظر Telegram                                     ║
 * ║  ✅ Dynamic import — ما يكرش إذا gramjs مو مثبت                               ║
 * ║  ✅ Graceful shutdown + cleanup                                               ║
 * ║                                                                               ║
 * ║  ⚠️ npm install telegram                                                      ║
 * ║  ⚠️ ENV: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

let TelegramClient: any;
let StringSession: any;
let Api: any;
let NewMessage: any;

@Injectable()
export class TelegramOtpClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TelegramOtpClient');
  private client: any = null;
  private connected = false;
  private available = false;
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly sessionString: string;

  // ── Mutex: طلب واحد فقط لكل بوت في نفس الوقت ──
  private botLocks = new Map<string, Promise<void>>();

  // ── Response listener ──
  private responseWaiter: { botUsername: string; resolve: (msg: any) => void; timeout: NodeJS.Timeout } | null = null;

  constructor(private readonly config: ConfigService) {
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
      const tg = require('telegram');
      const sess = require('telegram/sessions');
      const events = require('telegram/events');
      TelegramClient = tg.TelegramClient;
      StringSession = sess.StringSession;
      Api = tg.Api;
      NewMessage = events.NewMessage;
      this.available = true;
      await this.connect();
    } catch (e: any) {
      this.logger.warn(`⚠️ gramjs not available: ${e?.message}. Run: npm install telegram`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.responseWaiter) {
      clearTimeout(this.responseWaiter.timeout);
      this.responseWaiter = null;
    }
    if (this.client && this.connected) {
      try { await this.client.disconnect(); } catch {}
    }
  }

  isAvailable(): boolean { return this.available && this.connected; }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════════

  private async connect(): Promise<void> {
    try {
      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 3,
        autoReconnect: true,
      });
      await this.client.connect();
      this.connected = true;

      // Listen for messages
      this.client.addEventHandler((event: any) => this.onMessage(event), new NewMessage({}));

      const me = await this.client.getMe();
      this.logger.log(`✅ Telegram connected: ${me.phone || me.username}`);
    } catch (e: any) {
      this.logger.error(`❌ Telegram connect failed: ${e?.message}`);
      this.connected = false;
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
    try {
      const botEntity = await this.client.getEntity(botUsername);
      if (!botEntity) return { success: false, error: `Bot @${botUsername} not found` };

      this.logger.log(`🤖 Flow start: @${botUsername} (${flow.length} steps)`);

      let lastResponse: any = null;

      for (let i = 0; i < flow.length; i++) {
        const step = flow[i];

        switch (step.action) {
          case 'send_message':
            await this.client.sendMessage(botEntity, { message: step.text! });
            this.logger.debug(`  [${i + 1}] sent: "${step.text}"`);
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
            const clicked = await this.clickButton(botEntity, lastResponse, step.buttonText!);
            if (!clicked) return { success: false, error: `Button "${step.buttonText}" not found` };
            this.logger.debug(`  [${i + 1}] clicked: "${step.buttonText}"`);
            break;

          case 'extract_code':
            if (!lastResponse?.text) return { success: false, error: 'No text to extract from' };
            const re = new RegExp(step.regex || '(\\d{4,8})', 'i');
            const m = lastResponse.text.match(re);
            if (m?.[1]) {
              this.logger.log(`  [${i + 1}] ✅ code: ***${m[1].slice(-2)}`);
              return { success: true, code: m[1], fullResponse: lastResponse.text };
            }
            return { success: false, error: 'Code not found in response', fullResponse: lastResponse.text };
        }

        // Rate limit: delay between steps
        if (i < flow.length - 1 && (step.action as string) !== 'extract_code') {
          await this.sleep(step.delayAfter || 2000);
        }
      }

      return { success: false, error: 'Flow ended without code' };
    } catch (e: any) {
      this.logger.error(`❌ Flow error @${botUsername}: ${e?.message}`);
      return { success: false, error: e?.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  private onMessage(event: any): void {
    try {
      const msg = event?.message;
      if (!msg) return;
      const senderUsername = (msg._sender?.username || '').toLowerCase();
      if (!senderUsername || !this.responseWaiter) return;

      if (this.responseWaiter.botUsername === senderUsername) {
        clearTimeout(this.responseWaiter.timeout);
        const waiter = this.responseWaiter;
        this.responseWaiter = null;
        waiter.resolve(msg);
      }
    } catch {}
  }

  private waitForBotResponse(botUsername: string, timeoutMs: number): Promise<any> {
    // Clear any stale waiter
    if (this.responseWaiter) {
      clearTimeout(this.responseWaiter.timeout);
      this.responseWaiter = null;
    }

    return new Promise(resolve => {
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

  private async clickButton(botEntity: any, message: any, buttonText: string): Promise<boolean> {
    try {
      const rows = message.replyMarkup?.rows || [];
      for (const row of rows) {
        for (const button of (row.buttons || [])) {
          if (!(button.text || '').includes(buttonText)) continue;

          if (button.data) {
            // Inline callback button
            await this.client.invoke(new Api.messages.GetBotCallbackAnswer({
              peer: botEntity,
              msgId: message.id,
              data: button.data,
            }));
          } else {
            // Keyboard text button
            await this.client.sendMessage(botEntity, { message: button.text });
          }
          return true;
        }
      }
    } catch (e: any) {
      this.logger.warn(`Button click failed: ${e?.message}`);
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AUTH SETUP (one-time admin)
  // ═══════════════════════════════════════════════════════════════════════════════

  async startAuth(apiId: number, apiHash: string, phone: string): Promise<{ phoneCodeHash: string }> {
    if (!TelegramClient) {
      try {
        const tg = require('telegram');
        const sess = require('telegram/sessions');
        TelegramClient = tg.TelegramClient;
        StringSession = sess.StringSession;
        Api = tg.Api;
      } catch { throw new Error('npm install telegram first'); }
    }

    const session = new StringSession('');
    const tempClient = new TelegramClient(session, apiId, apiHash, {});
    await tempClient.connect();

    const result = await tempClient.invoke(new Api.auth.SendCode({
      phoneNumber: phone,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    }));

    (this as any)._authTemp = { client: tempClient, phone };
    return { phoneCodeHash: result.phoneCodeHash };
  }

  async completeAuth(code: string, phoneCodeHash: string): Promise<{ sessionString: string }> {
    const temp = (this as any)._authTemp;
    if (!temp) throw new Error('Call startAuth first');

    await temp.client.invoke(new Api.auth.SignIn({
      phoneNumber: temp.phone,
      phoneCodeHash,
      phoneCode: code,
    }));

    const sessionStr = temp.client.session.save() as string;
    await temp.client.disconnect();
    delete (this as any)._authTemp;

    this.logger.log('✅ Auth done — save to TELEGRAM_SESSION env');
    return { sessionString: sessionStr };
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
