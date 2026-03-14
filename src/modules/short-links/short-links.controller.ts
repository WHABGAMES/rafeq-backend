/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Short Links Controller                           ║
 * ║                                                                                ║
 * ║  Public:                                                                       ║
 * ║    GET /r/:code        → 302 Redirect + track click                           ║
 * ║                                                                                ║
 * ║  Merchant (JWT):                                                               ║
 * ║    GET    /short-links           → List all links                             ║
 * ║    POST   /short-links           → Create new link                            ║
 * ║    GET    /short-links/:id/stats → Analytics for a link                       ║
 * ║    PATCH  /short-links/:id       → Update link                                ║
 * ║    DELETE /short-links/:id       → Delete link                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShortLinksService } from './short-links.service';

// ═══════════════════════════════════════════════════════════════
// 🌐 PUBLIC — Redirect endpoint (no auth)
// ═══════════════════════════════════════════════════════════════

@ApiTags('Short Links: Redirect')
@Controller('r')
export class ShortLinkRedirectController {
  constructor(private readonly service: ShortLinksService) {}

  @Get(':code')
  @ApiOperation({ summary: 'Redirect short link' })
  async redirect(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const link = await this.service.resolve(code);

    if (!link) {
      res.status(404).send('الرابط غير موجود أو منتهي الصلاحية');
      return;
    }

    // Track click async — don't block redirect
    this.service.trackClick(link, {
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
      userAgent: req.headers['user-agent'] || '',
      referrer: req.headers['referer'] || '',
    }).catch(() => {});

    // 302 redirect — allows tracking repeat visits
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, link.originalUrl);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔐 MERCHANT — CRUD + Analytics (JWT auth)
// ═══════════════════════════════════════════════════════════════

@ApiTags('Short Links: Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('short-links')
export class ShortLinksController {
  constructor(private readonly service: ShortLinksService) {}

  /**
   * قائمة الروابط
   */
  @Get()
  @ApiOperation({ summary: 'List all short links' })
  async list(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.service.findAll(
      user.tenantId,
      Math.max(1, Number(page)),
      Math.min(50, Math.max(1, Number(limit))),
    );
  }

  /**
   * إنشاء رابط جديد
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create short link' })
  async create(
    @CurrentUser() user: any,
    @Body() body: { url: string; title?: string; customCode?: string; expiresAt?: string },
  ) {
    if (!body.url) throw new BadRequestException('الرابط مطلوب');

    // Validate URL
    try {
      new URL(body.url);
    } catch {
      throw new BadRequestException('الرابط غير صالح');
    }

    // Validate custom code
    if (body.customCode) {
      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(body.customCode)) {
        throw new BadRequestException('الكود المخصص يجب أن يكون 3-20 حرف (أحرف وأرقام فقط)');
      }
    }

    try {
      return await this.service.create(user.tenantId, body);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /**
   * إحصائيات رابط
   */
  @Get(':id/stats')
  @ApiOperation({ summary: 'Link analytics' })
  async stats(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getAnalytics(user.tenantId, id);
  }

  /**
   * تعديل رابط
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update link' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { title?: string; originalUrl?: string; isActive?: boolean },
  ) {
    return this.service.update(user.tenantId, id, body);
  }

  /**
   * حذف رابط
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete link' })
  async delete(@CurrentUser() user: any, @Param('id') id: string) {
    await this.service.delete(user.tenantId, id);
  }
}
