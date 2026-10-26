import {
  Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Req,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { MAX_UNIT_PRICE_PAISE } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

class ProfileDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() city?: string;
}
class ItemDto {
  @IsString() @MinLength(1) name: string;
  @IsInt() @Min(1) @Max(MAX_UNIT_PRICE_PAISE) unitPricePaise: number;
  @IsInt() @Min(0) stock: number;
}
class UpdateItemDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_UNIT_PRICE_PAISE) unitPricePaise?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
}

@Controller('pharma')
export class PharmaController {
  constructor(private prisma: PrismaService) {}

  private async mine(req: any) {
    const p = await this.prisma.pharmaProfile.findUnique({ where: { userId: req.user.id } });
    if (!p) throw new NotFoundException('Create your pharmacy profile first');
    return p;
  }

  @Put('profile') @Roles(Role.PHARMA)
  upsert(@Req() req: any, @Body() b: ProfileDto) {
    return this.prisma.pharmaProfile.upsert({ where: { userId: req.user.id }, update: b, create: { ...b, userId: req.user.id } });
  }

  @Get('profile') @Roles(Role.PHARMA)
  profile(@Req() req: any) {
    return this.mine(req);
  }

  @Get('inventory') @Roles(Role.PHARMA)
  async inventory(@Req() req: any) {
    const p = await this.mine(req);
    return this.prisma.pharmaItem.findMany({ where: { pharmaId: p.id }, orderBy: { name: 'asc' } });
  }

  @Post('inventory') @Roles(Role.PHARMA)
  async add(@Req() req: any, @Body() b: ItemDto) {
    const p = await this.mine(req);
    return this.prisma.pharmaItem.create({ data: { ...b, pharmaId: p.id } });
  }

  @Patch('inventory/:id') @Roles(Role.PHARMA)
  async update(@Req() req: any, @Param('id') id: string, @Body() b: UpdateItemDto) {
    const p = await this.mine(req);
    const { count } = await this.prisma.pharmaItem.updateMany({ where: { id, pharmaId: p.id }, data: b });
    if (!count) throw new NotFoundException('Item not found');
    return this.prisma.pharmaItem.findUnique({ where: { id } });
  }

  @Delete('inventory/:id') @Roles(Role.PHARMA)
  async remove(@Req() req: any, @Param('id') id: string) {
    const p = await this.mine(req);
    const { count } = await this.prisma.pharmaItem.deleteMany({ where: { id, pharmaId: p.id } });
    if (!count) throw new NotFoundException('Item not found');
    return { ok: true };
  }

  @Get()
  list() {
    return this.prisma.pharmaProfile.findMany({ select: { id: true, name: true, city: true } });
  }

  @Get(':id/inventory')
  async publicInventory(@Param('id') id: string) {
    if (!(await this.prisma.pharmaProfile.findUnique({ where: { id } }))) throw new NotFoundException('Pharmacy not found');
    return this.prisma.pharmaItem.findMany({ where: { pharmaId: id, stock: { gt: 0 } }, orderBy: { name: 'asc' } });
  }
}
