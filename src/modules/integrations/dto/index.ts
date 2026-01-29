/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Integrations DTOs                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsString, IsUrl, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Shopify Connection DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class ConnectShopifyDto {
  @ApiProperty({ description: 'اسم المتجر' })
  @IsString()
  @MaxLength(100)
  storeName: string;

  @ApiProperty({ description: 'رابط المتجر (store.myshopify.com)' })
  @IsString()
  storeUrl: string;

  @ApiProperty({ description: 'API Key' })
  @IsString()
  apiKey: string;

  @ApiPropertyOptional({ description: 'API Secret' })
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiProperty({ description: 'Access Token' })
  @IsString()
  accessToken: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WooCommerce Connection DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class ConnectWooCommerceDto {
  @ApiProperty({ description: 'اسم المتجر' })
  @IsString()
  @MaxLength(100)
  storeName: string;

  @ApiProperty({ description: 'رابط الموقع' })
  @IsUrl()
  siteUrl: string;

  @ApiProperty({ description: 'Consumer Key' })
  @IsString()
  consumerKey: string;

  @ApiProperty({ description: 'Consumer Secret' })
  @IsString()
  consumerSecret: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class IntegrationResponseDto {
  id: string;
  platform: 'salla' | 'zid' | 'shopify' | 'woocommerce';
  storeName: string;
  storeId?: string;
  domain?: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt?: Date;
  createdAt: Date;
}

export class SyncStatusDto {
  platform: string;
  lastSyncAt?: Date;
  status: 'idle' | 'syncing' | 'completed' | 'error';
  ordersCount: number;
  customersCount: number;
  productsCount: number;
  errorMessage?: string;
}
