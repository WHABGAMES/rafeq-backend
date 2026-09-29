/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Discord Bot Service                              ║
 * ║                                                                                ║
 * ║  📌 خدمة بوت Discord للتواصل مع العملاء                                         ║
 * ║                                                                                ║
 * ║  الاستخدامات:                                                                  ║
 * ║  - دعم العملاء في سيرفر Discord                                                ║
 * ║  - إشعارات الطلبات                                                             ║
 * ║  - الإعلانات والتحديثات                                                        ║
 * ║  - بوت AI للرد على الأسئلة                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageComponentInteraction,
  ChannelType,
  Partials,
  Attachment,
  Interaction,
  MessageCreateOptions,
} from 'discord.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * إعدادات قناة Discord
 */
export interface DiscordChannelConfig {
  guildId: string;        // معرف السيرفر
  botToken: string;       // توكن البوت
  supportChannelId?: string;     // قناة الدعم
  notificationsChannelId?: string;  // قناة الإشعارات
  welcomeChannelId?: string;     // قناة الترحيب
}

/**
 * أنواع الرسائل
 */
export enum DiscordMessageType {
  TEXT = 'text',
  EMBED = 'embed',
  BUTTONS = 'buttons',
  SELECT_MENU = 'select_menu',
  FILE = 'file',
}

/**
 * بيانات الـ Embed
 */
export interface DiscordEmbedData {
  title?: string;
  description?: string;
  color?: number;         // لون بصيغة Hex (0x3498db)
  url?: string;
  thumbnail?: string;
  image?: string;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
    iconUrl?: string;
  };
  timestamp?: Date;
}

/**
 * بيانات الأزرار
 */
export interface DiscordButtonData {
  id: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
  url?: string;      // فقط لـ link style
  emoji?: string;
  disabled?: boolean;
}

/**
 * بيانات القائمة المنسدلة
 */
