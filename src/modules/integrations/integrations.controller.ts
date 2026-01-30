/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Integrations Controller                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import {
  ConnectShopifyDto,
  ConnectWooCommerceDto,
} from './dto';

@ApiTags('Integrations - تكاملات المنصات')
@Controller({
  path: 'integrations',
  version: '1',
})
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // General Endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('available')
  @ApiOperation({
    summary: 'التكاملات المتاحة',
    description: 'قائمة جميع منصات التجارة الإلكترونية المدعومة',
  })
  getAvailableIntegrations() {
    return {
      integrations: [
        {
          id: 'salla',
          name: 'سلة',
          nameEn: 'Salla',
          logo: 'https://salla.sa/logo.png',
          description: 'منصة سلة للتجارة الإلكترونية',
          country: 'SA',
          authType: 'oauth2',
          features: [
            'orders',
            'products',
            'customers',
            'abandoned_carts',
            'webhooks',
          ],
          webhookEvents: [
            'order.created',
            'order.updated',
            'order.status.updated',
            'order.cancelled',
            'abandoned.cart',
            'customer.created',
            'product.created',
            'review.added',
          ],
          status: 'available',
        },
        {
          id: 'zid',
          name: 'زد',
          nameEn: 'Zid',
          logo: 'https://zid.sa/logo.png',
          description: 'منصة زد للتجارة الإلكترونية',
          country: 'SA',
          authType: 'oauth2',
          features: [
            'orders',
            'products',
            'customers',
            'abandoned_carts',
            'webhooks',
          ],
          webhookEvents: [
            'order.create',
            'order.status.update',
            'abandoned_cart.created',
            'customer.create',
            'product.create',
          ],
          status: 'available',
        },
        {
          id: 'shopify',
          name: 'شوبيفاي',
          nameEn: 'Shopify',
          logo: 'https://shopify.com/logo.png',
          description: 'منصة شوبيفاي العالمية',
          country: 'Global',
          authType: 'api_key',
          features: ['orders', 'products', 'customers', 'abandoned_carts'],
          status: 'available',
        },
        {
          id: 'woocommerce',
          name: 'ووكومرس',
          nameEn: 'WooCommerce',
          logo: 'https://woocommerce.com/logo.png',
          description: 'إضافة ووكومرس لووردبريس',
          country: 'Global',
          authType: 'api_key',
          features: ['orders', 'products', 'customers'],
          status: 'available',
        },
      ],
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'التكاملات النشطة',
    description: 'قائمة التكاملات المربوطة مع حسابك',
  })
  async getActiveIntegrations(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.integrationsService.getActiveIntegrations(tenantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'فصل تكامل',
    description: 'فصل الربط مع منصة',
  })
  async disconnectIntegration(@CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = user.tenantId;
    await this.integrationsService.disconnect(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SALLA Integration
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('salla/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط سلة',
    description: 'بدء عملية OAuth للربط مع سلة',
  })
  async connectSalla(
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const tenantId = user.tenantId;
    const authUrl = await this.integrationsService.getSallaAuthUrl(tenantId);
    res.redirect(authUrl);
  }

  @Get('salla/callback')
  @ApiOperation({
    summary: 'Salla OAuth Callback',
    description: 'معالجة رد سلة بعد الموافقة',
  })
  async sallaCallback(
    @CurrentUser() _user: any,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.integrationsService.handleSallaCallback(code, state);
      res.redirect(`/integrations/success?platform=salla&store=${result.storeName}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(`/integrations/error?platform=salla&error=${errorMessage}`);
    }
  }

  @Get('salla/orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'طلبات سلة' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getSallaOrders(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getSallaOrders(tenantId, { status, page, limit });
  }

  @Get('salla/products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'منتجات سلة' })
  async getSallaProducts(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getSallaProducts(tenantId, { page, limit });
  }

  @Get('salla/customers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'عملاء سلة' })
  async getSallaCustomers(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getSallaCustomers(tenantId, { page, limit });
  }

  @Get('salla/abandoned-carts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'السلات المتروكة في سلة' })
  async getSallaAbandonedCarts(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getSallaAbandonedCarts(tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ZID Integration
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('zid/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط زد',
    description: 'بدء عملية OAuth للربط مع زد',
  })
  async connectZid(
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const tenantId = user.tenantId;
    const authUrl = await this.integrationsService.getZidAuthUrl(tenantId);
    res.redirect(authUrl);
  }

  @Get('zid/callback')
  @ApiOperation({
    summary: 'Zid OAuth Callback',
    description: 'معالجة رد زد بعد الموافقة',
  })
  async zidCallback(
    @CurrentUser() _user: any,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.integrationsService.handleZidCallback(code, state);
      res.redirect(`/integrations/success?platform=zid&store=${result.storeName}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(`/integrations/error?platform=zid&error=${errorMessage}`);
    }
  }

  @Get('zid/orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'طلبات زد' })
  async getZidOrders(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getZidOrders(tenantId, { status, page, limit });
  }

  @Get('zid/products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'منتجات زد' })
  async getZidProducts(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getZidProducts(tenantId, { page, limit });
  }

  @Get('zid/customers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'عملاء زد' })
  async getZidCustomers(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getZidCustomers(tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SHOPIFY Integration
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('shopify/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط شوبيفاي',
    description: 'ربط متجر شوبيفاي باستخدام API Key',
  })
  async connectShopify(@CurrentUser() user: any,
    @Body() dto: ConnectShopifyDto) {
    const tenantId = user.tenantId;
    return this.integrationsService.connectShopify(tenantId, dto);
  }

  @Get('shopify/orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'طلبات شوبيفاي' })
  async getShopifyOrders(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getShopifyOrders(tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // WOOCOMMERCE Integration
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('woocommerce/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط ووكومرس',
    description: 'ربط متجر ووكومرس باستخدام API Keys',
  })
  async connectWooCommerce(@CurrentUser() user: any,
    @Body() dto: ConnectWooCommerceDto) {
    const tenantId = user.tenantId;
    return this.integrationsService.connectWooCommerce(tenantId, dto);
  }

  @Get('woocommerce/orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'طلبات ووكومرس' })
  async getWooCommerceOrders(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = user.tenantId;
    return this.integrationsService.getWooCommerceOrders(tenantId, { page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Sync Data
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':platform/sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'مزامنة البيانات',
    description: 'مزامنة الطلبات والعملاء من المنصة',
  })
  async syncData(@CurrentUser() user: any,
    @Param('platform') platform: string) {
    const tenantId = user.tenantId;
    return this.integrationsService.syncData(tenantId, platform);
  }

  @Get(':platform/sync-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'حالة المزامنة' })
  async getSyncStatus(@CurrentUser() user: any,
    @Param('platform') platform: string) {
    const tenantId = user.tenantId;
    return this.integrationsService.getSyncStatus(tenantId, platform);
  }
}
