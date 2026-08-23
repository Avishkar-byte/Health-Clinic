import { Module } from '@nestjs/common';
import { SpecialisationsController } from './specialisations.controller';
import { SpecialisationsService } from './specialisations.service';

@Module({
  controllers: [SpecialisationsController],
  providers: [SpecialisationsService],
  exports: [SpecialisationsService],
})
export class SpecialisationsModule {}
