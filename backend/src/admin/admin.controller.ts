import { Body, Controller, Get, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { formatHprId } from '../common/hpr';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class VerifyDto {
  @IsBoolean() verified: boolean;
}

@Controller('admin')
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  @Get('users')
  users(@Query('role') role?: string, @Query('q') q?: string, @Query('page') page = '1', @Query('limit') limit = '50') {
    const take = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;
    const where = {
      ...(role && (Object.values(Role) as string[]).includes(role) && { role: role as Role }),
      ...(q && { OR: [{ phone: { contains: q } }, { name: { contains: q, mode: 'insensitive' as const } }] }),
    };
    return Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.user.count({ where }),
    ]).then(([items, total]) => ({ total, items }));
  }

  @Get('doctors/pending')
  async pendingDoctors() {
    const rows = await this.prisma.doctor.findMany({ where: { isVerified: false }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((d) => ({
      id: d.id, name: d.user.name, phone: d.user.phone,
      hprId: d.hprId ? formatHprId(d.hprId) : null, medicalStream: d.medicalStream, specialization: d.specialization,
    }));
  }

  @Patch('doctors/:id/verify')
  async verify(@Param('id') id: string, @Body() b: VerifyDto) {
    const d = await this.prisma.doctor.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Doctor not found');
    const u = await this.prisma.doctor.update({ where: { id }, data: { isVerified: b.verified } });
    await this.notifications.notify(
      d.userId,
      b.verified ? 'Profile verified' : 'Verification revoked',
      b.verified ? 'You can now receive appointments.' : 'Your profile is no longer verified. Contact support.',
    );
    return { id: u.id, isVerified: u.isVerified };
  }

  @Get('stats')
  async stats() {
    const [users, doctors, verifiedDoctors, appointments, paid] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.doctor.count(),
      this.prisma.doctor.count({ where: { isVerified: true } }),
      this.prisma.appointment.count(),
      this.prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amountPaise: true } }),
    ]);
    return { users, doctors, verifiedDoctors, appointments, revenuePaise: paid._sum.amountPaise ?? 0 };
  }
}
