import { SetMetadata } from '@nestjs/common';
import { Role } from '../generated/prisma/client';

export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