export interface DiscordSelectMenuData {
  id: string;
  placeholder: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: string;
    default?: boolean;
  }>;
  minValues?: number;
  maxValues?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);

  /**
   * Discord Clients
   * 
   * 📌 لماذا Map؟
   * - قد يكون لدينا عدة بوتات (لعدة متاجر)
   * - كل متجر له بوت خاص
   * - نحتاج إدارة الاتصالات
   */
  private clients: Map<string, Client> = new Map();

  constructor(
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚀 LIFECYCLE HOOKS
  // ═══════════════════════════════════════════════════════════════════════════════

  async onModuleInit() {
    this.logger.log('Discord service initialized');
    // البوتات ستُنشأ عند الحاجة (lazy initialization)
  }

  async onModuleDestroy() {
    // إغلاق كل الاتصالات عند إيقاف التطبيق
    for (const [channelId, client] of this.clients) {
      this.logger.log(`Disconnecting Discord bot: ${channelId}`);
      client.destroy();
    }
    this.clients.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تهيئة بوت Discord
   * 
   * @param channelId معرف القناة في نظامنا
   * @param config إعدادات البوت
   */
  async initializeBot(
    channelId: string,
    config: DiscordChannelConfig,
  ): Promise<void> {
    // إذا كان البوت موجوداً، نوقفه أولاً
    if (this.clients.has(channelId)) {
      const existingClient = this.clients.get(channelId)!;
      existingClient.destroy();
      this.clients.delete(channelId);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 📌 إنشاء Client جديد
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Intents = الأحداث التي نريد استقبالها
     * 
     * Discord يتطلب تحديد الـ Intents لـ:
     * - الأمان (لا تستقبل ما لا تحتاجه)
     * - الأداء (تقليل البيانات)
     * - الخصوصية (بعض الـ intents تتطلب موافقة)
     */
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,           // معلومات السيرفرات
        GatewayIntentBits.GuildMessages,    // رسائل السيرفرات
        GatewayIntentBits.GuildMembers,     // أعضاء السيرفر
        GatewayIntentBits.DirectMessages,   // الرسائل الخاصة
        GatewayIntentBits.MessageContent,   // محتوى الرسائل
      ],
      partials: [
        Partials.Channel,   // للرسائل الخاصة
        Partials.Message,
        Partials.User,
      ],
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 📌 Event Handlers
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * عند جاهزية البوت
     */
    client.once(Events.ClientReady, (readyClient: Client<true>) => {
      this.logger.log(`Discord bot ready: ${readyClient.user.tag}`);
      
      // إطلاق event
      this.eventEmitter.emit('channel.connected', {
        channel: 'discord',
        channelId,
        guildId: config.guildId,
        botUsername: readyClient.user.tag,
      });
    });

    /**
     * عند استقبال رسالة
     */
    client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(channelId, message, config);
    });

    /**
     * عند التفاعل مع Components (أزرار، قوائم)
     */
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await this.handleComponentInteraction(channelId, interaction as MessageComponentInteraction);
      }
    });

    /**
     * عند حدوث خطأ
     */
    client.on(Events.Error, (error: Error) => {
      this.logger.error(`Discord client error: ${error.message}`, {
        channelId,
      });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 📌 تسجيل الدخول
    // ─────────────────────────────────────────────────────────────────────────────
    try {
      await client.login(config.botToken);
      this.clients.set(channelId, client);
      
      this.logger.log('Discord bot logged in successfully', {
        channelId,
        guildId: config.guildId,
      });
    } catch (error) {
      this.logger.error('Failed to login Discord bot', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * إيقاف بوت
   */
  async disconnectBot(channelId: string): Promise<void> {
    const client = this.clients.get(channelId);
    if (client) {
      client.destroy();
      this.clients.delete(channelId);
      this.logger.log('Discord bot disconnected', { channelId });
    }
  }

  /**
   * التحقق من حالة البوت
   */
  isConnected(channelId: string): boolean {
    const client = this.clients.get(channelId);
    return client?.isReady() ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📤 SENDING MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إرسال رسالة نصية
   */
  async sendTextMessage(
    channelId: string,
    discordChannelId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<string> {
    const client = this.getClient(channelId);
    const channel = await this.getTextChannel(client, discordChannelId);

    const options: MessageCreateOptions = { content: text };
    
    if (replyToMessageId) {
      options.reply = { messageReference: replyToMessageId };
    }

    const message = await channel.send(options);
    return message.id;
  }

  /**
   * إرسال Embed
   * 
   * 📌 Embeds:
   * - رسائل منسقة وجميلة
   * - تدعم الصور والألوان
   * - مثالية للإعلانات وعرض المنتجات
   */
  async sendEmbed(
    channelId: string,
    discordChannelId: string,
    embedData: DiscordEmbedData,
  ): Promise<string> {
    const client = this.getClient(channelId);
    const channel = await this.getTextChannel(client, discordChannelId);

    const embed = new EmbedBuilder();

    if (embedData.title) embed.setTitle(embedData.title);
    if (embedData.description) embed.setDescription(embedData.description);
    if (embedData.color) embed.setColor(embedData.color);
    if (embedData.url) embed.setURL(embedData.url);
    if (embedData.thumbnail) embed.setThumbnail(embedData.thumbnail);
    if (embedData.image) embed.setImage(embedData.image);
    if (embedData.fields) {
      embed.addFields(embedData.fields);
    }
    if (embedData.footer) {
      embed.setFooter({
        text: embedData.footer.text,
        iconURL: embedData.footer.iconUrl,
      });
    }
    if (embedData.timestamp) {
      embed.setTimestamp(embedData.timestamp);
    }

    const message = await channel.send({ embeds: [embed] });
    return message.id;
  }

  /**
   * إرسال رسالة بأزرار
   */
  async sendButtonMessage(
    channelId: string,
    discordChannelId: string,
    text: string,
    buttons: DiscordButtonData[],
  ): Promise<string> {
    const client = this.getClient(channelId);
    const channel = await this.getTextChannel(client, discordChannelId);

    // Discord يسمح بـ 5 أزرار في الصف الواحد
    // و 5 صفوف كحد أقصى = 25 زر
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    let buttonCount = 0;

    for (const btn of buttons) {
      if (buttonCount >= 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
        buttonCount = 0;
      }

      const button = new ButtonBuilder()
        .setLabel(btn.label)
        .setStyle(this.getButtonStyle(btn.style));

      if (btn.style === 'link' && btn.url) {
        button.setURL(btn.url);
      } else {
        button.setCustomId(btn.id);
      }

      if (btn.emoji) button.setEmoji(btn.emoji);
      if (btn.disabled) button.setDisabled(true);

      currentRow.addComponents(button);
      buttonCount++;
    }

    if (currentRow.components.length > 0) {
      rows.push(currentRow);
    }

    const message = await channel.send({
      content: text,
      components: rows,
    });

    return message.id;
  }

  /**
   * إرسال قائمة منسدلة
   */
  async sendSelectMenu(
    channelId: string,
    discordChannelId: string,
    text: string,
    menuData: DiscordSelectMenuData,
  ): Promise<string> {
    const client = this.getClient(channelId);
    const channel = await this.getTextChannel(client, discordChannelId);

    const select = new StringSelectMenuBuilder()
      .setCustomId(menuData.id)
      .setPlaceholder(menuData.placeholder)
      .addOptions(
        menuData.options.map((opt) => ({
          label: opt.label,
          value: opt.value,
          description: opt.description,
          emoji: opt.emoji,
          default: opt.default,
        })),
      );

    if (menuData.minValues) select.setMinValues(menuData.minValues);
    if (menuData.maxValues) select.setMaxValues(menuData.maxValues);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select,
    );

    const message = await channel.send({
      content: text,
      components: [row],
    });

    return message.id;
  }

  /**
   * إرسال رسالة خاصة (DM)
   */
  async sendDirectMessage(
    channelId: string,
    userId: string,
    text: string,
    embed?: DiscordEmbedData,
  ): Promise<string | null> {
    const client = this.getClient(channelId);

    try {
      const user = await client.users.fetch(userId);
      const dmChannel = await user.createDM();

      const options: MessageCreateOptions = {};
      if (text) options.content = text;

      if (embed) {
        const embedBuilder = new EmbedBuilder();
        if (embed.title) embedBuilder.setTitle(embed.title);
        if (embed.description) embedBuilder.setDescription(embed.description);
        if (embed.color) embedBuilder.setColor(embed.color);
        options.embeds = [embedBuilder];
      }

      const message = await dmChannel.send(options);
      return message.id;
    } catch (error) {
      this.logger.warn('Cannot send DM to user', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null; // المستخدم قد يكون أغلق الـ DMs
    }
  }

  /**
   * إرسال إشعار طلب جديد
   */
  async sendOrderNotification(
    channelId: string,
    notificationChannelId: string,
    order: {
      orderId: string;
      customerName: string;
      total: number;
      currency: string;
      items: Array<{ name: string; quantity: number; price: number }>;
      status: string;
    },
  ): Promise<string> {
    const embed: DiscordEmbedData = {
      title: `🛒 طلب جديد #${order.orderId}`,
      color: 0x2ecc71, // أخضر
      fields: [
        {
          name: '👤 العميل',
          value: order.customerName,
          inline: true,
        },
        {
          name: '💰 الإجمالي',
          value: `${order.total} ${order.currency}`,
          inline: true,
        },
        {
          name: '📦 الحالة',
          value: order.status,
          inline: true,
        },
        {
          name: '📋 المنتجات',
          value: order.items
            .map((item) => `• ${item.name} (×${item.quantity}) - ${item.price}`)
            .join('\n'),
          inline: false,
        },
      ],
      timestamp: new Date(),
      footer: {
        text: 'رفيق - إشعارات الطلبات',
      },
    };

    return this.sendEmbed(channelId, notificationChannelId, embed);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📥 MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * معالجة الرسائل الواردة
   */
  private async handleMessage(
    channelId: string,
    message: Message,
    config: DiscordChannelConfig,
  ): Promise<void> {
    // تجاهل رسائل البوتات
    if (message.author.bot) return;

    // تجاهل الرسائل خارج السيرفر المحدد
    if (message.guildId && message.guildId !== config.guildId) return;

    this.logger.debug('Discord message received', {
      channelId,
      authorId: message.author.id,
      content: message.content.substring(0, 50),
      isDM: !message.guildId,
    });

    // استخراج المعلومات
    const isDirectMessage = message.channel.type === ChannelType.DM;
    const attachments = message.attachments.map((a: Attachment) => ({
      url: a.url,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
    }));

    // إطلاق Event
    this.eventEmitter.emit('channel.message.received', {
      channel: 'discord',
      channelId,
      externalMessageId: message.id,
      from: message.author.id,
      customerName: message.author.username,
      customerDisplayName: message.author.displayName,
      customerAvatar: message.author.avatarURL(),
      content: message.content,
      type: attachments.length > 0 ? 'file' : 'text',
      attachments,
      isDirectMessage,
      discordChannelId: message.channelId,
      guildId: message.guildId,
      replyTo: message.reference?.messageId,
      timestamp: message.createdAt,
      raw: {
        id: message.id,
        content: message.content,
        authorId: message.author.id,
        channelId: message.channelId,
      },
    });
  }

  /**
   * معالجة التفاعل مع الأزرار والقوائم
   */
  private async handleComponentInteraction(
    channelId: string,
    interaction: MessageComponentInteraction,
  ): Promise<void> {
    this.logger.debug('Discord component interaction', {
      channelId,
      customId: interaction.customId,
      userId: interaction.user.id,
    });

    // إطلاق Event
    this.eventEmitter.emit('channel.interaction', {
      channel: 'discord',
      channelId,
      interactionId: interaction.id,
      customId: interaction.customId,
      userId: interaction.user.id,
      userName: interaction.user.username,
      messageId: interaction.message.id,
      type: interaction.isButton() ? 'button' : 'select_menu',
      values: interaction.isStringSelectMenu() ? interaction.values : undefined,
      timestamp: new Date(),
    });

    // يجب الرد على الـ interaction خلال 3 ثواني
    // نرسل defer لنكسب وقت
    try {
      await interaction.deferUpdate();
    } catch {
      // قد يكون الـ interaction انتهت صلاحيته
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * الحصول على Client
   */
  private getClient(channelId: string): Client {
    const client = this.clients.get(channelId);
    if (!client || !client.isReady()) {
      throw new Error(`Discord bot not connected for channel: ${channelId}`);
    }
    return client;
  }

  /**
   * الحصول على قناة نصية
   */
  private async getTextChannel(
    client: Client,
    channelId: string,
  ): Promise<TextChannel> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error(`Invalid text channel: ${channelId}`);
    }
    return channel as TextChannel;
  }

  /**
   * تحويل نمط الزر
   */
  private getButtonStyle(style: string): ButtonStyle {
    switch (style) {
      case 'primary':
        return ButtonStyle.Primary;
      case 'secondary':
        return ButtonStyle.Secondary;
      case 'success':
        return ButtonStyle.Success;
      case 'danger':
        return ButtonStyle.Danger;
      case 'link':
        return ButtonStyle.Link;
      default:
        return ButtonStyle.Primary;
    }
  }

  /**
   * الحصول على معلومات السيرفر
   */
  async getGuildInfo(channelId: string, guildId: string): Promise<{
    name: string;
    memberCount: number;
    icon: string | null;
  } | null> {
    try {
      const client = this.getClient(channelId);
      const guild = await client.guilds.fetch(guildId);
      
      return {
        name: guild.name,
        memberCount: guild.memberCount,
        icon: guild.iconURL(),
      };
    } catch {
      return null;
    }
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📚 ملاحظات Discord API:
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 1. إنشاء بوت Discord:
 *    - اذهب إلى https://discord.com/developers/applications
 *    - أنشئ Application جديد
 *    - اذهب إلى Bot وأنشئ بوت
 *    - انسخ الـ Token
 *    - فعّل Intents المطلوبة
 * 
 * 2. دعوة البوت للسيرفر:
 *    - OAuth2 > URL Generator
 *    - اختر scopes: bot, applications.commands
 *    - اختر permissions المطلوبة
 *    - استخدم الرابط الناتج
 * 
 * 3. Privileged Intents:
 *    - MESSAGE_CONTENT: لقراءة محتوى الرسائل
 *    - GUILD_MEMBERS: لمعلومات الأعضاء
 *    - يجب تفعيلها في Developer Portal
 *    - فوق 100 سيرفر تحتاج verification
 * 
 * 4. Rate Limits:
 *    - 50 رسالة / ثانية / قناة
 *    - Global: 50 requests / second
 *    - البوت يتعامل معها تلقائياً
 * 
 * 5. Best Practices:
 *    - لا تخزن الـ Token في الكود
 *    - استخدم Slash Commands للأوامر العامة
 *    - احترم rate limits
 *    - استخدم Embeds للرسائل المنسقة
 */
