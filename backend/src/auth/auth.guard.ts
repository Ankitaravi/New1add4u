import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_KEY } from './roles';

/** Global guard: bearer-token auth + @Roles() RBAC. SUPER_ADMIN passes every role check. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('isPublic', targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing token');

    const row = await this.prisma.authToken.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!row || (row.expiresAt && row.expiresAt < new Date())) throw new UnauthorizedException('Invalid token');
    req.user = row.user;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
    if (roles?.length && row.user.role !== 'SUPER_ADMIN' && !roles.includes(row.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
