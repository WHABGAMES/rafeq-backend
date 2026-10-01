import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
