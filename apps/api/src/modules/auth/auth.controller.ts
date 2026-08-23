import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterSchema, LoginSchema, RefreshSchema } from '@healthcare/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

// Tighter than the global default — these are the brute-force targets.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: { email: string; password: string; fullName: string; phone?: string; timezone?: string },
  ) {
    return this.auth.register(body as any);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: { email: string; password: string },
  ) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) body: { refreshToken: string },
  ) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout() {
    // Stateless JWT — client discards tokens.
    // Refresh token rotation handles reuse detection on the next refresh attempt.
    return;
  }
}
