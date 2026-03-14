/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Widget Controller                                 ║
 * ║                                                                                ║
 * ║  Public endpoints (no auth):                                                   ║
 * ║    GET /widget/embed.js             → Widget JavaScript (MUST be first!)       ║
 * ║    GET /widget/:storeId/config      → Widget config JSON                       ║
 * ║    POST /widget/:storeId/track      → Track click/impression                   ║
 * ║                                                                                ║
 * ║  Merchant endpoints (JWT auth):                                                ║
 * ║    GET /widget/settings             → Get widget settings                      ║
 * ║    PUT /widget/settings             → Update widget settings                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  Header,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WidgetService } from './widget.service';
import { Store } from '../stores/entities/store.entity';

// ═══════════════════════════════════════════════════════════════
// 🌐 PUBLIC CONTROLLER — no auth required
// ═══════════════════════════════════════════════════════════════

@ApiTags('Widget: Public')
@Controller({ path: 'widget', version: '1' })
export class WidgetPublicController {
  constructor(private readonly widgetService: WidgetService) {}

  /**
   * ✅ embed.js MUST be BEFORE :storeId routes
   * Otherwise NestJS treats "embed.js" as a storeId param
   */
  @Get('embed.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Widget embed script' })
  getEmbedScript(@Res() res: Response) {
    res.send(EMBED_SCRIPT);
  }

  /**
   * Widget config — called by embed.js
   */
  @Get(':storeId/config')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Widget config (public)' })
  async getConfig(@Param('storeId') storeId: string) {
    const config = await this.widgetService.getPublicConfig(storeId);
    if (!config) return { enabled: false };
    return config;
  }

  /**
   * Track click/impression
   */
  @Post(':storeId/track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({ summary: 'Track widget event' })
  async track(
    @Param('storeId') storeId: string,
    @Body() body: { event: 'click' | 'impression' },
  ) {
    if (body.event === 'click') {
      await this.widgetService.trackClick(storeId);
    } else if (body.event === 'impression') {
      await this.widgetService.trackImpression(storeId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔐 MERCHANT CONTROLLER — JWT auth required
// ═══════════════════════════════════════════════════════════════

@ApiTags('Widget: Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'widget/settings', version: '1' })
export class WidgetSettingsController {
  constructor(
    private readonly widgetService: WidgetService,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  /**
   * Find the merchant's store from their tenantId
   * User entity has tenantId but NOT storeId
   */
  private async findStoreId(tenantId: string): Promise<string> {
    const store = await this.storeRepo.findOne({
      where: { tenantId },
      select: ['id'],
      order: { createdAt: 'DESC' },
    });

    if (!store) {
      throw new NotFoundException('لم يتم العثور على متجر لهذا الحساب');
    }

    return store.id;
  }

  @Get()
  @ApiOperation({ summary: 'Get widget settings' })
  async getSettings(@CurrentUser() user: any) {
    const storeId = await this.findStoreId(user.tenantId);
    return this.widgetService.getSettings(storeId, user.tenantId);
  }

  @Put()
  @ApiOperation({ summary: 'Update widget settings' })
  async updateSettings(
    @CurrentUser() user: any,
    @Body() body: Record<string, unknown>,
  ) {
    const storeId = await this.findStoreId(user.tenantId);
    return this.widgetService.updateSettings(storeId, user.tenantId, body as any);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📜 EMBED SCRIPT — Inline JavaScript
// ═══════════════════════════════════════════════════════════════

const EMBED_SCRIPT = `
(function(){
  'use strict';

  // Don't run if already loaded
  if(window.__rafeqWidget) return;
  window.__rafeqWidget = true;

  var cfg = window.RafeqWidgetConfig || {};
  var storeId = cfg.storeId;
  if(!storeId){ console.warn('RafeqWidget: missing storeId'); return; }

  var API = (cfg.apiUrl || 'https://api.rafeq.ai') + '/api/v1/widget';

  // Fetch config
  fetch(API + '/' + storeId + '/config')
    .then(function(r){ return r.json(); })
    .then(function(c){
      if(!c.enabled) return;
      render(c);
      track('impression');
    })
    .catch(function(e){ console.warn('RafeqWidget: config error', e); });

  function track(ev){
    navigator.sendBeacon && navigator.sendBeacon(
      API + '/' + storeId + '/track',
      JSON.stringify({ event: ev })
    );
  }

  function render(c){
    var isRight = (c.position||'bottom-right').indexOf('right') > -1;
    var sizes = { small: 48, medium: 56, large: 64 };
    var btnSize = sizes[c.size] || 56;
    var phone = (c.phone||'').replace(/[^0-9]/g,'');
    var prefilled = encodeURIComponent(c.prefilled || '');
    var waUrl = 'https://wa.me/' + phone + (prefilled ? '?text=' + prefilled : '');

    // Hide on mobile if disabled
    if(!c.mobile && /Mobi|Android/i.test(navigator.userAgent)) return;

    // Styles
    var style = document.createElement('style');
    style.textContent = [
      '#rafeq-wa-widget{position:fixed;bottom:20px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;direction:rtl;}',
      isRight ? '#rafeq-wa-widget{right:20px;}' : '#rafeq-wa-widget{left:20px;}',
      '#rafeq-wa-btn{width:'+btnSize+'px;height:'+btnSize+'px;border-radius:50%;background:'+c.btnColor+';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.2);transition:transform .2s,box-shadow .2s;position:relative;}',
      '#rafeq-wa-btn:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(0,0,0,.3);}',
      '#rafeq-wa-btn svg{width:'+(btnSize*0.55)+'px;height:'+(btnSize*0.55)+'px;fill:#fff;}',
      '#rafeq-wa-tooltip{position:absolute;bottom:'+(btnSize+10)+'px;'+( isRight?'right':'left')+':0;background:#fff;color:#333;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.12);white-space:nowrap;opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;pointer-events:none;}',
      '#rafeq-wa-tooltip.show{opacity:1;transform:translateY(0);}',
      '#rafeq-wa-popup{position:absolute;bottom:'+(btnSize+12)+'px;'+(isRight?'right':'left')+':0;width:320px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.15);overflow:hidden;opacity:0;transform:translateY(12px) scale(.95);transition:opacity .25s,transform .25s;pointer-events:none;}',
      '#rafeq-wa-popup.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}',
      '#rafeq-wa-header{background:'+c.headerColor+';padding:16px;display:flex;align-items:center;gap:12px;}',
      '#rafeq-wa-header .avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;overflow:hidden;}',
      '#rafeq-wa-header .avatar img{width:100%;height:100%;object-fit:cover;}',
      '#rafeq-wa-header .info{color:#fff;}',
      '#rafeq-wa-header .name{font-size:14px;font-weight:600;}',
      '#rafeq-wa-header .status{font-size:11px;opacity:.8;margin-top:2px;}',
      '#rafeq-wa-body{padding:16px;background:#e5ddd5;min-height:80px;background-image:url("data:image/svg+xml,%3Csvg width=\\'400\\' height=\\'400\\' xmlns=\\'http://www.w3.org/2000/svg\\'%3E%3Cpath d=\\'M0 0h400v400H0z\\' fill=\\'%23e5ddd5\\'/%3E%3C/svg%3E");}',
      '#rafeq-wa-msg{background:#fff;border-radius:0 8px 8px 8px;padding:10px 14px;font-size:13px;line-height:1.5;color:#333;box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:90%;position:relative;}',
      '#rafeq-wa-msg::before{content:"";position:absolute;top:0;left:-6px;width:0;height:0;border-top:6px solid #fff;border-left:6px solid transparent;}',
      '#rafeq-wa-footer{padding:12px 16px;}',
      '#rafeq-wa-start{display:block;width:100%;padding:12px;background:'+c.btnColor+';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:opacity .2s;}',
      '#rafeq-wa-start:hover{opacity:.9;}',
      '#rafeq-wa-close{position:absolute;top:12px;'+(isRight?'left':'right')+':12px;background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}',
      '@media(max-width:480px){#rafeq-wa-popup{width:calc(100vw - 40px);'+(isRight?'right':'left')+':-10px;}}',
      '@keyframes rafeqPulse{0%,100%{box-shadow:0 4px 12px rgba(0,0,0,.2)}50%{box-shadow:0 4px 12px rgba(0,0,0,.2),0 0 0 8px rgba(37,211,102,.15)}}',
      '#rafeq-wa-btn{animation:rafeqPulse 3s ease-in-out infinite;}',
    ].join('\\n');
    document.head.appendChild(style);

    // WhatsApp SVG icon
    var waSvg = '<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

    // Build DOM
    var wrap = document.createElement('div');
    wrap.id = 'rafeq-wa-widget';

    var popup = document.createElement('div');
    popup.id = 'rafeq-wa-popup';
    popup.innerHTML = '<div id="rafeq-wa-header" style="position:relative;">' +
      '<div class="avatar">' + (c.avatar ? '<img src="'+c.avatar+'" alt="">' : '\\uD83D\\uDC64') + '</div>' +
      '<div class="info"><div class="name">'+(c.agent||'\\u0641\\u0631\\u064A\\u0642 \\u0627\\u0644\\u062F\\u0639\\u0645')+'</div><div class="status">\\u0645\\u062A\\u0635\\u0644 \\u0627\\u0644\\u0622\\u0646 \\u25CF </div></div>' +
      '<button id="rafeq-wa-close">\\u2715</button>' +
      '</div>' +
      '<div id="rafeq-wa-body"><div id="rafeq-wa-msg">'+(c.welcome||'\\u0645\\u0631\\u062D\\u0628\\u0627\\u064B!')+'</div></div>' +
      '<div id="rafeq-wa-footer"><a id="rafeq-wa-start" href="'+waUrl+'" target="_blank" rel="noopener">\\u0628\\u062F\\u0621 \\u0627\\u0644\\u0645\\u062D\\u0627\\u062F\\u062B\\u0629 \\u2190</a></div>';

    var tooltip = document.createElement('div');
    tooltip.id = 'rafeq-wa-tooltip';
    tooltip.textContent = c.tooltipText || '\\u062A\\u062D\\u062A\\u0627\\u062C \\u0645\\u0633\\u0627\\u0639\\u062F\\u0629\\u061F';

    var btn = document.createElement('button');
    btn.id = 'rafeq-wa-btn';
    btn.innerHTML = waSvg;
    btn.setAttribute('aria-label','WhatsApp');

    wrap.appendChild(popup);
    wrap.appendChild(tooltip);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    // Tooltip auto-show after 3s
    if(c.tooltip){
      setTimeout(function(){ tooltip.classList.add('show'); }, 3000);
      setTimeout(function(){ tooltip.classList.remove('show'); }, 8000);
    }

    // Toggle popup
    var isOpen = false;
    btn.addEventListener('click', function(){
      if(isOpen){
        popup.classList.remove('open');
        tooltip.classList.remove('show');
      } else {
        popup.classList.add('open');
        tooltip.classList.remove('show');
        track('click');
      }
      isOpen = !isOpen;
    });

    document.getElementById('rafeq-wa-close').addEventListener('click', function(e){
      e.stopPropagation();
      popup.classList.remove('open');
      isOpen = false;
    });

    // Close on outside click
    document.addEventListener('click', function(e){
      if(isOpen && !wrap.contains(e.target)){
        popup.classList.remove('open');
        isOpen = false;
      }
    });
  }
})();
`;
