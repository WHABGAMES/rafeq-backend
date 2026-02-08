/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Controller                           ║
 * ║                                                                                ║
 * ║  Endpoints:                                                                   ║
 * ║  GET    /users              → قائمة الموظفين                                   ║
 * ║  GET    /users/stats        → إحصائيات                                         ║
 * ║  GET    /users/:id          → موظف معين                                        ║
 * ║  POST   /users/invite       → دعوة موظف (Owner only)                           ║
 * ║  POST   /users/accept-invite → قبول الدعوة (Public - no auth)                  ║
 * ║  POST   /users/verify-invite → التحقق من الرابط (Public - no auth)             ║
 * ║  PATCH  /users/:id          → تحديث موظف                                      ║
 * ║  PATCH  /users/:id/permissions → تحديث الصلاحيات (Owner only)                  ║
 * ║  PATCH  /users/:id/toggle-status → تفعيل/تعطيل (Owner only)                   ║
 * ║  DELETE /users/:id          → حذف موظف (Owner only)                            ║
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
  HttpCode,
  HttpStatus,
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
import { UsersService, StaffPermissions } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto';

// ═══════════════════════════════════════════════════════════════════════════════
// DTOs للـ endpoints الجديدة
// ═══════════════════════════════════════════════════════════════════════════════

import { IsEmail, IsNotEmpty, IsString, IsOptional, IsEnum, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@database/entities';

export class InviteStaffDto {
  @ApiProperty({ description: 'البريد الإلكتروني للموظف', example: 'staff@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiPropertyOptional({ description: 'الدور', enum: ['agent', 'manager', 'marketing'] })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'الصلاحيات المخصصة' })
  @IsOptional()
  permissions?: Partial<StaffPermissions>;
}

export class AcceptInviteDto {
  @ApiProperty({ description: 'توكن الدعوة' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'البريد الإلكتروني' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'كلمة المرور' })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  password: string;

  @ApiProperty({ description: 'اسم الموظف' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class VerifyInviteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class UpdatePermissionsDto {
  @ApiProperty({ description: 'الصلاحيات المحدّثة' })
  @IsNotEmpty()
  permissions: Partial<StaffPermissions>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Controller
// ═══════════════════════════════════════════════════════════════════════════════

@Controller('users')
@ApiTags('Users / Staff Management')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔓 Public Endpoints (لا تحتاج auth)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/users/verify-invite
   * التحقق من صلاحية رابط الدعوة
   */
  @Post('verify-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من رابط الدعوة' })
  verifyInvite(@Body() dto: VerifyInviteDto) {
    return this.usersService.verifyInviteToken(dto.token, dto.email);
  }

  /**
   * POST /api/v1/users/accept-invite
   * قبول الدعوة وإنشاء الحساب
   */
  @Post('accept-invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'قبول الدعوة وتعيين كلمة المرور' })
  @ApiResponse({ status: 201, description: 'تم إنشاء الحساب بنجاح' })
  @ApiResponse({ status: 400, description: 'رابط غير صالح أو منتهي' })
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.usersService.acceptInvite(
      dto.token,
      dto.email,
      dto.password,
      dto.name,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 Protected Endpoints (تحتاج auth)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/users
   * قائمة كل الموظفين في المتجر
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'قائمة الموظفين' })
  findAll(@CurrentTenant() tenantId: string): Promise<User[]> {
    return this.usersService.findAll(tenantId);
  }

  /**
   * GET /api/v1/users/stats
   * إحصائيات الموظفين
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'إحصائيات الموظفين' })
  getStats(@CurrentTenant() tenantId: string) {
    return this.usersService.getStats(tenantId);
  }

  /**
   * GET /api/v1/users/:id
   * بيانات موظف معين
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'بيانات موظف معين' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ): Promise<User> {
    return this.usersService.findOne(id, tenantId);
  }

  /**
   * POST /api/v1/users/invite
   * دعوة موظف جديد (Owner only)
   */
  @Post('invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'دعوة موظف جديد' })
  @ApiResponse({ status: 200, description: 'تم إرسال الدعوة' })
  @ApiResponse({ status: 403, description: 'فقط Owner يمكنه الدعوة' })
  @ApiResponse({ status: 409, description: 'البريد مسجّل مسبقاً' })
  invite(
    @Body() dto: InviteStaffDto,
    @CurrentUser() user: User,
  ) {
    return this.usersService.inviteStaff(user.tenantId, user, dto);
  }

  /**
   * POST /api/v1/users (Legacy - للتوافقية)
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'إنشاء مستخدم (legacy)' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: User,
  ): Promise<User> {
    return this.usersService.create(user.tenantId, dto, user.role);
  }

  /**
   * PATCH /api/v1/users/:id/permissions
   * تحديث صلاحيات موظف (Owner only)
   */
  @Patch(':id/permissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تحديث صلاحيات موظف' })
  @ApiResponse({ status: 200, description: 'تم التحديث' })
  @ApiResponse({ status: 403, description: 'فقط Owner' })
  updatePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionsDto,
    @CurrentUser() user: User,
  ) {
    return this.usersService.updatePermissions(id, user.tenantId, dto.permissions, user.role);
  }

  /**
   * PATCH /api/v1/users/:id/toggle-status
   * تفعيل/تعطيل حساب (Owner only)
   */
  @Patch(':id/toggle-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تفعيل/تعطيل حساب موظف' })
  toggleStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.usersService.toggleStatus(id, user.tenantId, user.role);
  }

  /**
   * PATCH /api/v1/users/:id
   * تحديث بيانات موظف
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تحديث بيانات موظف' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: User,
  ): Promise<User> {
    return this.usersService.update(id, user.tenantId, dto, user.role);
  }

  /**
   * DELETE /api/v1/users/:id
   * حذف موظف (Owner only)
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'حذف موظف' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<{ message: string }> {
    await this.usersService.remove(id, user.tenantId, user.role);
    return { message: 'تم حذف الموظف بنجاح' };
  }
}
