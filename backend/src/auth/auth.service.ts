import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const OTP_TTL_MS = 5 * 60 * 1000;
const isProd = () => process.env.NODE_ENV === 'production';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async sendOtp(phone: string) {
    // TODO: deliver via an SMS provider in production. Outside production the
    // code is fixed so apps and tests can log in without an SMS gateway.
    const code = isProd() ? String(randomInt(100000, 1000000)) : '123456';
    await this.prisma.otp.create({
      data: { phone, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    return { sent: true };
  }

  async verifyOtp(phone: string, otp: string) {
    const row = await this.prisma.otp.findFirst({
      where: { phone, code: otp, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new UnauthorizedException('Invalid or expired OTP');
    await this.prisma.otp.update({ where: { id: row.id }, data: { consumed: true } });

    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });
    const token = randomBytes(32).toString('hex');
    await this.prisma.authToken.create({ data: { token, userId: user.id } });
    return { token, user };
  }

  async logout(token: string) {
    await this.prisma.authToken.deleteMany({ where: { token } });
    return { ok: true };
  }
}
