import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsIn(['male', 'female', 'other']) gender?: string;
  @IsOptional() @IsDateString() dob?: string;
}
class FamilyDto {
  @IsString() @MinLength(1) name: string;
  @IsString() relation: string;
  @IsOptional() @IsIn(['male', 'female', 'other']) gender?: string;
  @IsOptional() @IsDateString() dob?: string;
}

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get('profile')
  profile(@Req() req: any) {
    return this.prisma.user.findUnique({ where: { id: req.user.id } });
  }

  @Patch('profile')
  update(@Req() req: any, @Body() b: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: req.user.id },
      data: { ...b, dob: b.dob ? new Date(b.dob) : undefined },
    });
  }

  @Get('family')
  family(@Req() req: any) {
    return this.prisma.familyMember.findMany({ where: { userId: req.user.id } });
  }

  @Post('family')
  addFamily(@Req() req: any, @Body() b: FamilyDto) {
    return this.prisma.familyMember.create({
      data: { ...b, dob: b.dob ? new Date(b.dob) : undefined, userId: req.user.id },
    });
  }

  @Delete('family/:id')
  async removeFamily(@Req() req: any, @Param('id') id: string) {
    const { count } = await this.prisma.familyMember.deleteMany({
      where: { id, userId: req.user.id },
    });
    if (!count) throw new NotFoundException();
    return { ok: true };
  }
}
