import { Controller, Get } from '@nestjs/common';
import { SpecialisationsService } from './specialisations.service';

@Controller('specialisations')
export class SpecialisationsController {
  constructor(private readonly specialisations: SpecialisationsService) {}

  @Get()
  findAll() {
    return this.specialisations.findAll();
  }
}
