import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

const KINDS = ['prescription', 'lab_report', 'vitals', 'allergy', 'note', 'other'] as const;

class RecordDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsIn(KINDS) kind: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

@Controller('health-records')
export class HealthRecordsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  create(@Req() req: any, @Body() b: RecordDto) {
    return this.prisma.healthRecord.create({ data: { ...b, data: b.data as any, userId: req.user.id } });
  }

  @Get()
  list(@Req() req: any, @Query('kind') kind?: string) {
    return this.prisma.healthRecord.findMany({
      where: { userId: req.user.id, ...(kind && { kind }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async one(@Req() req: any, @Param('id') id: string) {
    const r = await this.prisma.healthRecord.findFirst({ where: { id, userId: req.user.id } });
    if (!r) throw new NotFoundException('Record not found');
    return r;
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const { count } = await this.prisma.healthRecord.deleteMany({ where: { id, userId: req.user.id } });
    if (!count) throw new NotFoundException('Record not found');
    return { ok: true };
  }
}
