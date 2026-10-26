import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Req,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { parseDay } from '../common/dates';
import { validHprId } from '../common/hpr';
import { PrismaService } from '../prisma/prisma.service';

class ProfileDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() city?: string;
}
class DepartmentDto {
  @IsString() @MinLength(2) name: string;
}
class LinkDoctorDto {
  @IsString() hprId: string;
}

const PAID = ['CONFIRMED', 'IN_QUEUE', 'COMPLETED'] as const;

@Controller('hospitals')
export class HospitalsController {
  constructor(private prisma: PrismaService) {}

  private async mine(req: any) {
    const h = await this.prisma.hospital.findUnique({ where: { adminId: req.user.id } });
    if (!h) throw new NotFoundException('Create your hospital profile first');
    return h;
  }

  @Put('profile') @Roles(Role.HOSPITAL_ADMIN)
  upsert(@Req() req: any, @Body() b: ProfileDto) {
    return this.prisma.hospital.upsert({ where: { adminId: req.user.id }, update: b, create: { ...b, adminId: req.user.id } });
  }

  @Get('profile') @Roles(Role.HOSPITAL_ADMIN)
  profile(@Req() req: any) {
    return this.mine(req);
  }

  @Get('departments') @Roles(Role.HOSPITAL_ADMIN)
  async departments(@Req() req: any) {
    const h = await this.mine(req);
    return this.prisma.department.findMany({ where: { hospitalId: h.id }, orderBy: { name: 'asc' } });
  }

  @Post('departments') @Roles(Role.HOSPITAL_ADMIN)
  async addDepartment(@Req() req: any, @Body() b: DepartmentDto) {
    const h = await this.mine(req);
    return this.prisma.department.create({ data: { name: b.name, hospitalId: h.id } });
  }

  @Delete('departments/:id') @Roles(Role.HOSPITAL_ADMIN)
  async removeDepartment(@Req() req: any, @Param('id') id: string) {
    const h = await this.mine(req);
    const { count } = await this.prisma.department.deleteMany({ where: { id, hospitalId: h.id } });
    if (!count) throw new NotFoundException('Department not found');
    return { ok: true };
  }

  @Get('doctors') @Roles(Role.HOSPITAL_ADMIN)
  async doctors(@Req() req: any) {
    const h = await this.mine(req);
    const rows = await this.prisma.doctor.findMany({ where: { hospitalId: h.id }, include: { user: true } });
    return rows.map((d) => ({ id: d.id, name: d.user.name, specialization: d.specialization, medicalStream: d.medicalStream, feePaise: d.feePaise }));
  }

  /** Attach a verified doctor, identified by HPR ID, to this hospital. */
  @Post('doctors') @Roles(Role.HOSPITAL_ADMIN)
  async linkDoctor(@Req() req: any, @Body() b: LinkDoctorDto) {
    if (!validHprId(b.hprId)) throw new BadRequestException('HPR ID must be exactly 14 digits');
    const h = await this.mine(req);
    const d = await this.prisma.doctor.findUnique({ where: { hprId: b.hprId.replace(/-/g, '') } });
    if (!d || !d.isVerified) throw new NotFoundException('No verified doctor with that HPR ID');
    if (d.hospitalId && d.hospitalId !== h.id) throw new ConflictException('Doctor is already linked to another hospital');
    await this.prisma.doctor.update({ where: { id: d.id }, data: { hospitalId: h.id } });
    return { id: d.id };
  }

  @Delete('doctors/:id') @Roles(Role.HOSPITAL_ADMIN)
  async unlinkDoctor(@Req() req: any, @Param('id') id: string) {
    const h = await this.mine(req);
    const { count } = await this.prisma.doctor.updateMany({ where: { id, hospitalId: h.id }, data: { hospitalId: null } });
    if (!count) throw new NotFoundException('Doctor not found in your hospital');
    return { ok: true };
  }

  @Get('appointments') @Roles(Role.HOSPITAL_ADMIN)
  async appointments(@Req() req: any, @Query('date') date: string) {
    const h = await this.mine(req);
    return this.prisma.appointment.findMany({
      where: { doctor: { hospitalId: h.id }, date: parseDay(date), status: { in: [...PAID, 'NO_SHOW'] } },
      include: { doctor: { select: { id: true, specialization: true, user: { select: { name: true } } } }, user: { select: { name: true, phone: true } } },
      orderBy: [{ slot: 'asc' }],
    });
  }

  @Get('stats') @Roles(Role.HOSPITAL_ADMIN)
  async stats(@Req() req: any) {
    const h = await this.mine(req);
    const where = { doctor: { hospitalId: h.id } };
    const [doctors, byStatus, revenue] = await Promise.all([
      this.prisma.doctor.count({ where: { hospitalId: h.id } }),
      this.prisma.appointment.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.appointment.aggregate({ where: { ...where, status: { in: [...PAID] } }, _sum: { totalPaise: true } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    return {
      doctors,
      appointments: byStatus.reduce((n, s) => n + s._count, 0),
      byStatus: counts,
      revenuePaise: revenue._sum.totalPaise ?? 0,
    };
  }

  @Get()
  list() {
    return this.prisma.hospital.findMany({ select: { id: true, name: true, city: true } });
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const h = await this.prisma.hospital.findUnique({
      where: { id },
      select: { id: true, name: true, city: true, departments: { select: { id: true, name: true } }, _count: { select: { doctors: true } } },
    });
    if (!h) throw new NotFoundException('Hospital not found');
    return h;
  }
}
