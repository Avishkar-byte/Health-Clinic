import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SpecialisationsModule } from './modules/specialisations/specialisations.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { SlotsModule } from './modules/slots/slots.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { LeavesModule } from './modules/leaves/leaves.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { InternalModule } from './modules/internal/internal.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    // §11: "Abuse — Rate limits per IP and per user". Global default is a
    // generous ceiling against gross abuse; auth.controller.ts sets a
    // tighter limit on login/register specifically against brute force.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    SpecialisationsModule,
    AvailabilityModule,
    SlotsModule,
    AppointmentsModule,
    ClinicalModule,
    LeavesModule,
    OutboxModule,
    IntegrationsModule,
    InternalModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
