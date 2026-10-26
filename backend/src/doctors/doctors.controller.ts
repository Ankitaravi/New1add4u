import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get,
  NotFoundException, Param, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { HHMM, parseDay, toMins } from '../common/dates';
import { formatHprId, validHprId } from '../common/hpr';
import { MAX_UNIT_PRICE_PAISE, priceOf } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const STREAMS = ['mbbs', 'dental', 'ayurveda', 'homeopathy'] as const;

class RegisterDoctorDto {
  @IsString() hprId: string;
  @IsIn(STREAMS) medicalStream: (typeof STREAMS)[number];
  @IsString() specialization: string;
  @IsInt() @Min(0) @Max(MAX_UNIT_PRICE_PAISE) feePaise: number;
}
class UpdateDoctorDto {
  @IsOptional() @IsString() specialization?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_UNIT_PRICE_PAISE) feePaise?: number;
}
class DayDto {
  @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @Matches(HHMM) startTime: string;
  @Matches(HHMM) endTime: string;
  @IsOptional() @IsInt() @Min(5) @Max(120) slotMins?: number;
}
class AvailabilityDto {
  @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => DayDto)
  days: DayDto[];
}

@Controller('doctors')
export class DoctorsController {
  constructor(private prisma: PrismaService) {}

  private async me(req: any) {
    const d = await this.prisma.doctor.findUnique({ where: { userId: req.user.id } });
    if (!d) throw new NotFoundException('Doctor profile not found');
    return d;
  }

  private view(d: any) {
    return {
      id: d.id,
      name: d.user?.name ?? null,
      hprId: d.hprId ? formatHprId(d.hprId) : null,
      medicalStream: d.medicalStream,
      specialization: d.specialization,
      isVerified: d.isVerified,
      price: priceOf(d.feePaise),
    };
  }

  @Post('register')
  async register(@Req() req: any, @Body() b: RegisterDoctorDto) {
    if (!validHprId(b.hprId)) throw new BadRequestException('HPR ID must be exactly 14 digits');
    if (req.user.role !== 'USER') throw new ForbiddenException('Only patient accounts can register as a doctor');
    const hprId = b.hprId.replace(/-/g, '');
    if (await this.prisma.doctor.findUnique({ where: { hprId } })) {
      throw new ConflictException('HPR ID already registered');
    }
    const [doctor] = await this.prisma.$transaction([
      this.prisma.doctor.create({
        data: {
          userId: req.user.id, hprId, medicalStream: b.medicalStream,
          specialization: b.specialization, feePaise: b.feePaise,
        },
        include: { user: true },
      }),
      this.prisma.user.update({ where: { id: req.user.id }, data: { role: 'DOCTOR' } }),
    ]);
    return this.view(doctor);
  }

  @Get('profile') @Roles(Role.DOCTOR)
  async profile(@Req() req: any) {
    const d = await this.prisma.doctor.findUnique({ where: { userId: req.user.id }, include: { user: true } });
    if (!d) throw new NotFoundException('Doctor profile not found');
    return this.view(d);
  }

  @Patch('profile') @Roles(Role.DOCTOR)
  async update(@Req() req: any, @Body() b: UpdateDoctorDto) {
    const d = await this.me(req);
    return this.view(await this.prisma.doctor.update({ where: { id: d.id }, data: b, include: { user: true } }));
  }

  @Get('availability') @Roles(Role.DOCTOR)
  async availability(@Req() req: any) {
    const d = await this.me(req);
    return this.prisma.availability.findMany({ where: { doctorId: d.id }, orderBy: { dayOfWeek: 'asc' } });
  }

  /** Replaces the whole weekly schedule. */
  @Put('availability') @Roles(Role.DOCTOR)
  async setAvailability(@Req() req: any, @Body() b: AvailabilityDto) {
    const d = await this.me(req);
    const seen = new Set<number>();
    for (const day of b.days) {
      if (toMins(day.startTime) >= toMins(day.endTime)) throw new BadRequestException('startTime must be before endTime');
      if (seen.has(day.dayOfWeek)) throw new BadRequestException('duplicate dayOfWeek');
      seen.add(day.dayOfWeek);
    }
    await this.prisma.$transaction([
      this.prisma.availability.deleteMany({ where: { doctorId: d.id } }),
      this.prisma.availability.createMany({
        data: b.days.map((x) => ({ ...x, slotMins: x.slotMins ?? 15, doctorId: d.id })),
      }),
    ]);
    return this.prisma.availability.findMany({ where: { doctorId: d.id }, orderBy: { dayOfWeek: 'asc' } });
  }

  @Get('schedule') @Roles(Role.DOCTOR)
  async schedule(@Req() req: any, @Query('date') date: string) {
    const d = await this.me(req);
    return this.prisma.appointment.findMany({
      where: { doctorId: d.id, date: parseDay(date), status: { in: ['CONFIRMED', 'IN_QUEUE', 'COMPLETED', 'NO_SHOW'] } },
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { slot: 'asc' },
    });
  }

  @Get()
  async search(@Query('specialization') spec?: string, @Query('stream') stream?: string, @Query('q') q?: string) {
    if (stream && !(STREAMS as readonly string[]).includes(stream)) throw new BadRequestException('invalid stream');
    const rows = await this.prisma.doctor.findMany({
      where: {
        isVerified: true,
        ...(spec && { specialization: { contains: spec, mode: 'insensitive' } }),
        ...(stream && { medicalStream: stream as any }),
        ...(q && { user: { name: { contains: q, mode: 'insensitive' } } }),
      },
      include: { user: true },
    });
    return rows.map((d) => this.view(d));
  }

  @Get(':id')
  async byId(@Param('id') id: string) {
    const d = await this.prisma.doctor.findUnique({ where: { id }, include: { user: true } });
    if (!d || !d.isVerified) throw new NotFoundException('Doctor not found');
    return this.view(d);
  }
}
