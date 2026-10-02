import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@database/entities';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OtpRelayService } from './otp-relay.service';
import { OtpInventoryService } from './otp-inventory.service';
import { PREDEFINED_BOT_FLOWS } from './telegram-otp-client.service';
import {
  AddOtpInventoryItemDto,
  BulkAddOtpInventoryDto,
  CreateOtpRelayConfigDto,
  RequestOtpCompensationDto,
  UpdateOtpRelayConfigDto,
  VerifyOtpRequestDto,
} from './dto/otp-relay.dto';
import { PlatformFeatureGuard } from '../platform-capabilities/platform-feature.guard';
import { RequirePlatformFeature } from '../platform-capabilities/platform-feature.decorator';

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard Controller (JWT-protected)
// ═══════════════════════════════════════════════════════════════════════════════

@Controller('otp-relay')
@UseGuards(JwtAuthGuard, PlatformFeatureGuard)
@RequirePlatformFeature('otp')
export class OtpRelayController {
  constructor(
    private readonly svc: OtpRelayService,
    private readonly inventorySvc: OtpInventoryService,
  ) {}

  private getStoreId(headerStoreId: string | undefined): string {
    return headerStoreId || '';
  }

  @Get('platforms') getPlatforms() { return this.svc.getPlatforms(); }

  @Get('bot-flows') getBotFlows() {
    return Object.entries(PREDEFINED_BOT_FLOWS).map(([id, f]) => ({
      id, label: f.label, description: f.description, botUsername: f.botUsername,
    }));
  }

  // ── Config CRUD ──
  @Get('configs')
  @RequirePlatformFeature('otp')
  getConfigs(@CurrentUser() user: User, @Headers('x-store-id') storeId?: string) {
    return this.svc.getConfigs(user.tenantId, this.getStoreId(storeId));
  }

  @Get('configs/:id')
  @RequirePlatformFeature('otp')
  getConfig(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.getConfig(id, user.tenantId);
  }

  @Post('configs')
  @RequirePlatformFeature('otp')
  create(
    @Body() body: CreateOtpRelayConfigDto,
    @CurrentUser() user: User,
    @Headers('x-store-id') storeId?: string,
  ) {
    return this.svc.createConfig(user.tenantId, this.getStoreId(storeId), body);
  }

  @Put('configs/:id')
  @RequirePlatformFeature('otp')
  update(
    @Param('id') id: string,
    @Body() body: UpdateOtpRelayConfigDto,
    @CurrentUser() user: User,
  ) {
    return this.svc.updateConfig(id, user.tenantId, body);
  }

  @Delete('configs/:id')
  @RequirePlatformFeature('otp')
  delete(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.deleteConfig(id, user.tenantId);
  }

  @Post('configs/:id/test')
  @RequirePlatformFeature('otp')
  test(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.testConnection(id, user.tenantId);
  }

  @Get('configs/:id/analytics')
  @RequirePlatformFeature('otp')
  analytics(
    @Param('id') id: string,
    @Query('days') days: string,
    @CurrentUser() user: User,
  ) {
    return this.svc.getAnalytics(id, user.tenantId, Number(days) || 7);
  }

  // ── Inventory CRUD ──
  @Get('configs/:id/inventory')
  @RequirePlatformFeature('otp')
  listInventory(
    @Param('id') id: string,
    @Query('status') status: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @CurrentUser() user: User,
  ) {
    return this.inventorySvc.listItems(id, user.tenantId, { status, page: +page || 1, limit: +limit || 50 });
  }

  @Post('configs/:id/inventory')
  @RequirePlatformFeature('otp')
  addInventoryItem(@Param('id') id: string, @Body() body: AddOtpInventoryItemDto, @CurrentUser() user: User) {
    return this.inventorySvc.addItem(id, user.tenantId, body);
  }

  @Post('configs/:id/inventory/bulk')
  @RequirePlatformFeature('otp')
  bulkAddInventory(@Param('id') id: string, @Body() body: BulkAddOtpInventoryDto, @CurrentUser() user: User) {
    return this.inventorySvc.bulkAdd(id, user.tenantId, body);
  }

  @Delete('inventory/:itemId')
  @RequirePlatformFeature('otp')
  deleteInventoryItem(@Param('itemId') itemId: string, @CurrentUser() user: User) {
    return this.inventorySvc.deleteItem(itemId, user.tenantId);
  }

  @Delete('configs/:id/inventory/available')
  @RequirePlatformFeature('otp')
  deleteAllAvailable(@Param('id') id: string, @CurrentUser() user: User) {
    return this.inventorySvc.deleteAllAvailable(id, user.tenantId);
  }

  // ── Compensation Stats ──
  @Get('configs/:id/compensations')
  @RequirePlatformFeature('otp.compensation')
  listCompensations(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @CurrentUser() user: User,
  ) {
    return this.inventorySvc.listCompensations(id, user.tenantId, +page || 1, +limit || 30);
  }

  @Get('configs/:id/compensation-stats')
  @RequirePlatformFeature('otp.compensation')
  compensationStats(
    @Param('id') id: string,
    @Query('days') days: string,
    @CurrentUser() user: User,
  ) {
    return this.inventorySvc.getCompensationStats(id, user.tenantId, Number(days) || 30);
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
  verify(
    @Param('slug') slug: string,
    @Body() body: VerifyOtpRequestDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Ip() ip?: string,
  ) {
    return this.svc.requestOtp(slug, body.orderNumber, body.username, this.getClientIp(forwardedFor, ip));
  }

  @Post(':slug/compensate') @HttpCode(200)
  compensate(
    @Param('slug') slug: string,
    @Body() body: RequestOtpCompensationDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Ip() ip?: string,
  ) {
    return this.inventorySvc.requestCompensation(slug, body.orderNumber, body.username || '', body.reason || '', this.getClientIp(forwardedFor, ip));
  }

  private getClientIp(forwardedFor?: string, ip?: string): string {
    return forwardedFor?.split(',', 1)[0]?.trim() || ip || 'unknown';
  }
}
