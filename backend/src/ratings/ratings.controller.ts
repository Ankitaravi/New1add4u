import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { PrismaService } from '../prisma/prisma.service';

class RatingDto {
  @IsString() doctorId: string;
  @IsInt() @Min(1) @Max(5) stars: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

@Controller('ratings')
export class RatingsController {
  constructor(private prisma: PrismaService) {}

  /** One rating per patient per doctor (re-posting updates it); needs a completed appointment. */
  @Post() @Roles(Role.USER)
  async rate(@Req() req: any, @Body() b: RatingDto) {
    if (!(await this.prisma.doctor.findUnique({ where: { id: b.doctorId } }))) throw new NotFoundException('Doctor not found');
    const done = await this.prisma.appointment.count({ where: { userId: req.user.id, doctorId: b.doctorId, status: 'COMPLETED' } });
    if (!done) throw new BadRequestException('You can rate a doctor only after a completed appointment');
    return this.prisma.rating.upsert({
      where: { userId_doctorId: { userId: req.user.id, doctorId: b.doctorId } },
      update: { stars: b.stars, comment: b.comment },
      create: { userId: req.user.id, doctorId: b.doctorId, stars: b.stars, comment: b.comment },
    });
  }

  @Get('doctor/:id')
  async forDoctor(@Param('id') id: string) {
    if (!(await this.prisma.doctor.findUnique({ where: { id } }))) throw new NotFoundException('Doctor not found');
    const [agg, ratings] = await Promise.all([
      this.prisma.rating.aggregate({ where: { doctorId: id }, _avg: { stars: true }, _count: true }),
      this.prisma.rating.findMany({
        where: { doctorId: id }, orderBy: { createdAt: 'desc' }, take: 50,
        select: { stars: true, comment: true, createdAt: true, user: { select: { name: true } } },
      }),
    ]);
    return {
      average: agg._avg.stars === null ? null : Math.round(agg._avg.stars * 10) / 10,
      count: agg._count,
      ratings: ratings.map((r) => ({ stars: r.stars, comment: r.comment, createdAt: r.createdAt, name: r.user.name })),
    };
  }
}
