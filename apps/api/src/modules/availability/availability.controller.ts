import { Controller, Put, Get, Param, Body } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { AvailabilityService } from './availability.service';
import { SetAvailabilitySchema } from '@healthcare/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Put('admin/doctors/:id/availability')
  @Auth('admin')
  setAvailability(
    @Param('id') doctorId: string,
    @Body(new ZodValidationPipe(SetAvailabilitySchema)) body: any,
  ) {
    return this.availability.setAvailability(doctorId, body);
  }

  @Get('admin/doctors/:id/availability')
  @Auth('admin', 'doctor')
  getAvailability(@Param('id') doctorId: string) {
    return this.availability.getAvailability(doctorId);
  }
}
