import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

class DeviceDto {
  @IsString() @MinLength(10) token: string;
  @IsIn(['android', 'ios', 'web']) platform: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: any, @Query('unread') unread?: string) {
    const where = { userId: req.user.id, ...(unread === 'true' && { read: false }) };
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.notification.count({ where: { userId: req.user.id, read: false } }),
    ]);
    return { unreadCount, items };
  }

  @Patch('read-all')
  async readAll(@Req() req: any) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
    return { updated: count };
  }

  @Patch(':id')
  async markRead(@Req() req: any, @Param('id') id: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId: req.user.id }, data: { read: true } });
    if (!count) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  /** Register (or move to this user) an FCM device token. */
  @Post('device-token')
  async register(@Req() req: any, @Body() b: DeviceDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: b.token },
      update: { userId: req.user.id, platform: b.platform },
      create: { token: b.token, userId: req.user.id, platform: b.platform },
    });
    return { ok: true };
  }

  @Delete('device-token/:token')
  async unregister(@Req() req: any, @Param('token') token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId: req.user.id } });
    return { ok: true };
  }
}
