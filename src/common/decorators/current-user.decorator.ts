/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Current User Decorator                     ║
 * ║                                                                                ║
 * ║  📌 Decorator لجلب المستخدم الحالي بطريقة نظيفة                                  ║
 * ║                                                                                ║
 * ║  بدلاً من:                                                                      ║
 * ║    @Request() req: RequestWithUser                                            ║
 * ║    const user = req.user;                                                     ║
 * ║                                                                                ║
 * ║  نكتب:                                                                         ║
 * ║    @CurrentUser() user: User                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@database/entities';

/**
 * 📌 CurrentUser Decorator
 * 
 * يستخرج المستخدم من الـ Request object
 * 
 * @example
 * // جلب المستخدم كاملاً
 * @Get('profile')
 * getProfile(@CurrentUser() user: User) {
 *   return user;
 * }
 * 
 * @example
 * // جلب property معين فقط
 * @Get('my-id')
 * getMyId(@CurrentUser('id') userId: string) {
 *   return { userId };
 * }
 * 
 * @example
 * // جلب الـ tenant ID
 * @Get('my-tenant')
 * getMyTenant(@CurrentUser('tenantId') tenantId: string) {
 *   return { tenantId };
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext): User | unknown => {
    // جلب الـ Request من السياق
    const request = ctx.switchToHttp().getRequest();
    
    // المستخدم يُضاف للـ request من قبل JwtStrategy.validate()
    const user = request.user as User;

    // إذا لم يُحدد data، نُرجع المستخدم كاملاً
    if (!data) {
      return user;
    }

    // إذا حُدد property معين، نُرجعه فقط
    return user?.[data];
  },
);

/**
 * 📌 CurrentTenant Decorator
 * 
 * اختصار لجلب الـ Tenant ID
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as User;
    return user?.tenantId;
  },
);

/**
 * 📌 مثال كامل:
 * 
 * @Controller('orders')
 * @UseGuards(JwtAuthGuard)
 * export class OrdersController {
 *   
 *   @Get()
 *   findAll(
 *     @CurrentUser() user: User,        // المستخدم كاملاً
 *     @CurrentTenant() tenantId: string // ID المتجر فقط
 *   ) {
 *     console.log(user.email);          // user@example.com
 *     console.log(tenantId);            // 550e8400-...
 *     
 *     return this.ordersService.findAll(tenantId);
 *   }
 *   
 *   @Get('my-orders')
 *   findMyOrders(@CurrentUser('id') userId: string) {
 *     // جلب orders المستخدم الحالي فقط
 *     return this.ordersService.findByUser(userId);
 *   }
 * }
 */
