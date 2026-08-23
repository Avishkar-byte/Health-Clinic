import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import type Redis from 'ioredis';

// Render's own health check and any external uptime pinger hit this
// frequently and legitimately — never rate-limit it.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, string> = {};

    // Database check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'error';
    }

    // Redis check
    try {
      if (this.redis) {
        await this.redis.ping();
        checks['redis'] = 'ok';
      } else {
        checks['redis'] = 'not_configured';
      }
    } catch {
      checks['redis'] = 'error';
    }

    const status = Object.values(checks).every((v) => v === 'ok' || v === 'not_configured')
      ? 'healthy'
      : 'degraded';

    return { status, checks, timestamp: new Date().toISOString() };
  }
}
