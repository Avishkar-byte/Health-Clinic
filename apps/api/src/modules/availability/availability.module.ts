import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { SlotGeneratorService } from './slot-generator.service';

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService, SlotGeneratorService],
  exports: [AvailabilityService, SlotGeneratorService],
})
export class AvailabilityModule {}
