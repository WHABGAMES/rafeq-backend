import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MaintenanceStyle } from '../entities/maintenance-page.entity';

export class ToggleMaintenanceDto {
  @IsBoolean()
  isActive: boolean;
}

export class UpdateMaintenanceDto {
  @IsOptional()
  @IsEnum(MaintenanceStyle)
  style?: MaintenanceStyle;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CheckMaintenanceRouteDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(255)
  @Matches(/^\/dashboard(?:\/|$)/, { message: 'route must be a dashboard path' })
  route: string;
}
