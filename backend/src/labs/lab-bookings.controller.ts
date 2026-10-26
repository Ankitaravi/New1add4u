import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { priceOf } from '../common/money';
import { LAB_FLOW, assertTransition } from '../common/transitions';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

class BookDto {
  @IsString() testId: string;
}
class LabStatusDto {
  @IsIn(['SAMPLE_COLLECTED', 'REPORT_UPLOADED', 'COMPLETED']) status: string;
  @IsOptional() @IsUrl() reportUrl?: string;
}

@Controller('lab-bookings')
export class LabBookingsController {
  constructor(private prisma: PrismaService, private payments: PaymentsService, private notifications: NotificationsService) {}

  @Post('book') @Roles(Role.USER)
  async book(@Req() req: any, @Body() b: BookDto) {
    const test = await this.prisma.labTest.findUnique({ where: { id: b.testId } });
    if (!test) throw new NotFoundException('Test not found');
    const p = priceOf(test.pricePaise);
    return this.prisma.labBooking.create({
      data: { userId: req.user.id, labId: test.labId, testId: test.id, pricePaise: p.feePaise, mdrPaise: p.mdrPaise, totalPaise: p.totalPaise },
    });
  }

  @Get('my')
  mine(@Req() req: any) {
    return this.prisma.labBooking.findMany({
      where: { userId: req.user.id },
      include: { test: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('incoming') @Roles(Role.INVESTIGATION)
  async incoming(@Req() req: any) {
    const lab = await this.prisma.labProfile.findUnique({ where: { userId: req.user.id } });
    if (!lab) return [];
    return this.prisma.labBooking.findMany({
      where: { labId: lab.id, status: { not: 'PENDING_PAYMENT' } },
      include: { test: true, user: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post(':id/pay') @Roles(Role.USER)
  pay(@Req() req: any, @Param('id') id: string) {
    return this.payments.createOrder(req.user.id, 'LAB_BOOKING', id);
  }

  @Patch(':id/cancel') @Roles(Role.USER)
  async cancel(@Req() req: any, @Param('id') id: string) {
    const l = await this.prisma.labBooking.findUnique({ where: { id } });
    if (!l || l.userId !== req.user.id) throw new NotFoundException('Booking not found');
    if (l.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Cannot cancel a booking that is ${l.status}`);
    return this.prisma.labBooking.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  @Patch(':id/status') @Roles(Role.INVESTIGATION)
  async setStatus(@Req() req: any, @Param('id') id: string, @Body() b: LabStatusDto) {
    const l = await this.prisma.labBooking.findUnique({ where: { id }, include: { lab: true } });
    if (!l || l.lab.userId !== req.user.id) throw new NotFoundException('Booking not found');
    assertTransition(LAB_FLOW, l.status, b.status);
    if (b.status === 'REPORT_UPLOADED' && !b.reportUrl) throw new BadRequestException('reportUrl is required');
    const u = await this.prisma.labBooking.update({
      where: { id },
      data: { status: b.status as any, ...(b.reportUrl && { reportUrl: b.reportUrl }) },
    });
    await this.notifications.notify(
      l.userId,
      b.status === 'REPORT_UPLOADED' ? 'Lab report ready' : 'Lab booking update',
      b.status === 'REPORT_UPLOADED' ? 'Your report has been uploaded.' : `Your lab booking is now ${b.status.replace('_', ' ').toLowerCase()}.`,
    );
    return u;
  }

  @Get(':id')
  async one(@Req() req: any, @Param('id') id: string) {
    const l = await this.prisma.labBooking.findUnique({ where: { id }, include: { test: true, lab: true } });
    if (!l || (l.userId !== req.user.id && l.lab.userId !== req.user.id)) throw new NotFoundException('Booking not found');
    return l;
  }
}
