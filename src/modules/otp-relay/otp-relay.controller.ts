import { Controller, Get, Post, Put, Delete, Body, Param, Req, Query, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OtpRelayService } from './otp-relay.service';
import { OtpInventoryService } from './otp-inventory.service';

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard Controller (JWT-protected)
// ═══════════════════════════════════════════════════════════════════════════════

@Controller('otp-relay')
@UseGuards(JwtAuthGuard)
export class OtpRelayController {
  constructor(
    private readonly svc: OtpRelayService,
    private readonly inventorySvc: OtpInventoryService,
  ) {}

  private getStoreId(req: any): string {
    return req.headers['x-store-id'] || req.user?.storeId || '';
  }

  @Get('platforms') getPlatforms() { return this.svc.getPlatforms(); }

  // ── Config CRUD ──
  @Get('configs') getConfigs(@Req() r: any) { return this.svc.getConfigs(r.user.tenantId, this.getStoreId(r)); }
  @Get('configs/:id') getConfig(@Param('id') id: string, @Req() r: any) { return this.svc.getConfig(id, r.user.tenantId); }
  @Post('configs') create(@Body() b: any, @Req() r: any) { return this.svc.createConfig(r.user.tenantId, this.getStoreId(r), b); }
  @Put('configs/:id') update(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.updateConfig(id, r.user.tenantId, b); }
  @Delete('configs/:id') delete(@Param('id') id: string, @Req() r: any) { return this.svc.deleteConfig(id, r.user.tenantId); }
  @Post('configs/:id/test') test(@Param('id') id: string, @Req() r: any) { return this.svc.testConnection(id, r.user.tenantId); }
  @Get('configs/:id/analytics') analytics(@Param('id') id: string, @Query('days') days: string, @Req() r: any) { return this.svc.getAnalytics(id, r.user.tenantId, Number(days) || 7); }

  // ── Inventory CRUD ──
  @Get('configs/:id/inventory')
  listInventory(@Param('id') id: string, @Query('status') status: string, @Query('page') page: string, @Query('limit') limit: string, @Req() r: any) {
    return this.inventorySvc.listItems(id, r.user.tenantId, { status, page: +page || 1, limit: +limit || 50 });
  }

  @Post('configs/:id/inventory')
  addInventoryItem(@Param('id') id: string, @Body() b: { accountData: string; accountLabel?: string; notes?: string }, @Req() r: any) {
    return this.inventorySvc.addItem(id, r.user.tenantId, b);
  }

  @Post('configs/:id/inventory/bulk')
  bulkAddInventory(@Param('id') id: string, @Body() b: { accounts: string; accountLabel?: string }, @Req() r: any) {
    return this.inventorySvc.bulkAdd(id, r.user.tenantId, b);
  }

  @Delete('inventory/:itemId')
  deleteInventoryItem(@Param('itemId') itemId: string, @Req() r: any) {
    return this.inventorySvc.deleteItem(itemId, r.user.tenantId);
  }

  @Delete('configs/:id/inventory/available')
  deleteAllAvailable(@Param('id') id: string, @Req() r: any) {
    return this.inventorySvc.deleteAllAvailable(id, r.user.tenantId);
  }

  // ── Compensation Stats ──
  @Get('configs/:id/compensations')
  listCompensations(@Param('id') id: string, @Query('page') page: string, @Query('limit') limit: string, @Req() r: any) {
    return this.inventorySvc.listCompensations(id, r.user.tenantId, +page || 1, +limit || 30);
  }

  @Get('configs/:id/compensation-stats')
  compensationStats(@Param('id') id: string, @Query('days') days: string, @Req() r: any) {
    return this.inventorySvc.getCompensationStats(id, r.user.tenantId, Number(days) || 30);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public Controller (no auth — customer-facing)
// ═══════════════════════════════════════════════════════════════════════════════

@Controller('otp')
export class OtpPublicController {
  constructor(
    private readonly svc: OtpRelayService,
    private readonly inventorySvc: OtpInventoryService,
  ) {}

  @Get(':slug') getPage(@Param('slug') slug: string) { return this.svc.getPublicPage(slug); }

  @Post(':slug/verify') @HttpCode(200)
  verify(@Param('slug') slug: string, @Body() b: { orderNumber: string; username: string }, @Req() r: any) {
    const ip = r.headers['x-forwarded-for']?.split(',')[0] || r.ip || 'unknown';
    return this.svc.requestOtp(slug, b.orderNumber, b.username, ip);
  }

  @Post(':slug/compensate') @HttpCode(200)
  compensate(@Param('slug') slug: string, @Body() b: { orderNumber: string; username?: string }, @Req() r: any) {
    const ip = r.headers['x-forwarded-for']?.split(',')[0] || r.ip || 'unknown';
    return this.inventorySvc.requestCompensation(slug, b.orderNumber, b.username || '', ip);
  }
}
