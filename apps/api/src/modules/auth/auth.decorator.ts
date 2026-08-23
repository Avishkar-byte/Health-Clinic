import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

export const ROLES_KEY = 'roles';

/**
 * Route-level RBAC decorator.
 * Usage: @Auth('admin') or @Auth('doctor', 'admin')
 * Combines JWT authentication with role checking.
 */
export function Auth(...roles: string[]) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(JwtAuthGuard, RolesGuard),
  );
}
