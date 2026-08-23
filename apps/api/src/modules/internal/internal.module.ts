import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { SlotsModule } from '../slots/slots.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [SlotsModule, OutboxModule, AvailabilityModule],
  controllers: [InternalController],
})
export class InternalModule {}
