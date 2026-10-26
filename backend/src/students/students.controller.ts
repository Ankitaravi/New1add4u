import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { PrismaService } from '../prisma/prisma.service';

const STREAMS = ['mbbs', 'dental', 'ayurveda', 'homeopathy'] as const;

class ProfileDto {
  @IsOptional() @IsString() college?: string;
  @IsOptional() @IsIn(STREAMS) stream?: (typeof STREAMS)[number];
}
class CourseDto {
  @IsString() @MinLength(3) title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(STREAMS) stream?: (typeof STREAMS)[number];
  @IsInt() @Min(1) @Max(500) lessons: number;
}
class ProgressDto {
  @IsInt() @Min(0) progress: number;
}

@Controller('students')
export class StudentsController {
  constructor(private prisma: PrismaService) {}

  private async me(req: any) {
    const s = await this.prisma.studentProfile.findUnique({ where: { userId: req.user.id } });
    if (!s) throw new NotFoundException('Create your student profile first');
    return s;
  }

  @Put('profile') @Roles(Role.STUDENT)
  upsert(@Req() req: any, @Body() b: ProfileDto) {
    return this.prisma.studentProfile.upsert({ where: { userId: req.user.id }, update: b, create: { ...b, userId: req.user.id } });
  }

  @Get('profile') @Roles(Role.STUDENT)
  profile(@Req() req: any) {
    return this.me(req);
  }

  /** Catalogue; filter by stream. */
  @Get('courses') @Roles(Role.STUDENT)
  courses(@Query('stream') stream?: string) {
    if (stream && !(STREAMS as readonly string[]).includes(stream)) throw new BadRequestException('invalid stream');
    return this.prisma.course.findMany({ where: stream ? { stream: stream as any } : {}, orderBy: { title: 'asc' } });
  }

  @Post('courses') @Roles(Role.SUPER_ADMIN)
  createCourse(@Body() b: CourseDto) {
    return this.prisma.course.create({ data: b });
  }

  @Get('my-courses') @Roles(Role.STUDENT)
  async mine(@Req() req: any) {
    const s = await this.me(req);
    return this.prisma.enrollment.findMany({ where: { studentId: s.id }, include: { course: true }, orderBy: { createdAt: 'desc' } });
  }

  @Post('courses/:id/enroll') @Roles(Role.STUDENT)
  async enroll(@Req() req: any, @Param('id') id: string) {
    const s = await this.me(req);
    if (!(await this.prisma.course.findUnique({ where: { id } }))) throw new NotFoundException('Course not found');
    try {
      return await this.prisma.enrollment.create({ data: { studentId: s.id, courseId: id } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Already enrolled');
      throw e;
    }
  }

  @Patch('courses/:id/progress') @Roles(Role.STUDENT)
  async progress(@Req() req: any, @Param('id') id: string, @Body() b: ProgressDto) {
    const s = await this.me(req);
    const e = await this.prisma.enrollment.findUnique({ where: { studentId_courseId: { studentId: s.id, courseId: id } }, include: { course: true } });
    if (!e) throw new NotFoundException('Not enrolled in this course');
    if (b.progress > e.course.lessons) throw new BadRequestException(`progress cannot exceed ${e.course.lessons} lessons`);
    // Progress only moves forward; a stale client must not erase completed lessons.
    return this.prisma.enrollment.update({ where: { id: e.id }, data: { progress: Math.max(e.progress, b.progress) } });
  }
}
