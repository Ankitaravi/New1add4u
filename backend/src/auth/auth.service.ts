import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;
export const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

const isProd = () => process.env.NODE_ENV === 'production';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('hex');

/**
 * OTP login with short-lived access tokens and rotating refresh tokens.
 *
 *   POST /auth/otp/request  {phone}                       -> {challengeId, expiresInSeconds}
 *   POST /auth/otp/verify   {challengeId, phone, code}    -> {accessToken, refreshToken, user, ...}
 *   POST /auth/refresh      {refreshToken}                -> {accessToken, refreshToken}
 *   POST /auth/logout       {refreshToken}                -> ends the whole session
 */
@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async requestOtp(phone: string) {
    const recent = await this.prisma.otp.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - 3600 * 1000) } },
    });
    if (recent >= OTP_MAX_PER_HOUR) {
      throw new HttpException('Too many OTP requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // TODO: deliver via an SMS provider in production. Outside production the
    // code is fixed so apps and tests can log in without an SMS gateway.
    const code = isProd() ? String(randomInt(100000, 1000000)) : '123456';
    const otp = await this.prisma.otp.create({
      data: { phone, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    return { challengeId: otp.id, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  async verifyOtp(challengeId: string, phone: string, code: string) {
    const bad = () => new UnauthorizedException('Invalid or expired OTP');
    const otp = await this.prisma.otp.findUnique({ where: { id: challengeId } });
    if (!otp || otp.phone !== phone || otp.consumed || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw bad();
    }
    if (otp.code !== code) {
      // 6 digits is only 1M combinations: cap guesses per challenge.
      await this.prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw bad();
    }
    // Single use, even under concurrent submissions.
    const { count } = await this.prisma.otp.updateMany({ where: { id: otp.id, consumed: false }, data: { consumed: true } });
    if (!count) throw bad();

    const user = await this.prisma.user.upsert({ where: { phone }, update: {}, create: { phone } });
    const tokens = await this.issue(user.id, randomBytes(12).toString('hex'));
    // `adminApprovalRequired` is reserved for a future approval flow for platform admins.
    return { ...tokens, user, adminApprovalRequired: false };
  }

  /** Rotates the refresh token. Presenting one that was already rotated revokes the whole session. */
  async refresh(refreshToken: string) {
    const bad = () => new UnauthorizedException('Invalid refresh token');
    const row = await this.prisma.refreshToken.findUnique({ where: { hash: sha256(refreshToken) } });
    if (!row) throw bad();
    if (row.usedAt) {
      await this.revokeFamily(row.familyId);
      throw bad();
    }
    if (row.expiresAt < new Date()) throw bad();

    const { count } = await this.prisma.refreshToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!count) {
      // Lost a race with another use of the same token: treat as reuse.
      await this.revokeFamily(row.familyId);
      throw bad();
    }
    return this.issue(row.userId, row.familyId);
  }

  /** Idempotent: an unknown or already-revoked token is not an error. */
  async logout(refreshToken: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { hash: sha256(refreshToken) } });
    if (row) await this.revokeFamily(row.familyId);
    return { ok: true };
  }

  private async issue(userId: string, familyId: string) {
    const accessToken = newToken();
    const refreshToken = newToken();
    await this.prisma.$transaction([
      this.prisma.authToken.create({
        data: { token: accessToken, userId, familyId, expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000) },
      }),
      this.prisma.refreshToken.create({
        data: { hash: sha256(refreshToken), userId, familyId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
      }),
    ]);
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_S };
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.$transaction([
      this.prisma.authToken.deleteMany({ where: { familyId } }),
      this.prisma.refreshToken.deleteMany({ where: { familyId } }),
    ]);
  }
}
