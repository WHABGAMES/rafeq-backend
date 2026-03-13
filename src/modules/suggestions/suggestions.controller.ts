/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestions Controller                           ║
 * ║                                                                                ║
 * ║  Merchant-facing endpoints for suggestions & issues board                      ║
 * ║                                                                                ║
 * ║  GET    /suggestions                  → قائمة الاقتراحات                       ║
 * ║  GET    /suggestions/roadmap          → خارطة التطوير                          ║
 * ║  GET    /suggestions/:id              → تفاصيل اقتراح                          ║
 * ║  POST   /suggestions                  → إنشاء اقتراح                           ║
 * ║  POST   /suggestions/:id/like         → إعجاب/إلغاء إعجاب                      ║
 * ║  POST   /suggestions/:id/follow       → متابعة/إلغاء متابعة                    ║
 * ║  GET    /suggestions/:id/comments     → تعليقات الاقتراح                       ║
 * ║  POST   /suggestions/:id/comments     → إضافة تعليق                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuggestionsService } from './suggestions.service';
import {
  CreateSuggestionDto,
  CreateCommentDto,
  ListSuggestionsQueryDto,
} from './dto';

@ApiTags('الاقتراحات والمشاكل')
@Controller({
  path: 'suggestions',
  version: '1',
})
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  // ═══════════════════════════════════════════════════════════
  // LIST — Public board (requires auth for like/follow state)
  // ═══════════════════════════════════════════════════════════

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'قائمة الاقتراحات والمشاكل' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['popular', 'recent', 'most_commented'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @CurrentUser() user: any,
    @Query() query: ListSuggestionsQueryDto,
  ) {
    return this.suggestionsService.list(query, user.id);
  }

  // ═══════════════════════════════════════════════════════════
  // ROADMAP — Public development roadmap
  // ═══════════════════════════════════════════════════════════

  @Get('roadmap')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'خارطة تطوير رفيق' })
  async getRoadmap() {
    return this.suggestionsService.getRoadmap();
  }

  // ═══════════════════════════════════════════════════════════
  // GET ONE
  // ═══════════════════════════════════════════════════════════

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تفاصيل اقتراح' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.suggestionsService.findOne(id, user.id);
  }

  // ═══════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء اقتراح أو الإبلاغ عن مشكلة' })
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreateSuggestionDto,
  ) {
    return this.suggestionsService.create(dto, {
      id: user.id,
      tenantId: user.tenantId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    }, user.tenant?.name); // ✅ tenant name from JWT relation
  }

  // ═══════════════════════════════════════════════════════════
  // LIKE / UNLIKE
  // ═══════════════════════════════════════════════════════════

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إعجاب / إلغاء إعجاب' })
  async toggleLike(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.suggestionsService.toggleLike(id, user.id);
  }

  // ═══════════════════════════════════════════════════════════
  // FOLLOW / UNFOLLOW
  // ═══════════════════════════════════════════════════════════

  @Post(':id/follow')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'متابعة / إلغاء متابعة' })
  async toggleFollow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.suggestionsService.toggleFollow(id, user.id);
  }

  // ═══════════════════════════════════════════════════════════
  // COMMENTS
  // ═══════════════════════════════════════════════════════════

  @Get(':id/comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تعليقات الاقتراح' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.suggestionsService.getComments(id, Number(page) || 1, Number(limit) || 30);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إضافة تعليق' })
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: CreateCommentDto,
  ) {
    return this.suggestionsService.addComment(id, dto, {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    }, user.tenant?.name); // ✅ tenant name
  }
}
