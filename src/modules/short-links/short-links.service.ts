/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Short Links Service                              ║
 * ║                                                                                ║
 * ║  إنشاء روابط مختصرة + تتبع الزيارات + إحصائيات                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { ShortLink, LinkClick } from './short-link.entity';

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

@Injectable()
export class ShortLinksService {
  private readonly logger = new Logger(ShortLinksService.name);

  constructor(
    @InjectRepository(ShortLink)
    private readonly linkRepo: Repository<ShortLink>,

    @InjectRepository(LinkClick)
    private readonly clickRepo: Repository<LinkClick>,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 🔑 Generate unique short code (7 chars, base62)
  // ═══════════════════════════════════════════════════════════════

  private generateCode(length = 7): string {
    const bytes = crypto.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
      code += BASE62[bytes[i] % 62];
    }
    return code;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.generateCode();
      const exists = await this.linkRepo.findOne({ where: { shortCode: code }, select: ['id'] });
      if (!exists) return code;
    }
    // Fallback: longer code
    return this.generateCode(10);
  }

  // ═══════════════════════════════════════════════════════════════
  // ✨ Create short link
  // ═══════════════════════════════════════════════════════════════

  async create(tenantId: string, dto: { url: string; title?: string; customCode?: string; expiresAt?: string }): Promise<ShortLink> {
    let shortCode: string;

    if (dto.customCode) {
      // Custom code — check availability
      const existing = await this.linkRepo.findOne({ where: { shortCode: dto.customCode } });
      if (existing) {
        throw new Error('هذا الكود مستخدم مسبقاً');
      }
      shortCode = dto.customCode;
    } else {
      shortCode = await this.generateUniqueCode();
    }

    const link = this.linkRepo.create({
      tenantId,
      shortCode,
      originalUrl: dto.url,
      title: dto.title || undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    await this.linkRepo.save(link);
    this.logger.log(`🔗 Short link created: ${shortCode} → ${dto.url.substring(0, 50)}`);
    return link;
  }

  // ═══════════════════════════════════════════════════════════════
  // 📋 List all links for tenant
  // ═══════════════════════════════════════════════════════════════

  async findAll(tenantId: string, page = 1, limit = 20): Promise<{ links: ShortLink[]; total: number }> {
    const [links, total] = await this.linkRepo.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { links, total };
  }

  // ═══════════════════════════════════════════════════════════════
  // 📊 Get link analytics
  // ═══════════════════════════════════════════════════════════════

  async getAnalytics(tenantId: string, linkId: string): Promise<{
    link: ShortLink;
    clicksByDay: { date: string; clicks: number }[];
    clicksByDevice: { device: string; clicks: number }[];
    clicksBySource: { source: string; clicks: number }[];
    clicksByCountry: { country: string; clicks: number }[];
    recentClicks: LinkClick[];
  }> {
    const link = await this.linkRepo.findOne({ where: { id: linkId, tenantId } });
    if (!link) throw new NotFoundException('الرابط غير موجود');

    // Clicks by day (last 30 days)
    const clicksByDay = await this.clickRepo
      .createQueryBuilder('c')
      .select("TO_CHAR(c.clicked_at, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'clicks')
      .where('c.link_id = :linkId', { linkId })
      .andWhere("c.clicked_at >= NOW() - INTERVAL '30 days'")
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    // Clicks by device
    const clicksByDevice = await this.clickRepo
      .createQueryBuilder('c')
      .select("COALESCE(c.device_type, 'unknown')", 'device')
      .addSelect('COUNT(*)', 'clicks')
      .where('c.link_id = :linkId', { linkId })
      .groupBy('device')
      .orderBy('clicks', 'DESC')
      .getRawMany();

    // Clicks by source
    const clicksBySource = await this.clickRepo
      .createQueryBuilder('c')
      .select("COALESCE(c.referrer_source, 'direct')", 'source')
      .addSelect('COUNT(*)', 'clicks')
      .where('c.link_id = :linkId', { linkId })
      .groupBy('source')
      .orderBy('clicks', 'DESC')
      .getRawMany();

    // Clicks by country
    const clicksByCountry = await this.clickRepo
      .createQueryBuilder('c')
      .select("COALESCE(c.country, 'unknown')", 'country')
      .addSelect('COUNT(*)', 'clicks')
      .where('c.link_id = :linkId', { linkId })
      .groupBy('country')
      .orderBy('clicks', 'DESC')
      .limit(10)
      .getRawMany();

    // Recent clicks
    const recentClicks = await this.clickRepo.find({
      where: { linkId },
      order: { clickedAt: 'DESC' },
      take: 20,
    });

    return { link, clicksByDay, clicksByDevice, clicksBySource, clicksByCountry, recentClicks };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔄 Resolve short code → original URL
  // ═══════════════════════════════════════════════════════════════

  async resolve(shortCode: string): Promise<ShortLink | null> {
    const link = await this.linkRepo.findOne({
      where: { shortCode, isActive: true },
    });

    if (!link) return null;

    // Check expiration
    if (link.expiresAt && new Date() > link.expiresAt) {
      return null;
    }

    return link;
  }

  // ═══════════════════════════════════════════════════════════════
  // 📈 Track click (async — non-blocking)
  // ═══════════════════════════════════════════════════════════════

  async trackClick(link: ShortLink, req: { ip?: string; userAgent?: string; referrer?: string }): Promise<void> {
    try {
      const device = this.parseDevice(req.userAgent || '');
      const source = this.parseReferrerSource(req.referrer || '');

      // Save click record
      await this.clickRepo.save({
        linkId: link.id,
        tenantId: link.tenantId,
        deviceType: device.type,
        browser: device.browser,
        os: device.os,
        referrer: req.referrer ? req.referrer.substring(0, 500) : undefined,
        referrerSource: source,
        clickedAt: new Date(),
      });

      // Increment counter
      await this.linkRepo.increment({ id: link.id }, 'totalClicks', 1);
    } catch (err) {
      this.logger.error(`Failed to track click for ${link.shortCode}: ${(err as Error).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔧 Update link
  // ═══════════════════════════════════════════════════════════════

  async update(tenantId: string, linkId: string, dto: { title?: string; originalUrl?: string; isActive?: boolean }): Promise<ShortLink> {
    const link = await this.linkRepo.findOne({ where: { id: linkId, tenantId } });
    if (!link) throw new NotFoundException('الرابط غير موجود');

    if (dto.title !== undefined) link.title = dto.title;
    if (dto.originalUrl !== undefined) link.originalUrl = dto.originalUrl;
    if (dto.isActive !== undefined) link.isActive = dto.isActive;

    return this.linkRepo.save(link);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🗑️ Delete link
  // ═══════════════════════════════════════════════════════════════

  async delete(tenantId: string, linkId: string): Promise<void> {
    const link = await this.linkRepo.findOne({ where: { id: linkId, tenantId } });
    if (!link) throw new NotFoundException('الرابط غير موجود');

    await this.clickRepo.delete({ linkId: link.id });
    await this.linkRepo.remove(link);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔍 Parse user agent → device info
  // ═══════════════════════════════════════════════════════════════

  private parseDevice(ua: string): { type: string; browser: string; os: string } {
    const lower = ua.toLowerCase();

    // Device type
    let type = 'desktop';
    if (/mobile|android|iphone|ipod/.test(lower)) type = 'mobile';
    else if (/tablet|ipad/.test(lower)) type = 'tablet';

    // Browser
    let browser = 'other';
    if (/edg/i.test(ua)) browser = 'Edge';
    else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
    else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
    else if (/opera|opr/i.test(ua)) browser = 'Opera';

    // OS
    let os = 'other';
    if (/windows/i.test(ua)) os = 'Windows';
    else if (/mac os|macintosh/i.test(ua)) os = 'macOS';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
    else if (/linux/i.test(ua)) os = 'Linux';

    return { type, browser, os };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔍 Parse referrer → source category
  // ═══════════════════════════════════════════════════════════════

  private parseReferrerSource(referrer: string): string {
    if (!referrer) return 'direct';
    const lower = referrer.toLowerCase();

    if (/wa\.me|whatsapp|api\.whatsapp/i.test(lower)) return 'whatsapp';
    if (/t\.co|twitter|x\.com/i.test(lower)) return 'twitter';
    if (/instagram|ig\.me/i.test(lower)) return 'instagram';
    if (/facebook|fb\.me|fb\.com|fbclid/i.test(lower)) return 'facebook';
    if (/snapchat|sc-cdn/i.test(lower)) return 'snapchat';
    if (/tiktok/i.test(lower)) return 'tiktok';
    if (/google|googleapis/i.test(lower)) return 'google';
    if (/bing/i.test(lower)) return 'bing';
    if (/mail|outlook|gmail|yahoo.*mail/i.test(lower)) return 'email';
    if (/t\.me|telegram/i.test(lower)) return 'telegram';
    if (/salla\.sa/i.test(lower)) return 'salla';

    return 'other';
  }
}
