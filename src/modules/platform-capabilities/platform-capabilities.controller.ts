import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformCapabilitiesService } from './platform-capabilities.service';
import { User } from '../../database/entities/user.entity';

interface AuthenticatedRequest { user: User }

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class PlatformCapabilitiesController {
  constructor(private readonly capabilitiesService: PlatformCapabilitiesService) {}

  @Get(':storeId/workspace')
  getWorkspace(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.capabilitiesService.resolveWorkspace(storeId, request.user);
  }
}
