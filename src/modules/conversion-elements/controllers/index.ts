/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Conversion Elements Controllers                      ║
 * ║                                                                                ║
 * ║  Public Controller (no auth):                                                  ║
 * ║    GET  /elements/embed.js              → Embed script                        ║
 * ║    GET  /elements/:storeId/active       → Active elements for storefront      ║
 * ║    POST /elements/:storeId/track        → Track single event                  ║
 * ║    POST /elements/:storeId/track/batch  → Track batch events                  ║
 * ║                                                                                ║
 * ║  Merchant Controller (JWT auth):                                               ║
 * ║    GET    /elements                     → List all elements                   ║
 * ║    POST   /elements                     → Create element                      ║
 * ║    GET    /elements/:id                 → Get element                         ║
 * ║    PUT    /elements/:id                 → Update element                      ║
 * ║    PATCH  /elements/:id/status          → Update status                       ║
 * ║    POST   /elements/:id/duplicate       → Duplicate element                   ║
 * ║    DELETE /elements/:id                 → Delete element                      ║
 * ║                                                                                ║
 * ║  Analytics Controller (JWT auth):                                              ║
 * ║    GET /elements/analytics/overview     → Overview stats                      ║
 * ║    GET /elements/analytics/timeseries   → Time series chart data              ║
 * ║    GET /elements/analytics/performance  → Per-element breakdown               ║
 * ║    GET /elements/analytics/funnel       → Conversion funnel                   ║
 * ║                                                                                ║
 * ║  A/B Test Controller (JWT auth):                                               ║
 * ║    POST /elements/ab-tests              → Create test                         ║
 * ║    GET  /elements/ab-tests              → List tests                          ║
 * ║    GET  /elements/ab-tests/:id/results  → Test results                        ║
 * ║    POST /elements/ab-tests/:id/complete → Complete test                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  Res, HttpCode, HttpStatus, UseGuards, NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ConversionElementsService } from '../services/conversion-elements.service';
import { ElementTrackingService } from '../services/element-tracking.service';
import { ElementAnalyticsService } from '../services/element-analytics.service';
import { Store } from '../../stores/entities/store.entity';
import {
  CreateElementDto, UpdateElementDto, TrackEventDto, BatchTrackDto,
  AnalyticsQueryDto, CreateABTestDto,
} from '../dto';
import { ElementStatus } from '../entities/conversion-element.entity';

// ═══════════════════════════════════════════════════════════════
// 🌐 PUBLIC CONTROLLER — no auth, for embed script
// ═══════════════════════════════════════════════════════════════

@ApiTags('Conversion Elements: Public')
@Controller({ path: 'elements', version: '1' })
export class ElementsPublicController {
  constructor(
    private readonly elementsService: ConversionElementsService,
    private readonly trackingService: ElementTrackingService,
  ) {}

  @Get('embed.js')
  @ApiOperation({ summary: 'Conversion elements embed script' })
  getEmbedScript(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.send(ELEMENTS_EMBED_SCRIPT);
  }

  @Get(':storeId/active')
  @ApiOperation({ summary: 'Active elements for storefront' })
  async getActiveElements(@Param('storeId') storeId: string, @Res() res: Response) {
    this.setCorsHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

    try {
      const elements = await this.elementsService.getPublicElements(storeId);
      res.json({ elements });
    } catch {
      res.json({ elements: [] });
    }
  }

  @Get(':storeId/debug')
  @ApiOperation({ summary: 'Debug: check active elements for a store' })
  async debugElements(@Param('storeId') storeId: string, @Res() res: Response) {
    this.setCorsHeaders(res);
    res.setHeader('Cache-Control', 'no-cache');

    try {
      const elements = await this.elementsService.getPublicElements(storeId);
      res.json({
        storeId,
        resolvedAt: new Date().toISOString(),
        activeCount: elements.length,
        elements: elements.map(el => ({
          id: (el as any).id,
          type: (el as any).type,
          position: (el as any).position,
          targeting: (el as any).targeting,
          behavior: (el as any).behavior,
        })),
        hint: elements.length === 0
          ? 'لا توجد عناصر نشطة — تأكد أن العنصر بحالة active وليس draft'
          : 'العناصر موجودة — إذا لا تظهر أضف ?rfq_debug=1 لرابط المتجر',
      });
    } catch (e: any) {
      res.json({ error: e.message, storeId });
    }
  }

  /**
   * CORS preflight handler for track endpoints.
   * Browsers send OPTIONS before POST from cross-origin storefronts.
   */
  @Post(':storeId/track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Track element event' })
  async trackEvent(
    @Param('storeId') storeId: string,
    @Body() dto: TrackEventDto,
    @Res() res: Response,
  ) {
    this.setCorsHeaders(res);

    try {
      // storeId is resolved inside the service (supports UUID + Salla numeric IDs)
      await this.trackingService.trackEvent(storeId, dto);
    } catch {}

    res.status(204).send();
  }

  @Post(':storeId/track/batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Track batch element events' })
  async trackBatch(
    @Param('storeId') storeId: string,
    @Body() dto: BatchTrackDto,
    @Res() res: Response,
  ) {
    this.setCorsHeaders(res);

    try {
      // storeId is resolved inside the service (supports UUID + Salla numeric IDs)
      await this.trackingService.trackBatch(storeId, dto.events);
    } catch {}

    res.status(204).send();
  }

  /** Shared CORS headers for all public endpoints */
  private setCorsHeaders(res: Response): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔐 MERCHANT CONTROLLER — JWT auth
// ═══════════════════════════════════════════════════════════════

