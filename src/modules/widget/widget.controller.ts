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
  @ApiOperation({ summary: 'Widget embed script' })
  getEmbedScript(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(EMBED_SCRIPT);
  }

  /**
   * Widget config — called by embed.js
   * Must handle CORS manually to ensure headers on errors too
   */
  @Get(':storeId/config')
  @ApiOperation({ summary: 'Widget config (public)' })
  async getConfig(@Param('storeId') storeId: string, @Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=60');

    try {
      const config = await this.widgetService.getPublicConfig(storeId);
      res.json(config || { enabled: false });
    } catch {
      res.json({ enabled: false });
    }
  }

  /**
   * Track click/impression
   */
  @Post(':storeId/track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Track widget event' })
  async track(
    @Param('storeId') storeId: string,
    @Res() res: Response,
    @Body() body: { event: 'click' | 'impression' },
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    try {
      if (body.event === 'click') await this.widgetService.trackClick(storeId);
      else if (body.event === 'impression') await this.widgetService.trackImpression(storeId);
    } catch {}

    res.status(204).send();
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
  if(window.__rafeqWidget) return;
  window.__rafeqWidget = true;

  var cfg = window.RafeqWidgetConfig || {};
  var storeId = cfg.storeId;
  if(!storeId){ console.warn('RafeqWidget: missing storeId'); return; }
  var API = (cfg.apiUrl || 'https://api.rafeq.ai') + '/api/widget';

  fetch(API + '/' + storeId + '/config')
    .then(function(r){ return r.json(); })
    .then(function(c){ if(c.enabled) render(c); })
    .catch(function(e){ console.warn('RafeqWidget:', e); });

  function track(ev){
    try{ navigator.sendBeacon(API+'/'+storeId+'/track', JSON.stringify({event:ev})); }catch(e){}
  }

  function render(c){
    var isRight = (c.position||'bottom-right').indexOf('right')>-1;
    var sz = c.iconSize||60;
    var bOff = c.bottomOff||20;
    var phone = (c.phone||'').replace(/[^0-9]/g,'');
    var pf = encodeURIComponent(c.prefilled||'');
    var waUrl = 'https://wa.me/'+phone+(pf?'?text='+pf:'');
    var bs = c.btnStyle||'classic';
    var ba = c.btnAnim||'pulse';
    var ps = c.popupStyle||'whatsapp';
    var bt = c.btnText||'';
    var bc = c.btnColor||'#25D366';
    var hc = c.headerColor||'#075E54';

    if(!c.mobile && /Mobi|Android/i.test(navigator.userAgent)) return;

    // ── BUTTON SHAPES ──
    var btnW = sz, btnH = sz, btnR = '50%', btnPad = '0';
    if(bs==='rounded'){ btnW=sz; btnH=sz; btnR='16px'; }
    else if(bs==='pill'){ btnW='auto'; btnH=sz; btnR=sz+'px'; btnPad='0 20px'; }
    else if(bs==='square'){ btnW=sz; btnH=sz; btnR='12px'; }
    else if(bs==='minimal'){ btnW=sz; btnH=sz; btnR='50%'; }

    // ── ANIMATIONS ──
    var animCSS = '';
    if(ba==='pulse') animCSS='@keyframes rwP{0%,100%{box-shadow:0 4px 12px rgba(0,0,0,.2)}50%{box-shadow:0 4px 12px rgba(0,0,0,.2),0 0 0 10px '+bc+'26}}#rw-btn{animation:rwP 2.5s ease infinite;}';
    else if(ba==='bounce') animCSS='@keyframes rwB{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}#rw-btn{animation:rwB 2s ease infinite;}';
    else if(ba==='shake') animCSS='@keyframes rwS{0%,100%{transform:rotate(0)}25%{transform:rotate(8deg)}75%{transform:rotate(-8deg)}}#rw-btn{animation:rwS 2s ease infinite;}';

    // ── POPUP STYLES ──
    var popupCSS = '';
    var popupHTML = '';
    var popW = 340;

    if(ps==='whatsapp'){
      popupCSS='#rw-pop-hd{background:'+hc+';padding:16px;display:flex;align-items:center;gap:12px;}#rw-pop-hd .av{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;}#rw-pop-hd .inf{color:#fff;}#rw-pop-hd .nm{font-size:15px;font-weight:600;}#rw-pop-hd .st{font-size:11px;opacity:.8;margin-top:2px;}#rw-pop-bd{padding:16px 14px;background:#e5ddd5;min-height:70px;}#rw-pop-mg{background:#fff;border-radius:0 8px 8px 8px;padding:12px 14px;font-size:13px;line-height:1.6;color:#333;box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:88%;position:relative;}#rw-pop-mg::before{content:"";position:absolute;top:0;left:-6px;border-top:6px solid #fff;border-left:6px solid transparent;}#rw-pop-ft{padding:12px 16px;}';
      popupHTML='<div id="rw-pop-hd"><div class="av">'+(c.avatar?'<img src="'+c.avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">':'\\uD83D\\uDC64')+'</div><div class="inf"><div class="nm">'+(c.agent||'\\u0641\\u0631\\u064A\\u0642 \\u0627\\u0644\\u062F\\u0639\\u0645')+'</div><div class="st">\\u0645\\u062A\\u0635\\u0644 \\u0627\\u0644\\u0622\\u0646 \\u25CF</div></div></div><div id="rw-pop-bd"><div id="rw-pop-mg">'+(c.welcome||'\\u0645\\u0631\\u062D\\u0628\\u0627\\u064B!')+'</div></div><div id="rw-pop-ft"><a id="rw-cta" href="'+waUrl+'" target="_blank" rel="noopener">\\u0628\\u062F\\u0621 \\u0627\\u0644\\u0645\\u062D\\u0627\\u062F\\u062B\\u0629 \\u2190</a></div>';
    }
    else if(ps==='modern'){
      popW=320;
      popupCSS='#rw-pop-hd{background:'+bc+';padding:20px;text-align:center;color:#fff;border-radius:16px 16px 0 0;}#rw-pop-hd .nm{font-size:16px;font-weight:700;margin-bottom:4px;}#rw-pop-hd .st{font-size:12px;opacity:.8;}#rw-pop-bd{padding:20px;background:#fff;}#rw-pop-mg{font-size:14px;line-height:1.7;color:#555;text-align:center;}#rw-pop-ft{padding:0 20px 20px;background:#fff;}';
      popupHTML='<div id="rw-pop-hd"><div class="nm">'+(c.agent||'\\u0641\\u0631\\u064A\\u0642 \\u0627\\u0644\\u062F\\u0639\\u0645')+'</div><div class="st">\\u0639\\u0627\\u062F\\u0629 \\u0646\\u0631\\u062F \\u062E\\u0644\\u0627\\u0644 \\u062F\\u0642\\u0627\\u0626\\u0642</div></div><div id="rw-pop-bd"><div id="rw-pop-mg">'+(c.welcome||'\\u0645\\u0631\\u062D\\u0628\\u0627\\u064B!')+'</div></div><div id="rw-pop-ft"><a id="rw-cta" href="'+waUrl+'" target="_blank" rel="noopener">\\u0628\\u062F\\u0621 \\u0627\\u0644\\u0645\\u062D\\u0627\\u062F\\u062B\\u0629 \\u2190</a></div>';
    }
    else if(ps==='minimal'){
      popW=280;
      popupCSS='#rw-pop-bd{padding:20px;background:#fff;}#rw-pop-mg{font-size:14px;line-height:1.6;color:#444;margin-bottom:16px;}#rw-pop-ft{padding:0 20px 20px;background:#fff;}';
      popupHTML='<div id="rw-pop-bd"><div id="rw-pop-mg">'+(c.welcome||'\\u0645\\u0631\\u062D\\u0628\\u0627\\u064B!')+'</div></div><div id="rw-pop-ft"><a id="rw-cta" href="'+waUrl+'" target="_blank" rel="noopener">\\u062A\\u0648\\u0627\\u0635\\u0644 \\u0639\\u0628\\u0631 \\u0648\\u0627\\u062A\\u0633\\u0627\\u0628</a></div>';
    }
    else if(ps==='bubble'){
      popW=300;
      popupCSS='#rw-pop-bd{padding:16px;background:'+bc+';color:#fff;border-radius:16px;}#rw-pop-mg{font-size:14px;line-height:1.6;margin-bottom:12px;}#rw-pop-ft{padding:0;}';
      popupHTML='<div id="rw-pop-bd"><div id="rw-pop-mg">'+(c.welcome||'\\u0645\\u0631\\u062D\\u0628\\u0627\\u064B!')+'</div><div id="rw-pop-ft"><a id="rw-cta" href="'+waUrl+'" target="_blank" rel="noopener" style="background:rgba(255,255,255,.2);color:#fff;">\\u0628\\u062F\\u0621 \\u0627\\u0644\\u0645\\u062D\\u0627\\u062F\\u062B\\u0629</a></div></div>';
    }

    // WhatsApp icon SVG
    var waSvg='<svg viewBox="0 0 24 24" style="width:'+(sz*0.5)+'px;height:'+(sz*0.5)+'px;fill:#fff;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

    // Build CSS
    var style=document.createElement('style');
    style.textContent=[
      '#rw-wrap{position:fixed;bottom:'+bOff+'px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;direction:rtl;}'
      +(isRight?'#rw-wrap{right:20px;}':'#rw-wrap{left:20px;}'),
      '#rw-btn{width:'+btnW+(typeof btnW==='number'?'px':'')+';height:'+btnH+'px;border-radius:'+btnR+';background:'+(c.customIcon?'transparent':(bs==='minimal'?'transparent':bc))+';border:'+(c.customIcon?'none':(bs==='minimal'?'2px solid '+bc:'none'))+';cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:'+(c.customIcon?'none':(bs==='minimal'?'none':'0 4px 16px rgba(0,0,0,.2)'))+';transition:transform .2s,box-shadow .2s;padding:'+btnPad+';}',
      '#rw-btn:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.25);}',
      bs==='minimal'?'#rw-btn svg{fill:'+bc+' !important;}':'',
      bt?'#rw-btn-txt{color:#fff;font-size:14px;font-weight:600;white-space:nowrap;}'+(bs==='minimal'?'#rw-btn-txt{color:'+bc+';}':''):'',
      '#rw-tip{position:absolute;bottom:'+(sz+12)+'px;'+(isRight?'right':'left')+':0;background:#fff;color:#333;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.12);white-space:nowrap;opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;pointer-events:none;}',
      '#rw-tip.show{opacity:1;transform:translateY(0);}',
      '#rw-pop{position:absolute;bottom:'+(sz+14)+'px;'+(isRight?'right':'left')+':0;width:'+popW+'px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);overflow:hidden;opacity:0;transform:translateY(12px) scale(.95);transition:opacity .25s,transform .25s;pointer-events:none;}',
      '#rw-pop.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}',
      '#rw-cta{display:block;width:100%;padding:12px;background:'+bc+';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:opacity .2s;box-sizing:border-box;}',
      '#rw-cta:hover{opacity:.9;}',
      '#rw-x{position:absolute;top:10px;'+(isRight?'left':'right')+':10px;background:rgba(0,0,0,.15);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;z-index:1;}',
      popupCSS,
      animCSS,
      '@media(max-width:480px){#rw-pop{width:calc(100vw - 40px);'+(isRight?'right':'left')+':-10px;}}',
    ].join('\\n');
    document.head.appendChild(style);

    // Build DOM
    var wrap=document.createElement('div');wrap.id='rw-wrap';
    var pop=document.createElement('div');pop.id='rw-pop';
    pop.innerHTML='<button id="rw-x">\\u2715</button>'+popupHTML;
    var tip=document.createElement('div');tip.id='rw-tip';
    tip.textContent=c.tooltipText||'\\u062A\\u062D\\u062A\\u0627\\u062C \\u0645\\u0633\\u0627\\u0639\\u062F\\u0629\\u061F';
    var btnIcon=c.customIcon?'<img src="'+c.customIcon+'" style="max-width:'+sz+'px;max-height:'+sz+'px;display:block;" alt="icon">':waSvg;
    var btn=document.createElement('button');btn.id='rw-btn';
    btn.innerHTML=btnIcon+(bt?'<span id="rw-btn-txt">'+bt+'</span>':'');
    btn.setAttribute('aria-label','WhatsApp');

    wrap.appendChild(pop);wrap.appendChild(tip);wrap.appendChild(btn);
    document.body.appendChild(wrap);
    track('impression');

    if(c.tooltip){setTimeout(function(){tip.classList.add('show');},3000);setTimeout(function(){tip.classList.remove('show');},8000);}

    var isOpen=false;
    btn.addEventListener('click',function(){
      if(isOpen){pop.classList.remove('open');tip.classList.remove('show');}
      else{pop.classList.add('open');tip.classList.remove('show');track('click');}
      isOpen=!isOpen;
    });
    document.getElementById('rw-x').addEventListener('click',function(e){e.stopPropagation();pop.classList.remove('open');isOpen=false;});
    document.addEventListener('click',function(e){if(isOpen&&!wrap.contains(e.target)){pop.classList.remove('open');isOpen=false;}});

    // Show popup on hover
    if(c.hoverOpen){
      btn.addEventListener('mouseenter',function(){
        if(!isOpen){pop.classList.add('open');tip.classList.remove('show');isOpen=true;track('click');}
      });
    }

    // Auto-open popup after idle time
    if(c.autoOpen>0){
      setTimeout(function(){
        if(!isOpen){pop.classList.add('open');tip.classList.remove('show');isOpen=true;track('click');}
      }, c.autoOpen*1000);
    }
  }

  // ─── Load Conversion Elements embed.js automatically ──────
  // This ensures ONE snippet powers ALL Rafeq features
  if(!window.__rafeqElements){
    var elScript = document.createElement('script');
    elScript.src = ((window.RafeqWidgetConfig||{}).apiUrl || 'https://api.rafeq.ai') + '/api/elements/embed.js';
    elScript.async = true;
    document.head.appendChild(elScript);
  }
})();
`;
