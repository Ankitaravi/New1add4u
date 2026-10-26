import {
  Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Req,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { MAX_UNIT_PRICE_PAISE } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

export const LAB_TEST_TYPES = [
  'cbc', 'bloodSugar', 'hba1c', 'lipidProfile', 'liverFunction', 'kidneyFunction', 'thyroidProfile',
  'urineRoutine', 'vitaminD', 'vitaminB12', 'xray', 'ecg', 'ultrasound', 'other',
] as const;

class LabProfileDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() city?: string;
}
class TestDto {
  @IsIn(LAB_TEST_TYPES) type: string;
  @IsString() @MinLength(1) name: string;
  @IsInt() @Min(1) @Max(MAX_UNIT_PRICE_PAISE) pricePaise: number;
}
class UpdateTestDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_UNIT_PRICE_PAISE) pricePaise?: number;
}

@Controller('labs')
export class LabsController {
  constructor(private prisma: PrismaService) {}

  private async myLab(req: any) {
    const lab = await this.prisma.labProfile.findUnique({ where: { userId: req.user.id } });
    if (!lab) throw new NotFoundException('Create your lab profile first');
    return lab;
  }

  @Put('profile') @Roles(Role.INVESTIGATION)
  upsertProfile(@Req() req: any, @Body() b: LabProfileDto) {
    return this.prisma.labProfile.upsert({
      where: { userId: req.user.id },
      update: b,
      create: { ...b, userId: req.user.id },
    });
  }

  @Get('profile') @Roles(Role.INVESTIGATION)
  profile(@Req() req: any) {
    return this.myLab(req);
  }

  @Post('tests') @Roles(Role.INVESTIGATION)
  async addTest(@Req() req: any, @Body() b: TestDto) {
    const lab = await this.myLab(req);
    return this.prisma.labTest.create({ data: { ...b, labId: lab.id } });
  }

  @Patch('tests/:id') @Roles(Role.INVESTIGATION)
  async updateTest(@Req() req: any, @Param('id') id: string, @Body() b: UpdateTestDto) {
    const lab = await this.myLab(req);
    const { count } = await this.prisma.labTest.updateMany({ where: { id, labId: lab.id }, data: b });
    if (!count) throw new NotFoundException('Test not found');
    return this.prisma.labTest.findUnique({ where: { id } });
  }

  @Delete('tests/:id') @Roles(Role.INVESTIGATION)
  async removeTest(@Req() req: any, @Param('id') id: string) {
    const lab = await this.myLab(req);
    const used = await this.prisma.labBooking.count({ where: { testId: id } });
    if (used) {
      throw new ConflictException('Test has bookings and cannot be deleted');
    }
    const { count } = await this.prisma.labTest.deleteMany({ where: { id, labId: lab.id } });
    if (!count) throw new NotFoundException('Test not found');
    return { ok: true };
  }

  @Get()
  list() {
    return this.prisma.labProfile.findMany({ select: { id: true, name: true, city: true } });
  }

  @Get(':id/tests')
  async tests(@Param('id') id: string) {
    if (!(await this.prisma.labProfile.findUnique({ where: { id } }))) throw new NotFoundException('Lab not found');
    return this.prisma.labTest.findMany({ where: { labId: id }, orderBy: { name: 'asc' } });
  }
}
