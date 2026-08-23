import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  userId: string;
  email: string;
  role: 'patient' | 'doctor' | 'admin';
}

/**
 * Parameter decorator to extract the current authenticated user from the request.
 * Usage: @CurrentUser() user: CurrentUserPayload
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
