import { BadRequestException, Body, ConflictException, Controller, Get, Post, Req } from '@nestjs/common';
import { Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

class ReferralDto {
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' }) phone: string;
}

@Controller('referrals')
export class ReferralsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Req() req: any, @Body() b: ReferralDto) {
    if (b.phone === req.user.phone) throw new BadRequestException('You cannot refer yourself');
    if (await this.prisma.user.findUnique({ where: { phone: b.phone } })) throw new ConflictException('This person is already on 1ADD4U');
    try {
      return await this.prisma.referral.create({ data: { referrerId: req.user.id, phone: b.phone } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('You already referred this number');
      throw e;
    }
  }

  /** `joined` is true once the referred number has signed up. */
  @Get('my')
  async mine(@Req() req: any) {
    const rows = await this.prisma.referral.findMany({ where: { referrerId: req.user.id }, orderBy: { createdAt: 'desc' } });
    const joined = new Set((await this.prisma.user.findMany({ where: { phone: { in: rows.map((r) => r.phone) } }, select: { phone: true } })).map((u) => u.phone));
    return rows.map((r) => ({ id: r.id, phone: r.phone, createdAt: r.createdAt, joined: joined.has(r.phone) }));
  }
}