@ApiTags('Conversion Elements: Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'elements/manage', version: '1' })
export class ElementsManageController {
  constructor(
    private readonly elementsService: ConversionElementsService,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  private async getStoreId(tenantId: string): Promise<string> {
    const store = await this.storeRepo.findOne({
      where: { tenantId },
      select: ['id'],
      order: { createdAt: 'DESC' },
    });
    if (!store) throw new NotFoundException('لم يتم العثور على متجر لهذا الحساب');
    return store.id;
  }

  @Get()
  @ApiOperation({ summary: 'List all conversion elements' })
  async findAll(@CurrentUser() user: any) {
    const storeId = await this.getStoreId(user.tenantId);
    return this.elementsService.findAll(storeId, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new conversion element' })
  async create(@CurrentUser() user: any, @Body() dto: CreateElementDto) {
    const storeId = await this.getStoreId(user.tenantId);
    return this.elementsService.create(storeId, user.tenantId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a conversion element' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.elementsService.findOne(id, user.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a conversion element' })
  async update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateElementDto) {
    return this.elementsService.update(id, user.tenantId, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update element status' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('status') status: ElementStatus,
  ) {
    return this.elementsService.updateStatus(id, user.tenantId, status);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate an element' })
  async duplicate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.elementsService.duplicate(id, user.tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an element' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.elementsService.remove(id, user.tenantId);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📊 ANALYTICS CONTROLLER — JWT auth
// ═══════════════════════════════════════════════════════════════

@ApiTags('Conversion Elements: Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'elements/analytics', version: '1' })
export class ElementsAnalyticsController {
  constructor(
    private readonly analyticsService: ElementAnalyticsService,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  private async getStoreId(tenantId: string): Promise<string> {
    const store = await this.storeRepo.findOne({
      where: { tenantId },
      select: ['id'],
      order: { createdAt: 'DESC' },
    });
    if (!store) throw new NotFoundException('لم يتم العثور على متجر');
    return store.id;
  }

  private getDateRange(query: AnalyticsQueryDto) {
    const endDate = query.endDate || new Date().toISOString().slice(0, 10);
    const startDate = query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { startDate, endDate };
  }

  @Get('overview')
  @ApiOperation({ summary: 'Overview stats' })
  async getOverview(@CurrentUser() user: any, @Query() query: AnalyticsQueryDto) {
    const storeId = await this.getStoreId(user.tenantId);
    const { startDate, endDate } = this.getDateRange(query);
    return this.analyticsService.getOverview(storeId, user.tenantId, startDate, endDate);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Time series chart data' })
  async getTimeSeries(@CurrentUser() user: any, @Query() query: AnalyticsQueryDto) {
    const storeId = await this.getStoreId(user.tenantId);
    const { startDate, endDate } = this.getDateRange(query);
    return this.analyticsService.getTimeSeries(storeId, startDate, endDate, query.elementId);
  }

  @Get('performance')
  @ApiOperation({ summary: 'Per-element performance breakdown' })
  async getPerformance(@CurrentUser() user: any, @Query() query: AnalyticsQueryDto) {
    const storeId = await this.getStoreId(user.tenantId);
    const { startDate, endDate } = this.getDateRange(query);
    return this.analyticsService.getElementsPerformance(storeId, startDate, endDate);
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Conversion funnel' })
  async getFunnel(@CurrentUser() user: any, @Query() query: AnalyticsQueryDto) {
    const storeId = await this.getStoreId(user.tenantId);
    const { startDate, endDate } = this.getDateRange(query);
    return this.analyticsService.getFunnel(storeId, startDate, endDate, query.elementId);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🧪 A/B TEST CONTROLLER — JWT auth
// ═══════════════════════════════════════════════════════════════

@ApiTags('Conversion Elements: A/B Tests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'elements/ab-tests', version: '1' })
export class ElementsABTestController {
  constructor(
    private readonly elementsService: ConversionElementsService,
    private readonly analyticsService: ElementAnalyticsService,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  private async getStoreId(tenantId: string): Promise<string> {
    const store = await this.storeRepo.findOne({
      where: { tenantId },
      select: ['id'],
      order: { createdAt: 'DESC' },
    });
    if (!store) throw new NotFoundException('لم يتم العثور على متجر');
    return store.id;
  }

  @Post()
  @ApiOperation({ summary: 'Create A/B test' })
  async create(@CurrentUser() user: any, @Body() dto: CreateABTestDto) {
    const storeId = await this.getStoreId(user.tenantId);
    return this.elementsService.createABTest(storeId, user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List A/B tests' })
  async findAll(@CurrentUser() user: any) {
    const storeId = await this.getStoreId(user.tenantId);
    return this.elementsService.getABTests(storeId, user.tenantId);
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'A/B test results' })
  async getResults(@Param('id') id: string, @CurrentUser() user: any) {
    return this.analyticsService.getABTestResults(id, user.tenantId);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete A/B test with winner' })
  async complete(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('winner') winner: 'A' | 'B',
  ) {
    return this.elementsService.completeABTest(id, user.tenantId, winner);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📜 EMBED SCRIPT — Elements Engine for Storefront
// ═══════════════════════════════════════════════════════════════

const ELEMENTS_EMBED_SCRIPT = `
(function(){
  'use strict';
  if(window.__rafeqElements) return;
  window.__rafeqElements = true;

  var cfg = window.RafeqConfig || window.RafeqWidgetConfig || {};
  var storeId = cfg.storeId;
  if(!storeId){ console.warn('Rafeq: missing storeId'); return; }
  var API = (cfg.apiUrl || 'https://api.rafeq.ai') + '/api/elements';

  // ─── Debug Mode ──────────────────────────────────────────────
  var urlParams = new URLSearchParams(window.location.search);
  var DEBUG = urlParams.get('rfq_debug')==='1' || localStorage.getItem('rfq_debug')==='1';
  var FORCE = urlParams.get('rfq_force')==='1';
  function dbg(){if(DEBUG)console.log.apply(console,['%c[Rafeq Elements]','color:#10b981;font-weight:bold'].concat(Array.prototype.slice.call(arguments)))}
  if(DEBUG){dbg('✅ Debug ON | storeId='+storeId+' | API='+API);if(FORCE)dbg('⚡ FORCE mode — bypassing frequency & targeting')}

  // ─── Session & Visitor IDs ──────────────────────────────────
  var SESSION_KEY = 'rfq_sid';
  var VISITOR_KEY = 'rfq_vid';
  var FREQ_KEY = 'rfq_freq_';

  function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:r&0x3|0x8).toString(16)})}

  function getSession(){
    var s=sessionStorage.getItem(SESSION_KEY);
    if(!s){s=uuid();sessionStorage.setItem(SESSION_KEY,s)}
    return s;
  }

  function getVisitor(){
    var v=localStorage.getItem(VISITOR_KEY);
    if(!v){v=uuid();localStorage.setItem(VISITOR_KEY,v)}
    return v;
  }

  var sessionId = getSession();
  var visitorId = getVisitor();
  var eventBuffer = [];
  var flushTimer = null;

  // ─── Device Detection ──────────────────────────────────────
  function getDevice(){
    var w=window.innerWidth;
    if(w<768) return 'mobile';
    if(w<1024) return 'tablet';
    return 'desktop';
  }

  // ─── UTM Parsing ──────────────────────────────────────────
  function getUTM(){
    var params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get('utm_source')||'',
      utmMedium: params.get('utm_medium')||'',
      utmCampaign: params.get('utm_campaign')||''
    };
  }

  // ─── Track Event ──────────────────────────────────────────
  function track(eventType, elementId, extra){
    var utm = getUTM();
    var ev = Object.assign({
      eventType: eventType,
      elementId: elementId,
      sessionId: sessionId,
      visitorId: visitorId,
      pageUrl: window.location.href,
      pageType: detectPageType(),
      deviceType: getDevice(),
      utmSource: utm.utmSource,
      utmMedium: utm.utmMedium,
      utmCampaign: utm.utmCampaign
    }, extra||{});
    eventBuffer.push(ev);
    scheduleFlush();
  }

  function scheduleFlush(){
    if(flushTimer) return;
    flushTimer = setTimeout(flushEvents, 2000);
  }

  function flushEvents(){
    flushTimer = null;
    if(!eventBuffer.length) return;
    var batch = eventBuffer.splice(0, eventBuffer.length);
    var body = JSON.stringify({events: batch});
    try{
      if(navigator.sendBeacon){
        navigator.sendBeacon(API+'/'+storeId+'/track/batch', new Blob([body],{type:'application/json'}));
      } else {
        fetch(API+'/'+storeId+'/track/batch',{method:'POST',body:body,headers:{'Content-Type':'application/json'},keepalive:true});
      }
    }catch(e){}
  }

  // Flush on page unload
  window.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flushEvents()});
  window.addEventListener('pagehide',flushEvents);

  // ─── Page Type Detection ──────────────────────────────────
  function detectPageType(){
    var p = window.location.pathname.toLowerCase();
    if(p==='/'||p==='/index') return 'home';
    if(p.includes('/cart')||p.includes('/سلة')) return 'cart';
    if(p.includes('/checkout')||p.includes('/الدفع')) return 'checkout';
    if(p.includes('/product')||p.includes('/products')||p.includes('/منتج')) return 'product';
    if(p.includes('/categor')||p.includes('/تصنيف')) return 'category';
    return 'other';
  }

  // ─── Frequency Check ──────────────────────────────────────
  function shouldShow(el){
    var freq = (el.behavior && el.behavior.frequency) || {};
    var key = FREQ_KEY + el.id;
    if(freq.type==='once'){
      if(localStorage.getItem(key)) return false;
    } else if(freq.type==='once_per_session'){
      if(sessionStorage.getItem(key)) return false;
    } else if(freq.type==='every_x_hours' && freq.value){
      var last = parseInt(localStorage.getItem(key)||'0');
      if(Date.now() - last < freq.value * 3600000) return false;
    }
    return true;
  }

  function markShown(el){
    var freq = (el.behavior && el.behavior.frequency) || {};
    var key = FREQ_KEY + el.id;
    if(freq.type==='once'||freq.type==='every_x_hours'||freq.type==='every_x_days'){
      localStorage.setItem(key, ''+Date.now());
    } else if(freq.type==='once_per_session'){
      sessionStorage.setItem(key, '1');
    }
  }

  // ─── Targeting Check ──────────────────────────────────────
  function matchesTargeting(el){
    var t = el.targeting || {};

    // Device
    if(t.device && t.device.type && t.device.type!=='all'){
      if(getDevice()!==t.device.type) return false;
    }

    // Page type
    if(t.pages && t.pages.pageTypes && t.pages.pageTypes.length){
      var pt = detectPageType();
      if(t.pages.type==='include' && t.pages.pageTypes.indexOf(pt)===-1) return false;
      if(t.pages.type==='exclude' && t.pages.pageTypes.indexOf(pt)>-1) return false;
    }

    return true;
  }

  // ─── A/B Split ────────────────────────────────────────────
  function getABVariant(abTestId){
    var key = 'rfq_ab_'+abTestId;
    var v = sessionStorage.getItem(key);
    if(!v){
      // Hash session ID to get consistent split
      var hash = 0;
      for(var i=0;i<sessionId.length;i++){hash=((hash<<5)-hash)+sessionId.charCodeAt(i);hash|=0;}
      v = (Math.abs(hash)%100) < 50 ? 'A' : 'B';
      sessionStorage.setItem(key, v);
    }
    return v;
  }

  // ─── Element Renderers ────────────────────────────────────
  var renderers = {
    social_proof: renderSocialProof,
    urgency_countdown: renderCountdown,
    urgency_scarcity: renderScarcity,
    smart_offer: renderSmartOffer,
    free_shipping_bar: renderFreeShippingBar,
    announcement_bar: renderAnnouncementBar,
    whatsapp_cta: renderWhatsAppCTA,
    spin_wheel: renderSpinWheel,
    lead_form: renderLeadForm,
    upsell: renderUpsell,
    cross_sell: renderCrossSell,
    trust_badges: renderTrustBadges,
    sticky_atc: renderStickyATC,
    reviews_widget: renderReviewsWidget,
    page_visitors: renderPageVisitors,
    visitors_bar: renderVisitorsBar,
    live_orders: renderLiveOrders,
    coupon_widget: renderCouponWidget,
    discount_bar: renderDiscountBar,
    coupon_alert: renderCouponAlert,
    whatsapp_bar: renderWhatsAppBar,
    store_stories: renderStoreStories,
    mini_stories: renderMiniStories,
    cookie_policy: renderCookiePolicy,
    ask_product: renderAskProduct,
    rate_us: renderRateUs,
    customer_satisfaction: renderCustomerSatisfaction,
    newsletter: renderNewsletter,
    mobile_subscribe: renderMobileSubscribe,
  };

  // ─── Main Init ────────────────────────────────────────────
  function init(){
    dbg('🔄 Fetching active elements...');
    fetch(API+'/'+storeId+'/active')
      .then(function(r){return r.json()})
      .then(function(data){
        var elements = data.elements || [];
        dbg('📦 Received '+elements.length+' element(s)', elements.map(function(e){return e.type+' ('+e.id.slice(0,8)+'...)'}));
        var abGroups = {};

        elements.forEach(function(el){
          // A/B test filtering
          if(el.abTestId){
            if(!abGroups[el.abTestId]) abGroups[el.abTestId]=[];
            abGroups[el.abTestId].push(el);
            return;
          }

          if(!FORCE && !matchesTargeting(el)){dbg('⛔ Targeting blocked: '+el.type, el.targeting);return}
          if(!FORCE && !shouldShow(el)){dbg('⛔ Frequency blocked: '+el.type+' (already shown)',el.behavior&&el.behavior.frequency);return}
          dbg('✅ Rendering: '+el.type);
          scheduleElement(el);
        });

        // Process A/B test groups
        Object.keys(abGroups).forEach(function(testId){
          var variants = abGroups[testId];
          var chosen = getABVariant(testId);
          var el = variants.find(function(v){return v.variant===chosen}) || variants[0];
          if(el && (FORCE || (matchesTargeting(el) && shouldShow(el)))){
            scheduleElement(el);
          }
        });

        if(elements.length===0) dbg('⚠️ No active elements for this store');
      })
      .catch(function(e){console.warn('Rafeq Elements:',e);dbg('❌ Fetch error:',e)});
  }

  function scheduleElement(el){
    var b = el.behavior || {};
    var trigger = b.trigger || 'immediate';
    var delay = parseInt(b.triggerValue) || 0;

    if(trigger==='immediate'){
      renderElement(el);
    } else if(trigger==='delay'){
      setTimeout(function(){renderElement(el)}, delay*1000);
    } else if(trigger==='scroll'){
      var pct = delay || 50;
      var fired = false;
      window.addEventListener('scroll',function(){
        if(fired) return;
        var scrollPct = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
        if(scrollPct >= pct){fired=true;renderElement(el);}
      });
    } else if(trigger==='exit_intent'){
      var fired2 = false;
      document.addEventListener('mouseout',function(e){
        if(fired2) return;
        if(e.clientY<0){fired2=true;renderElement(el);}
      });
    }
  }

  function renderElement(el){
    markShown(el);
    track('element_view', el.id);
    var renderer = renderers[el.type];
    if(renderer) renderer(el);
  }

  // ─── RENDERERS ────────────────────────────────────────────

  function renderSocialProof(el){
    var c = el.content || {};
    var d = el.design || {};
    var sp = c.socialProof || {};
    var tpl = sp.messageTemplate || '{name} اشترى هذا المنتج منذ {time}';
    var names = ['أحمد','سارة','خالد','نورة','محمد','فاطمة','عبدالله','ريم','عمر','لمياء'];
    var times = ['دقيقتين','5 دقائق','10 دقائق','ساعة','3 ساعات'];

    var box = document.createElement('div');
    box.className = 'rfq-social-proof';
    box.style.cssText = 'position:fixed;bottom:20px;'+(el.position==='bottom_left'?'left':'right')+':20px;z-index:999990;max-width:340px;padding:14px 18px;background:'+(d.bgColor||'#fff')+';color:'+(d.textColor||'#333')+';border-radius:'+(d.borderRadius||12)+'px;box-shadow:0 4px 24px rgba(0,0,0,.12);font-family:inherit;font-size:14px;direction:rtl;opacity:0;transform:translateY(20px);transition:all .4s ease;cursor:pointer;';
    document.body.appendChild(box);

    var interval = (sp.fakePurchaseInterval || 8) * 1000;
    var duration = (sp.displayDuration || 5) * 1000;
    var shown = 0;
    var max = sp.maxPerSession || 5;

    function showNotification(){
      if(shown >= max) return;
      var name = names[Math.floor(Math.random()*names.length)];
      var time = times[Math.floor(Math.random()*times.length)];
      box.innerHTML = '🛒 ' + tpl.replace('{name}',name).replace('{time}',time).replace('{product}',c.title||'');
      box.style.opacity='1';box.style.transform='translateY(0)';
      shown++;
      setTimeout(function(){box.style.opacity='0';box.style.transform='translateY(20px)'},duration);
    }

    setTimeout(showNotification, 3000);
    setInterval(showNotification, interval + duration);

    box.addEventListener('click',function(){track('element_click',el.id)});
  }

  function renderCountdown(el){
    var c = el.content || {};
    var d = el.design || {};
    var u = c.urgency || {};
    var endDate = u.endDate ? new Date(u.endDate) : new Date(Date.now()+86400000);

    var bar = document.createElement('div');
    bar.className = 'rfq-countdown';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999991;padding:10px 20px;background:'+(d.bgColor||'#dc2626')+';color:'+(d.textColor||'#fff')+';text-align:center;font-size:15px;font-weight:600;direction:rtl;font-family:inherit;display:flex;justify-content:center;align-items:center;gap:12px;';
    document.body.appendChild(bar);
    document.body.style.marginTop = (bar.offsetHeight)+'px';

    function updateTimer(){
      var diff = endDate - Date.now();
      if(diff<=0){bar.textContent=u.expiredMessage||'انتهى العرض!';return}
      var h=Math.floor(diff/3600000);var m=Math.floor((diff%3600000)/60000);var s=Math.floor((diff%60000)/1000);
      var title = c.title ? c.title+' · ' : '';
      bar.innerHTML = title+'<span style="font-variant-numeric:tabular-nums">'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'</span>';
    }
    updateTimer();
    setInterval(updateTimer,1000);
    track('element_view',el.id);
  }

  function renderScarcity(el){
    var c = el.content || {};
    var sc = c.scarcity || {};
    var stock = sc.currentStock || Math.floor(Math.random()*8)+1;
    var d = el.design || {};

    var badge = document.createElement('div');
    badge.className = 'rfq-scarcity';
    badge.style.cssText = 'position:fixed;bottom:20px;'+(el.position==='bottom_left'?'left':'right')+':20px;z-index:999990;padding:12px 20px;background:'+(d.bgColor||'#fef2f2')+';color:'+(sc.warningColor||d.textColor||'#dc2626')+';border-radius:'+(d.borderRadius||10)+'px;font-weight:600;font-size:14px;direction:rtl;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,.1);animation:rfqPulse 2s ease infinite;';
    badge.textContent = '🔥 ' + (sc.showExact ? 'بقي '+stock+' فقط!' : 'بقي أقل من '+(stock+2)+'!');
    
    var style = document.createElement('style');
    style.textContent='@keyframes rfqPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}';
    document.head.appendChild(style);
    document.body.appendChild(badge);
    badge.addEventListener('click',function(){track('element_click',el.id)});
  }

  function renderSmartOffer(el){
    var c = el.content || {};
    var d = el.design || {};

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,'+(d.overlayOpacity||.5)+');z-index:999992;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;';
    
    var modal = document.createElement('div');
    modal.style.cssText = 'background:'+(d.bgColor||'#fff')+';color:'+(d.textColor||'#1f2937')+';border-radius:'+(d.borderRadius||16)+'px;padding:32px;max-width:'+(d.maxWidth||420)+'px;width:90%;text-align:center;direction:rtl;font-family:inherit;position:relative;transform:scale(.9);transition:transform .3s;';
    modal.innerHTML = (c.imageUrl?'<img src="'+c.imageUrl+'" style="width:100%;border-radius:8px;margin-bottom:16px">':'')+
      '<h3 style="font-size:'+(d.titleFontSize||22)+'px;font-weight:700;margin:0 0 8px">'+(c.title||'عرض خاص!')+'</h3>'+
      '<p style="font-size:'+(d.bodyFontSize||15)+'px;opacity:.8;margin:0 0 20px">'+(c.description||'')+'</p>'+
      (c.button?'<a href="'+(c.button.url||'#')+'" style="display:inline-block;padding:12px 32px;background:'+(c.button.bgColor||d.accentColor||'#2563eb')+';color:'+(c.button.textColor||'#fff')+';border-radius:'+(c.button.borderRadius||10)+'px;font-size:'+(c.button.fontSize||15)+'px;font-weight:600;text-decoration:none;transition:opacity .2s" id="rfq-offer-cta">'+(c.button.text||'احصل على العرض')+'</a>':'')+
      '<button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center" id="rfq-offer-close">✕</button>';
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    requestAnimationFrame(function(){overlay.style.opacity='1';modal.style.transform='scale(1)'});

    overlay.querySelector('#rfq-offer-close').addEventListener('click',function(){
      overlay.style.opacity='0';
      setTimeout(function(){overlay.remove()},300);
      track('element_close',el.id);
    });

    var cta = overlay.querySelector('#rfq-offer-cta');
    if(cta) cta.addEventListener('click',function(){track('element_click',el.id)});

    if(d.overlayColor!==false){
      overlay.addEventListener('click',function(e){
        if(e.target===overlay){overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);track('element_close',el.id)}
      });
    }
  }

  function renderFreeShippingBar(el){
    var c = el.content || {};
    var d = el.design || {};
    var fs = c.freeShipping || {};
    var threshold = fs.threshold || 200;
    var currency = fs.currency || 'ر.س';

    var bar = document.createElement('div');
    bar.className = 'rfq-free-shipping';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999991;padding:10px 20px;background:'+(d.bgColor||'#065f46')+';color:'+(d.textColor||'#fff')+';text-align:center;font-size:14px;font-weight:500;direction:rtl;font-family:inherit;';

    // Try to get cart value from page
    var cartValue = 0;
    if(window.__rafeqCart) cartValue = window.__rafeqCart.total || 0;

    var remaining = Math.max(0, threshold - cartValue);
    if(remaining > 0){
      bar.innerHTML = '🚚 أضف <strong>'+remaining+' '+currency+'</strong> للحصول على شحن مجاني! <div style="height:4px;background:rgba(255,255,255,.3);border-radius:2px;margin-top:6px;overflow:hidden"><div style="height:100%;background:'+(fs.progressBarColor||'#34d399')+';border-radius:2px;width:'+Math.min(100,Math.round(cartValue/threshold*100))+'%;transition:width .3s"></div></div>';
    } else {
      bar.innerHTML = '🎉 ' + (fs.completedMessage || 'مبروك! الشحن مجاني');
    }

    document.body.appendChild(bar);
    document.body.style.marginTop = (bar.offsetHeight)+'px';
  }

  function renderAnnouncementBar(el){
    var c = el.content || {};
    var d = el.design || {};
    var a = c.announcement || {};

    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999991;padding:10px 20px;background:'+(d.bgColor||'#1e40af')+';color:'+(d.textColor||'#fff')+';text-align:center;font-size:14px;font-weight:500;direction:rtl;font-family:inherit;';
    bar.innerHTML = (a.text||'') + (a.linkText&&a.linkUrl?' <a href="'+a.linkUrl+'" style="color:inherit;text-decoration:underline;font-weight:700" onclick="window.__rafeqTrack(\\'element_click\\',\\''+el.id+'\\')">'+a.linkText+'</a>':'');

    if(a.dismissible!==false){
      var closeBtn = document.createElement('button');
      closeBtn.textContent='✕';
      closeBtn.style.cssText='position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:inherit;font-size:16px;cursor:pointer;opacity:.7';
      closeBtn.addEventListener('click',function(){bar.remove();document.body.style.marginTop='0'});
      bar.style.position='relative';
      bar.appendChild(closeBtn);
    }

    document.body.appendChild(bar);
    document.body.style.marginTop=(bar.offsetHeight)+'px';
  }

  function renderWhatsAppCTA(el){
    var c = el.content || {};
    var d = el.design || {};
    var w = c.whatsapp || {};
    var phone = (w.phone||'').replace(/[^0-9]/g,'');
    var msg = encodeURIComponent(w.prefilledMessage||'مرحباً!');
    var url = 'https://wa.me/'+phone+'?text='+msg;

    var btn = document.createElement('a');
    btn.href = url;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.style.cssText = 'position:fixed;bottom:20px;'+(el.position==='bottom_left'?'left':'right')+':20px;z-index:999990;width:56px;height:56px;border-radius:50%;background:'+(d.bgColor||'#25D366')+';display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer;transition:transform .2s;animation:rfqPulse 2.5s ease infinite;text-decoration:none;';
    btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
    btn.addEventListener('click',function(){track('element_cta_click',el.id)});

    var style = document.createElement('style');
    style.textContent='@keyframes rfqPulse{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,.2)}50%{box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 0 10px rgba(37,211,102,.15)}}';
    document.head.appendChild(style);
    document.body.appendChild(btn);
  }

  function renderSpinWheel(el){
    // Spin wheel is complex — renders as a modal with canvas
    var c = el.content || {};
    var d = el.design || {};
    var sw = c.spinWheel || {};
    var segments = sw.segments || [
      {label:'خصم 10%',discount:10,probability:40,color:'#3b82f6'},
      {label:'خصم 20%',discount:20,probability:20,color:'#8b5cf6'},
      {label:'شحن مجاني',discount:0,probability:30,color:'#10b981'},
      {label:'خصم 50%',discount:50,probability:10,color:'#f59e0b'}
    ];

    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999993;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;direction:rtl;font-family:inherit;';
    overlay.innerHTML='<div style="background:#fff;border-radius:20px;padding:32px;max-width:400px;width:90%;text-align:center;position:relative"><button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px" id="rfq-spin-close">✕</button><h3 style="font-size:20px;font-weight:700;margin:0 0 8px">'+(c.title||'أدِر العجلة واربح!')+'</h3><p style="font-size:14px;color:#666;margin:0 0 20px">'+(c.description||'لديك فرصة واحدة للفوز بخصم حصري')+'</p><canvas id="rfq-wheel" width="300" height="300" style="margin:0 auto;display:block"></canvas><button id="rfq-spin-btn" style="margin-top:16px;padding:12px 32px;background:'+(d.accentColor||'#2563eb')+';color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">أدِر العجلة 🎰</button><div id="rfq-spin-result" style="display:none;margin-top:16px;padding:16px;background:#f0fdf4;border-radius:10px;font-size:18px;font-weight:700;color:#16a34a"></div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){overlay.style.opacity='1'});

    var canvas=document.getElementById('rfq-wheel');
    var ctx=canvas.getContext('2d');
    var cx=150,cy=150,r=140;
    var arc=Math.PI*2/segments.length;
    var angle=0;

    function drawWheel(rot){
      ctx.clearRect(0,0,300,300);
      segments.forEach(function(seg,i){
        var startAngle=rot+i*arc;
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,startAngle,startAngle+arc);ctx.closePath();
        ctx.fillStyle=seg.color||'#3b82f6';ctx.fill();
        ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        ctx.save();ctx.translate(cx,cy);ctx.rotate(startAngle+arc/2);ctx.textAlign='right';
        ctx.fillStyle='#fff';ctx.font='bold 13px sans-serif';ctx.fillText(seg.label,r-15,5);
        ctx.restore();
      });
      // Arrow
      ctx.beginPath();ctx.moveTo(cx+r+5,cy);ctx.lineTo(cx+r-15,cy-10);ctx.lineTo(cx+r-15,cy+10);ctx.closePath();
      ctx.fillStyle='#dc2626';ctx.fill();
    }
    drawWheel(0);

    document.getElementById('rfq-spin-btn').addEventListener('click',function(){
      this.disabled=true;this.style.opacity='.5';
      track('element_spin',el.id);

      // Weighted random
      var total=segments.reduce(function(s,seg){return s+seg.probability},0);
      var rnd=Math.random()*total;var accum=0;var winner=0;
      for(var i=0;i<segments.length;i++){accum+=segments[i].probability;if(rnd<=accum){winner=i;break;}}

      var targetAngle = Math.PI*2*5 + (Math.PI*2 - (winner*arc+arc/2));
      var start=Date.now();var duration=4000;
      function animate(){
        var elapsed=Date.now()-start;var progress=Math.min(elapsed/duration,1);
        var eased=1-Math.pow(1-progress,3);
        angle=targetAngle*eased;
        drawWheel(angle);
        if(progress<1){requestAnimationFrame(animate)}
        else{
          var result=document.getElementById('rfq-spin-result');
          result.style.display='block';
          result.textContent='🎉 ربحت: '+segments[winner].label+'!';
          if(segments[winner].couponCode){
            result.innerHTML+='<br><span style="font-size:14px;color:#666;font-weight:400">الكود: <strong>'+segments[winner].couponCode+'</strong></span>';
          }
          track('element_submit',el.id,{metadata:{prize:segments[winner].label,coupon:segments[winner].couponCode||''}});
        }
      }
      animate();
    });

    document.getElementById('rfq-spin-close').addEventListener('click',function(){
      overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);
      track('element_close',el.id);
    });
  }

  function renderLeadForm(el){
    var c = el.content || {};
    var d = el.design || {};
    var lf = c.leadForm || {};
    var fields = lf.fields || [{name:'email',type:'email',label:'البريد الإلكتروني',required:true}];

    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999992;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;direction:rtl;font-family:inherit';

    var fieldsHTML=fields.map(function(f){
      if(f.type==='select'){
        return '<label style="display:block;text-align:right;margin-bottom:4px;font-size:13px;font-weight:500">'+f.label+(f.required?'*':'')+'</label><select name="'+f.name+'" '+(f.required?'required':'')+' style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:12px;direction:rtl">'+
          (f.options||[]).map(function(o){return'<option>'+o+'</option>'}).join('')+'</select>';
      }
      if(f.type==='textarea'){
        return '<label style="display:block;text-align:right;margin-bottom:4px;font-size:13px;font-weight:500">'+f.label+(f.required?'*':'')+'</label><textarea name="'+f.name+'" '+(f.required?'required':'')+' placeholder="'+(f.placeholder||'')+'" rows="3" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:12px;direction:rtl;resize:vertical;box-sizing:border-box"></textarea>';
      }
      return '<label style="display:block;text-align:right;margin-bottom:4px;font-size:13px;font-weight:500">'+f.label+(f.required?'*':'')+'</label><input name="'+f.name+'" type="'+f.type+'" '+(f.required?'required':'')+' placeholder="'+(f.placeholder||'')+'" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:12px;direction:rtl;box-sizing:border-box">';
    }).join('');

    overlay.innerHTML='<div style="background:'+(d.bgColor||'#fff')+';color:'+(d.textColor||'#1f2937')+';border-radius:16px;padding:32px;max-width:400px;width:90%;position:relative"><button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px" id="rfq-form-close">✕</button><h3 style="font-size:20px;font-weight:700;margin:0 0 6px">'+(c.title||'')+'</h3><p style="font-size:14px;opacity:.7;margin:0 0 20px">'+(c.description||'')+'</p><div id="rfq-form-fields">'+fieldsHTML+'</div><button id="rfq-form-submit" style="width:100%;padding:12px;background:'+(d.accentColor||'#2563eb')+';color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">'+(lf.submitText||'إرسال')+'</button><div id="rfq-form-success" style="display:none;text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:12px">✅</div><p style="font-size:16px;font-weight:600">'+(lf.successMessage||'شكراً لتسجيلك!')+'</p></div></div>';
    
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){overlay.style.opacity='1'});

    document.getElementById('rfq-form-close').addEventListener('click',function(){
      overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);
      track('element_close',el.id);
    });

    document.getElementById('rfq-form-submit').addEventListener('click',function(){
      var formFields=overlay.querySelectorAll('input,select,textarea');
      var data={};var valid=true;
      formFields.forEach(function(f){data[f.name]=f.value;if(f.required&&!f.value)valid=false});
      if(!valid){alert('الرجاء تعبئة جميع الحقول المطلوبة');return}
      document.getElementById('rfq-form-fields').style.display='none';
      this.style.display='none';
      document.getElementById('rfq-form-success').style.display='block';
      track('element_submit',el.id,{metadata:data});
    });
  }

  function renderUpsell(el){
    var c=el.content||{};var d=el.design||{};var u=c.upsell||{};
    if(detectPageType()!=='product') return;
    var box=document.createElement('div');
    box.style.cssText='padding:16px 20px;background:'+(d.bgColor||'#fff')+';border:1px solid #e5e7eb;border-radius:'+(d.borderRadius||12)+'px;margin:16px 0;direction:rtl;font-family:inherit;';
    box.innerHTML='<h4 style="font-size:15px;font-weight:700;margin:0 0 12px;color:'+(d.textColor||'#1f2937')+'">'+(u.sectionTitle||'💡 قد يعجبك أيضاً')+'</h4><div id="rfq-upsell-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px"></div>';
    var target=document.querySelector('.product-details,.product-info,main');
    if(target) target.appendChild(box); else document.body.appendChild(box);
    track('element_view',el.id);
  }

  function renderCrossSell(el){
    var c=el.content||{};var d=el.design||{};var cs=c.crossSell||{};
    if(detectPageType()!=='product'&&detectPageType()!=='cart') return;
    var box=document.createElement('div');
    box.style.cssText='padding:16px 20px;background:'+(d.bgColor||'#fff')+';border:1px solid #e5e7eb;border-radius:'+(d.borderRadius||12)+'px;margin:16px 0;direction:rtl;font-family:inherit;';
    box.innerHTML='<h4 style="font-size:15px;font-weight:700;margin:0 0 12px;color:'+(d.textColor||'#1f2937')+'">'+(cs.sectionTitle||'🔗 يُشترى معاً عادةً')+'</h4><div id="rfq-cross-grid" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"></div>';
    var target=document.querySelector('.product-details,.cart-items,main');
    if(target) target.appendChild(box); else document.body.appendChild(box);
    track('element_view',el.id);
  }

  function renderTrustBadges(el){
    var c = el.content || {};
    var d = el.design || {};
    var tb=c.trustBadges||{};
    var enabled=tb.enabled||['securePay','fastShipping','freeReturn'];
    var all={'securePay':'🔒 دفع آمن','fastShipping':'🚚 شحن سريع','freeReturn':'↩️ إرجاع مجاني','quality':'✅ ضمان الجودة','support':'🎧 دعم 24/7'};
    var badges=enabled.map(function(k){return all[k]}).filter(Boolean);
    var bar = document.createElement('div');
    bar.style.cssText='display:flex;justify-content:center;gap:16px;flex-wrap:wrap;padding:12px 20px;background:'+(d.bgColor||'#f9fafb')+';font-size:13px;font-weight:500;color:'+(d.textColor||'#374151')+';direction:rtl;font-family:inherit;border-top:1px solid #e5e7eb;';
    badges.forEach(function(b){bar.innerHTML+='<span>'+b+'</span>'});
    var target = document.querySelector('.product-details,.product-info,main');
    if(target) target.appendChild(bar);
    else document.body.appendChild(bar);
  }

  function renderStickyATC(el){
    var c = el.content || {};
    var d = el.design || {};
    if(detectPageType()!=='product') return;
    var bar = document.createElement('div');
    bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:999991;padding:12px 20px;background:'+(d.bgColor||'#fff')+';box-shadow:0 -4px 12px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between;direction:rtl;font-family:inherit;';
    bar.innerHTML='<div style="font-weight:600;font-size:15px">'+(c.title||document.title)+'</div><button style="padding:10px 24px;background:'+(d.accentColor||'#2563eb')+';color:#fff;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer" id="rfq-sticky-atc">'+(c.button&&c.button.text||'أضف للسلة')+'</button>';
    document.body.appendChild(bar);
    document.getElementById('rfq-sticky-atc').addEventListener('click',function(){track('element_click',el.id)});
  }

  function renderReviewsWidget(el){
    var c=el.content||{};var d=el.design||{};var rv=c.reviews||{};
    var stars=rv.minStars||4;var count=rv.displayCount||5;
    var box=document.createElement('div');
    box.style.cssText='padding:16px 20px;background:'+(d.bgColor||'#fff')+';border:1px solid #e5e7eb;border-radius:'+(d.borderRadius||12)+'px;margin:16px 0;direction:rtl;font-family:inherit;text-align:center;';
    box.innerHTML='<div style="font-size:32px;margin-bottom:4px">'+Array(5).fill('⭐').join('')+'</div><div style="font-size:20px;font-weight:700;color:'+(d.textColor||'#1f2937')+'">4.9</div><div style="font-size:13px;color:#6b7280;margin-top:4px">بناءً على '+count+' تقييمات</div>';
    var target=document.querySelector('.product-details,.product-info,main');
    if(target) target.appendChild(box); else document.body.appendChild(box);
    track('element_view',el.id);
  }

  // ─── NEW RENDERERS ────────────────────────────────────────

  function renderPageVisitors(el){
    var c=el.content||{};var v=c.visitors||{};var d=el.design||{};
    var min=v.minCount||10;var max=v.maxCount||200;
    var count=Math.floor(Math.random()*(max-min))+min;
    var badge=document.createElement('div');
    badge.style.cssText='position:fixed;bottom:20px;'+(el.position==='bottom_left'?'left':'right')+':20px;z-index:999990;padding:10px 18px;background:'+(d.bgColor||'#fff')+';color:'+(d.textColor||'#1f2937')+';border-radius:'+(d.borderRadius||10)+'px;font-size:13px;font-weight:600;direction:rtl;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,.1);display:flex;align-items:center;gap:8px;';
    badge.innerHTML=(v.showLiveIcon!==false?'<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;animation:rfqPulse 2s ease infinite;display:inline-block"></span>':'')+' <span id="rfq-pv-count">'+count+'</span> '+(v.text||'يتصفحون هذه الصفحة');
    document.body.appendChild(badge);
    setInterval(function(){count+=Math.floor(Math.random()*5)-2;count=Math.max(min,Math.min(max,count));document.getElementById('rfq-pv-count').textContent=count},5000);
    badge.addEventListener('click',function(){track('element_click',el.id)});
  }

  function renderVisitorsBar(el){
    var c=el.content||{};var vb=c.visitorsBar||{};var d=el.design||{};
    var min=vb.minCount||50;var max=vb.maxCount||1000;
    var count=Math.floor(Math.random()*(max-min))+min;
    var bar=document.createElement('div');
    bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:999989;padding:10px 20px;background:'+(d.bgColor||'#1e293b')+';color:'+(d.textColor||'#fff')+';text-align:center;font-size:13px;font-weight:500;direction:rtl;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;';
    bar.innerHTML='👥 <strong id="rfq-vb-count">'+count+'</strong> '+(vb.text||'شخص يتصفحون الموقع الآن');
    document.body.appendChild(bar);
    setInterval(function(){count+=Math.floor(Math.random()*7)-3;count=Math.max(min,Math.min(max,count));document.getElementById('rfq-vb-count').textContent=count},8000);
  }

  function renderLiveOrders(el){
    var c=el.content||{};var lo=c.liveOrders||{};var d=el.design||{};
    var min=lo.minCount||3;var max=lo.maxCount||30;
    var count=Math.floor(Math.random()*(max-min))+min;
    var badge=document.createElement('div');
    badge.style.cssText='position:fixed;bottom:20px;'+(el.position==='bottom_left'?'left':'right')+':20px;z-index:999990;padding:10px 18px;background:'+(d.bgColor||'#fff')+';color:'+(d.textColor||'#1f2937')+';border-radius:'+(d.borderRadius||10)+'px;font-size:13px;font-weight:600;direction:rtl;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,.1);';
    badge.innerHTML='📦 <strong id="rfq-lo-count">'+count+'</strong> '+(lo.text||'طلب يتم تجهيزه الآن');
    document.body.appendChild(badge);
    var interval=(lo.updateInterval||8)*1000;
    setInterval(function(){count+=Math.floor(Math.random()*3)-1;count=Math.max(min,Math.min(max,count));document.getElementById('rfq-lo-count').textContent=count},interval);
    badge.addEventListener('click',function(){track('element_click',el.id)});
  }

  function renderCouponWidget(el){
    var c=el.content||{};var cp=c.coupon||{};var d=el.design||{};
    var code=cp.code||'SAVE30';
    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999992;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;direction:rtl;font-family:inherit;';
    overlay.innerHTML='<div style="background:'+(d.bgColor||'#fff')+';border-radius:16px;padding:32px;max-width:380px;width:90%;text-align:center;position:relative"><button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px" id="rfq-coupon-close">✕</button><div style="font-size:48px;margin-bottom:8px">🏷️</div><h3 style="font-size:20px;font-weight:700;margin:0 0 8px;color:'+(d.textColor||'#1f2937')+'">'+(c.title||'كوبون خصم حصري!')+'</h3><p style="font-size:14px;color:#6b7280;margin:0 0 16px">'+(c.description||'')+'</p><div style="background:#fefce8;border:2px dashed #f59e0b;border-radius:10px;padding:12px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:8px"><span style="font-size:20px;font-weight:800;letter-spacing:3px;color:#92400e" id="rfq-coupon-code">'+code+'</span>'+(cp.showCopyButton!==false?'<button id="rfq-copy-btn" style="background:#f59e0b;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">نسخ</button>':'')+'</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){overlay.style.opacity='1'});
    document.getElementById('rfq-coupon-close').addEventListener('click',function(){overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);track('element_close',el.id)});
    var copyBtn=document.getElementById('rfq-copy-btn');
    if(copyBtn)copyBtn.addEventListener('click',function(){navigator.clipboard.writeText(code).then(function(){copyBtn.textContent='تم النسخ ✅';track('element_click',el.id)})});
  }

  function renderDiscountBar(el){
    var c=el.content||{};var db=c.discountBar||{};var d=el.design||{};
    var bar=document.createElement('div');
    bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999991;padding:10px 20px;background:'+(d.bgColor||'linear-gradient(90deg,#dc2626,#f43f5e)')+';color:'+(d.textColor||'#fff')+';text-align:center;font-size:14px;font-weight:600;direction:rtl;font-family:inherit;position:relative;';
    bar.innerHTML='🔥 '+(db.text||'خصم 30% على كل شيء')+(db.couponCode?' — الكود: <strong>'+db.couponCode+'</strong>':'');
    if(db.closeable!==false){var cl=document.createElement('button');cl.textContent='✕';cl.style.cssText='position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:inherit;cursor:pointer;font-size:16px;opacity:.7';cl.addEventListener('click',function(){bar.remove();document.body.style.marginTop='0'});bar.appendChild(cl)}
    document.body.appendChild(bar);document.body.style.marginTop=(bar.offsetHeight)+'px';
  }

  function renderCouponAlert(el){
    var c=el.content||{};var ca=c.couponAlert||{};var d=el.design||{};
    var box=document.createElement('div');
    box.style.cssText='position:fixed;bottom:20px;'+(el.position==='bottom_left'?'left':'right')+':20px;z-index:999990;padding:16px 20px;background:'+(d.bgColor||'#fff')+';color:'+(d.textColor||'#1f2937')+';border-radius:'+(d.borderRadius||12)+'px;font-family:inherit;box-shadow:0 4px 24px rgba(0,0,0,.15);direction:rtl;max-width:300px;animation:rfqSlideUp .5s ease;';
    box.innerHTML='<div style="font-size:14px;font-weight:700;margin-bottom:8px">🎫 '+(ca.name||'قسيمة خصم 20%')+'</div>'+(ca.code?'<div style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:6px;padding:8px;text-align:center;font-weight:800;letter-spacing:2px;margin-bottom:8px">'+ca.code+'</div>':'')+(ca.showRemaining!==false&&ca.remaining?'<div style="font-size:12px;color:#dc2626;font-weight:600;animation:rfqPulse 2s ease infinite">متبقي '+ca.remaining+' فقط!</div>':'');
    var style=document.createElement('style');style.textContent='@keyframes rfqSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';document.head.appendChild(style);
    document.body.appendChild(box);
    box.addEventListener('click',function(){track('element_click',el.id)});
    setTimeout(function(){box.style.opacity='0';box.style.transition='opacity .3s';setTimeout(function(){box.remove()},300)},10000);
  }

  function renderWhatsAppBar(el){
    var c=el.content||{};var wb=c.whatsappBar||{};var d=el.design||{};
    var phone=(wb.phone||'').replace(/[^0-9]/g,'');
    var msg=encodeURIComponent(wb.prefilledMessage||'مرحباً!');
    var bar=document.createElement('a');
    bar.href='https://wa.me/'+phone+'?text='+msg;bar.target='_blank';bar.rel='noopener';
    bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:999991;padding:12px 20px;background:'+(d.bgColor||'#25D366')+';color:'+(d.textColor||'#fff')+';text-align:center;font-size:14px;font-weight:600;direction:rtl;font-family:inherit;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;';
    bar.innerHTML='<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg> '+(wb.text||'تواصل معنا عبر واتساب');
    bar.addEventListener('click',function(){track('element_cta_click',el.id)});
    document.body.appendChild(bar);
  }

  function renderStoreStories(el){
    var c=el.content||{};var st=c.stories||{};var d=el.design||{};
    var count=st.displayCount||5;var shape=st.shape||'circle';
    var container=document.createElement('div');
    container.style.cssText='display:flex;gap:12px;padding:16px 20px;overflow-x:auto;direction:rtl;font-family:inherit;-webkit-overflow-scrolling:touch;scrollbar-width:none;';
    for(var i=0;i<count;i++){
      var story=document.createElement('div');
      story.style.cssText='flex-shrink:0;width:70px;text-align:center;cursor:pointer;';
      story.innerHTML='<div style="width:66px;height:66px;'+(shape==='circle'?'border-radius:50%':'border-radius:12px')+';background:linear-gradient(135deg,#f97316,#ec4899,#8b5cf6);padding:3px;margin:0 auto"><div style="width:100%;height:100%;'+(shape==='circle'?'border-radius:50%':'border-radius:10px')+';background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:24px">📦</div></div><div style="font-size:11px;color:#6b7280;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">قصة '+(i+1)+'</div>';
      story.addEventListener('click',(function(idx){return function(){track('element_click',el.id,{metadata:{storyIndex:idx}})}})(i));
      container.appendChild(story);
    }
    var target=document.querySelector('header,nav,.header,main');
    if(target) target.after(container); else document.body.prepend(container);
  }

  function renderMiniStories(el){
    var c=el.content||{};var ms=c.miniStories||{};var d=el.design||{};
    var count=ms.displayCount||6;var size=ms.size||60;
    var container=document.createElement('div');
    container.style.cssText='display:flex;gap:8px;padding:12px 16px;overflow-x:auto;direction:rtl;font-family:inherit;-webkit-overflow-scrolling:touch;scrollbar-width:none;';
    for(var i=0;i<count;i++){
      var dot=document.createElement('div');
      dot.style.cssText='flex-shrink:0;width:'+size+'px;height:'+size+'px;border-radius:50%;'+(ms.showBorder!==false?'background:linear-gradient(135deg,#8b5cf6,#ec4899);padding:2px;':'')+'cursor:pointer;';
      dot.innerHTML='<div style="width:100%;height:100%;border-radius:50%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:'+(size*0.4)+'px">📦</div>';
      dot.addEventListener('click',(function(idx){return function(){track('element_click',el.id,{metadata:{storyIndex:idx}})}})(i));
      container.appendChild(dot);
    }
    var target=document.querySelector('header,nav,.header,main');
    if(target) target.after(container); else document.body.prepend(container);
  }

  function renderCookiePolicy(el){
    var c=el.content||{};var ck=c.cookie||{};var d=el.design||{};
    if(localStorage.getItem('rfq_cookie_accepted')) return;
    var bar=document.createElement('div');
    bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:999995;padding:16px 24px;background:'+(d.bgColor||'#1f2937')+';color:'+(d.textColor||'#fff')+';font-size:13px;direction:rtl;font-family:inherit;display:flex;align-items:center;justify-content:space-between;gap:16px;box-shadow:0 -4px 16px rgba(0,0,0,.15);';
    bar.innerHTML='<div style="flex:1">🍪 '+(ck.text||'نستخدم ملفات تعريف الارتباط لتحسين تجربتك.')+(ck.privacyUrl?' <a href="'+ck.privacyUrl+'" style="color:inherit;text-decoration:underline" target="_blank">سياسة الخصوصية</a>':'')+'</div><div style="display:flex;gap:8px;flex-shrink:0"><button id="rfq-cookie-accept" style="padding:8px 20px;background:'+(d.accentColor||'#2563eb')+';color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">'+(ck.acceptText||'موافق')+'</button><button id="rfq-cookie-reject" style="padding:8px 16px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,.3);border-radius:8px;font-size:13px;cursor:pointer">'+(ck.rejectText||'رفض')+'</button></div>';
    document.body.appendChild(bar);
    document.getElementById('rfq-cookie-accept').addEventListener('click',function(){localStorage.setItem('rfq_cookie_accepted','1');bar.remove();track('element_click',el.id,{metadata:{action:'accept'}})});
    document.getElementById('rfq-cookie-reject').addEventListener('click',function(){localStorage.setItem('rfq_cookie_accepted','0');bar.remove();track('element_click',el.id,{metadata:{action:'reject'}})});
  }

  function renderAskProduct(el){
    var c=el.content||{};var ap=c.askProduct||{};var d=el.design||{};
    if(detectPageType()!=='product') return;
    var box=document.createElement('div');
    box.style.cssText='padding:16px 20px;background:'+(d.bgColor||'#fff')+';border:1px solid #e5e7eb;border-radius:'+(d.borderRadius||12)+'px;margin:16px 0;direction:rtl;font-family:inherit;';
    box.innerHTML='<h4 style="font-size:15px;font-weight:700;margin:0 0 8px;color:'+(d.textColor||'#1f2937')+'">❓ '+(ap.promptText||'عندك سؤال عن هذا المنتج؟')+'</h4><textarea id="rfq-ask-q" placeholder="'+(ap.placeholder||'اكتب سؤالك هنا...')+'" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:rtl;resize:vertical;min-height:60px;box-sizing:border-box;margin-bottom:8px"></textarea>'+(ap.requireEmail?'<input id="rfq-ask-email" type="email" placeholder="بريدك الإلكتروني" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:rtl;box-sizing:border-box;margin-bottom:8px">':'')+(ap.requirePhone?'<input id="rfq-ask-phone" type="tel" placeholder="رقم جوالك" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:rtl;box-sizing:border-box;margin-bottom:8px">':'')+'<button id="rfq-ask-submit" style="padding:10px 24px;background:'+(d.accentColor||'#7c3aed')+';color:#fff;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer">'+(c.button&&c.button.text||'إرسال السؤال')+'</button><div id="rfq-ask-success" style="display:none;padding:12px;text-align:center;color:#16a34a;font-weight:600">✅ تم إرسال سؤالك بنجاح!</div>';
    var target=document.querySelector('.product-details,.product-info,main');
    if(target) target.appendChild(box); else document.body.appendChild(box);
    document.getElementById('rfq-ask-submit').addEventListener('click',function(){
      var q=document.getElementById('rfq-ask-q').value;if(!q){alert('الرجاء كتابة سؤالك');return}
      this.style.display='none';document.getElementById('rfq-ask-success').style.display='block';
      track('element_submit',el.id,{metadata:{question:q}});
    });
  }

  function renderRateUs(el){
    var c=el.content||{};var ru=c.rateUs||{};var d=el.design||{};
    var type=ru.type||'emoji';
    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999992;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;direction:rtl;font-family:inherit;';
    var items=type==='emoji'?['😡','😐','🙂','😊','🤩']:type==='stars'?['⭐','⭐','⭐','⭐','⭐']:['1','2','3','4','5','6','7','8','9','10'];
    var btnsHtml=items.map(function(item,idx){return'<button data-val="'+(idx+1)+'" style="font-size:'+(type==='numbers'?'16px':'28px')+';padding:'+(type==='numbers'?'8px 12px':'4px')+';background:none;border:'+(type==='numbers'?'1px solid #e5e7eb':'none')+';border-radius:8px;cursor:pointer;transition:transform .2s" class="rfq-rate-btn">'+item+'</button>'}).join('');
    overlay.innerHTML='<div style="background:'+(d.bgColor||'#fff')+';border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;position:relative"><button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px" id="rfq-rate-close">✕</button><h3 style="font-size:18px;font-weight:700;margin:0 0 16px;color:'+(d.textColor||'#1f2937')+'">'+(ru.question||'كيف كانت تجربتك؟')+'</h3><div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">'+btnsHtml+'</div>'+(ru.allowComment!==false?'<textarea id="rfq-rate-comment" placeholder="أضف تعليقك (اختياري)" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:rtl;resize:none;height:60px;box-sizing:border-box;display:none"></textarea>':'')+'<div id="rfq-rate-thanks" style="display:none;padding:20px;font-size:16px;font-weight:600;color:#16a34a">شكراً لتقييمك! 🎉</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){overlay.style.opacity='1'});
    overlay.querySelectorAll('.rfq-rate-btn').forEach(function(btn){btn.addEventListener('click',function(){
      var val=this.getAttribute('data-val');
      var comment=document.getElementById('rfq-rate-comment');
      if(comment&&comment.style.display==='none'){comment.style.display='block';this.style.transform='scale(1.3)';return}
      document.getElementById('rfq-rate-thanks').style.display='block';
      overlay.querySelector('div > div:nth-child(3)').style.display='none';
      if(comment) comment.style.display='none';
      track('element_submit',el.id,{metadata:{rating:val,comment:comment?comment.value:''}});
      setTimeout(function(){overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300)},2000);
    })});
    document.getElementById('rfq-rate-close').addEventListener('click',function(){overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);track('element_close',el.id)});
  }

  function renderCustomerSatisfaction(el){
    var c=el.content||{};var cs=c.satisfaction||{};var d=el.design||{};
    var pct=cs.percentage||96;
    var box=document.createElement('div');
    box.style.cssText='padding:16px 20px;background:'+(d.bgColor||'#fff')+';border:1px solid #e5e7eb;border-radius:'+(d.borderRadius||12)+'px;margin:16px 0;direction:rtl;font-family:inherit;text-align:center;';
    box.innerHTML='<div style="font-size:13px;color:#6b7280;margin-bottom:4px">'+(cs.text||'رضا العملاء عن متجرنا')+'</div><div style="font-size:36px;font-weight:800;color:#16a34a;margin-bottom:8px">'+pct+'%</div><div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;max-width:200px;margin:0 auto"><div style="height:100%;background:#22c55e;border-radius:4px;width:'+pct+'%;transition:width 1s"></div></div>'+(cs.totalReviews?'<div style="font-size:12px;color:#9ca3af;margin-top:6px">بناءً على '+cs.totalReviews+' تقييم</div>':'');
    var target=document.querySelector('.product-details,.product-info,footer,main');
    if(target) target.appendChild(box); else document.body.appendChild(box);
    track('element_view',el.id);
  }

  function renderNewsletter(el){
    var c=el.content||{};var nl=c.newsletter||{};var d=el.design||{};
    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999992;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;direction:rtl;font-family:inherit;';
    overlay.innerHTML='<div style="background:'+(d.bgColor||'#fff')+';border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;position:relative"><button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px" id="rfq-nl-close">✕</button><div style="font-size:40px;margin-bottom:8px">📧</div><h3 style="font-size:20px;font-weight:700;margin:0 0 8px;color:'+(d.textColor||'#1f2937')+'">'+(nl.title||'اشترك بالنشرة البريدية')+'</h3><p style="font-size:14px;color:#6b7280;margin:0 0 20px">'+(nl.subtitle||'احصل على أحدث العروض')+'</p>'+(nl.showNameField?'<input id="rfq-nl-name" type="text" placeholder="الاسم" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:rtl;box-sizing:border-box;margin-bottom:8px">':'')+'<input id="rfq-nl-email" type="email" placeholder="'+(nl.placeholder||'بريدك الإلكتروني')+'" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:rtl;box-sizing:border-box;margin-bottom:12px"><button id="rfq-nl-submit" style="width:100%;padding:12px;background:'+(d.accentColor||'#f59e0b')+';color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">'+(c.button&&c.button.text||'اشترك')+'</button><div id="rfq-nl-success" style="display:none;padding:20px;font-size:16px;font-weight:600;color:#16a34a">✅ تم الاشتراك بنجاح!</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){overlay.style.opacity='1'});
    document.getElementById('rfq-nl-close').addEventListener('click',function(){overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);track('element_close',el.id)});
    document.getElementById('rfq-nl-submit').addEventListener('click',function(){
      var email=document.getElementById('rfq-nl-email').value;if(!email){alert('الرجاء إدخال البريد');return}
      this.style.display='none';document.getElementById('rfq-nl-success').style.display='block';
      track('element_submit',el.id,{metadata:{email:email,name:document.getElementById('rfq-nl-name')?document.getElementById('rfq-nl-name').value:''}});
    });
  }

  function renderMobileSubscribe(el){
    var c=el.content||{};var ms=c.mobileSub||{};var d=el.design||{};
    var cc=ms.countryCode||'+966';
    var overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999992;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s;direction:rtl;font-family:inherit;';
    overlay.innerHTML='<div style="background:'+(d.bgColor||'#fff')+';border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;position:relative"><button style="position:absolute;top:12px;left:12px;background:rgba(0,0,0,.1);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px" id="rfq-ms-close">✕</button><div style="font-size:40px;margin-bottom:8px">📲</div><h3 style="font-size:20px;font-weight:700;margin:0 0 8px;color:'+(d.textColor||'#1f2937')+'">'+(ms.title||'اشترك عبر الجوال')+'</h3><p style="font-size:14px;color:#6b7280;margin:0 0 20px">'+(ms.subtitle||'احصل على العروض على جوالك')+'</p><div style="display:flex;gap:8px;margin-bottom:12px"><select id="rfq-ms-cc" style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:ltr"><option value="+966">🇸🇦 +966</option><option value="+971">🇦🇪 +971</option><option value="+965">🇰🇼 +965</option><option value="+974">🇶🇦 +974</option><option value="+973">🇧🇭 +973</option><option value="+968">🇴🇲 +968</option></select><input id="rfq-ms-phone" type="tel" placeholder="'+(ms.placeholder||'رقم الجوال')+'" style="flex:1;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;direction:ltr;box-sizing:border-box"></div><button id="rfq-ms-submit" style="width:100%;padding:12px;background:'+(d.accentColor||'#0d9488')+';color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">'+(c.button&&c.button.text||'اشترك')+'</button><div id="rfq-ms-success" style="display:none;padding:20px;font-size:16px;font-weight:600;color:#16a34a">✅ تم الاشتراك بنجاح!</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){overlay.style.opacity='1'});
    var sel=document.getElementById('rfq-ms-cc');if(cc)sel.value=cc;
    document.getElementById('rfq-ms-close').addEventListener('click',function(){overlay.style.opacity='0';setTimeout(function(){overlay.remove()},300);track('element_close',el.id)});
    document.getElementById('rfq-ms-submit').addEventListener('click',function(){
      var phone=document.getElementById('rfq-ms-phone').value;if(!phone){alert('الرجاء إدخال رقم الجوال');return}
      this.style.display='none';document.getElementById('rfq-ms-success').style.display='block';
      track('element_submit',el.id,{metadata:{phone:sel.value+phone}});
    });
  }

  // ─── Global track helper ──────────────────────────────────
  window.__rafeqTrack = track;

  // ─── Cart value integration ───────────────────────────────
  // Merchants can set: window.__rafeqCart = { total: 150, items: 3 }
  // This enables cart-based targeting

  // ─── Start ────────────────────────────────────────────────
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
