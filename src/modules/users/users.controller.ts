/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Controller                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentTenant } from '@common/decorators/current-user.decorator';
import { User } from '@database/entities';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto';

@Controller({
  path: 'users',
  version: '1',
})
@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/v1/users
   * جلب كل مستخدمي المتجر
   */
  @Get()
  @ApiOperation({ summary: 'قائمة المستخدمين' })
  @ApiResponse({ status: 200, description: 'قائمة المستخدمين' })
  findAll(@CurrentTenant() tenantId: string): Promise<User[]> {
    return this.usersService.findAll(tenantId);
  }

  /**
   * GET /api/v1/users/stats
   * إحصائيات المستخدمين
   */
  @Get('stats')
  @ApiOperation({ summary: 'إحصائيات المستخدمين' })
  getStats(@CurrentTenant() tenantId: string) {
    return this.usersService.getStats(tenantId);
  }

  /**
   * GET /api/v1/users/:id
   * جلب مستخدم معين
   */
  @Get(':id')
  @ApiOperation({ summary: 'جلب مستخدم معين' })
  @ApiResponse({ status: 200, description: 'بيانات المستخدم' })
  @ApiResponse({ status: 404, description: 'المستخدم غير موجود' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<User> {
    return this.usersService.findOne(id, tenantId);
  }

  /**
   * POST /api/v1/users
   * إنشاء مستخدم جديد (دعوة موظف)
   */
  @Post()
  @ApiOperation({ summary: 'إنشاء مستخدم جديد' })
  @ApiResponse({ status: 201, description: 'تم إنشاء المستخدم' })
  @ApiResponse({ status: 409, description: 'البريد مستخدم مسبقاً' })
  @ApiResponse({ status: 403, description: 'ليس لديك صلاحية' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: User,
  ): Promise<User> {
    return this.usersService.create(user.tenantId, dto, user.role);
  }

  /**
   * PATCH /api/v1/users/:id
   * تحديث مستخدم
   */
  @Patch(':id')
  @ApiOperation({ summary: 'تحديث مستخدم' })
  @ApiResponse({ status: 200, description: 'تم التحديث' })
  @ApiResponse({ status: 404, description: 'المستخدم غير موجود' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: User,
  ): Promise<User> {
    return this.usersService.update(id, user.tenantId, dto, user.role);
  }

  /**
   * DELETE /api/v1/users/:id
   * حذف مستخدم
   */
  @Delete(':id')
  @ApiOperation({ summary: 'حذف مستخدم' })
  @ApiResponse({ status: 200, description: 'تم الحذف' })
  @ApiResponse({ status: 403, description: 'لا يمكن حذف صاحب المتجر' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<{ message: string }> {
    await this.usersService.remove(id, user.tenantId, user.role);
    return { message: 'تم حذف المستخدم بنجاح' };
  }
}
