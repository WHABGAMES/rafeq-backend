import { IsArray, IsBoolean, IsEnum, IsISO8601, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { FeatureTargetMode, PlatformFeatureStatus } from '../entities/platform-feature.entity';
import { StorePlatform } from '../../stores/entities/store.entity';

export class UpdatePlatformFeatureDto {
  @IsOptional() @IsEnum(FeatureTargetMode) targetMode?: FeatureTargetMode;
  @IsOptional() @IsArray() @IsString({ each: true })
  @IsEnum(StorePlatform, { each: true })
  platforms?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() showInNavigation?: boolean;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsEnum(PlatformFeatureStatus) status?: PlatformFeatureStatus;
  /** Last version displayed to the admin; prevents silently overwriting a newer edit. */
  @IsOptional() @IsISO8601({ strict: true }) expectedUpdatedAt?: string;
}
