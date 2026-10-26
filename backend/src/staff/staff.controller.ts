import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { MAX_UNIT_PRICE_PAISE, priceOf } from '../common/money';
import { assertTransition } from '../common/transitions';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

export const SERVICE_TYPES = [
  'injection', 'dressing', 'ivDrip', 'catheterCare', 'woundCare', 'postOperativeCare',
  'elderlyCare', 'bpSugarCheck', 'other',
] as const;

const STAFF_VISIT_FLOW: Record<string, string[]> = {
  CONFIRMED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
};

class ProfileDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() city?: string;
}
class ServiceDto {
  @IsIn(SERVICE_TYPES) type: string;
  @IsInt() @Min(1) @Max(MAX_UNIT_PRICE_PAISE) pricePaise: number;
}
class ServicesDto {
  @IsArray() @ArrayMaxSize(SERVICE_TYPES.length) @ValidateNested({ each: true }) @Type(() => ServiceDto)
  services: ServiceDto[];
}
class BookVisitDto {
  @IsString() staffId: string;
  @IsIn(SERVICE_TYPES) serviceType: string;
  @IsString() @MinLength(5) address: string;
  @IsDateString() scheduledAt: string;
}
class VisitStatusDto {
  @IsIn(['IN_PROGRESS', 'COMPLETED']) status: string;
}

@Controller('staff')
export class StaffController {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private notifications: NotificationsService,
  ) {}

  private async me(req: any) {
    const s = await this.prisma.staffProfile.findUnique({ where: { userId: req.user.id } });
    if (!s) throw new NotFoundException('Create your staff profile first');
    return s;
  }

  @Put('profile') @Roles(Role.STAFF)
  upsert(@Req() req: any, @Body() b: ProfileDto) {
    return this.prisma.staffProfile.upsert({ where: { userId: req.user.id }, update: b, create: { ...b, userId: req.user.id } });
  }

  @Get('profile') @Roles(Role.STAFF)
  profile(@Req() req: any) {
    return this.me(req);
  }

  @Get('services') @Roles(Role.STAFF)
  async services(@Req() req: any) {
    return (await this.me(req)).services;
  }

  /** Replaces the whole service/price list. */
  @Put('services') @Roles(Role.STAFF)
  async setServices(@Req() req: any, @Body() b: ServicesDto) {
    const s = await this.me(req);
    if (new Set(b.services.map((x) => x.type)).size !== b.services.length) {
      throw new BadRequestException('duplicate service type');
    }
    return (await this.prisma.staffProfile.update({ where: { id: s.id }, data: { services: b.services as any } })).services;
  }

  @Get()
  async list(@Query('city') city?: string, @Query('service') service?: string) {
    if (service && !(SERVICE_TYPES as readonly string[]).includes(service)) throw new BadRequestException('invalid service');
    const rows = await this.prisma.staffProfile.findMany({
      where: city ? { city: { equals: city, mode: 'insensitive' } } : {},
      select: { id: true, name: true, city: true, services: true },
    });
    return service ? rows.filter((r) => (r.services as any[]).some((x) => x.type === service)) : rows;
  }

  // ---- visits ----

  @Post('visits/book') @Roles(Role.USER)
  async book(@Req() req: any, @Body() b: BookVisitDto) {
    const when = new Date(b.scheduledAt);
    if (when.getTime() <= Date.now()) throw new BadRequestException('scheduledAt must be in the future');
    const staff = await this.prisma.staffProfile.findUnique({ where: { id: b.staffId } });
    if (!staff) throw new NotFoundException('Staff not found');
    const svc = (staff.services as any[]).find((x) => x.type === b.serviceType);
    if (!svc) throw new BadRequestException('This staff member does not offer that service');
    const p = priceOf(svc.pricePaise);
    return this.prisma.staffVisit.create({
      data: {
        userId: req.user.id, staffId: staff.id, serviceType: b.serviceType, address: b.address, scheduledAt: when,
        pricePaise: p.feePaise, mdrPaise: p.mdrPaise, totalPaise: p.totalPaise,
      },
    });
  }

  @Get('visits/my')
  mine(@Req() req: any) {
    return this.prisma.staffVisit.findMany({ where: { userId: req.user.id }, orderBy: { scheduledAt: 'desc' } });
  }

  @Get('visits/incoming') @Roles(Role.STAFF)
  async incoming(@Req() req: any) {
    const s = await this.me(req);
    return this.prisma.staffVisit.findMany({
      where: { staffId: s.id, status: { not: 'PENDING_PAYMENT' } },
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  @Get('visits/:id')
  async one(@Req() req: any, @Param('id') id: string) {
    const v = await this.prisma.staffVisit.findUnique({ where: { id }, include: { staff: true } });
    if (!v || (v.userId !== req.user.id && v.staff.userId !== req.user.id)) throw new NotFoundException('Visit not found');
    return v;
  }

  @Post('visits/:id/pay') @Roles(Role.USER)
  pay(@Req() req: any, @Param('id') id: string) {
    return this.payments.createOrder(req.user.id, 'STAFF_VISIT', id);
  }

  @Patch('visits/:id/cancel') @Roles(Role.USER)
  async cancel(@Req() req: any, @Param('id') id: string) {
    const v = await this.prisma.staffVisit.findUnique({ where: { id } });
    if (!v || v.userId !== req.user.id) throw new NotFoundException('Visit not found');
    if (v.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Cannot cancel a visit that is ${v.status}`);
    return this.prisma.staffVisit.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  @Patch('visits/:id/status') @Roles(Role.STAFF)
  async setStatus(@Req() req: any, @Param('id') id: string, @Body() b: VisitStatusDto) {
    const v = await this.prisma.staffVisit.findUnique({ where: { id }, include: { staff: true } });
    if (!v || v.staff.userId !== req.user.id) throw new NotFoundException('Visit not found');
    assertTransition(STAFF_VISIT_FLOW, v.status, b.status);
    const u = await this.prisma.staffVisit.update({ where: { id }, data: { status: b.status as any } });
    await this.notifications.notify(v.userId, 'Home visit update', `Your ${v.serviceType} visit is now ${b.status.replace('_', ' ').toLowerCase()}.`);
    return u;
  }
}
