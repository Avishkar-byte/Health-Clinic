import {
  Controller, Post, Get, Param, Body, Query, Headers,
  HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentSchema, CancelAppointmentSchema } from '@healthcare/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @Auth('patient')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateAppointmentSchema)) body: any,
    @CurrentUser() user: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        title: 'Missing Idempotency-Key',
        detail: 'The Idempotency-Key header is required for booking requests.',
      });
    }

    return this.appointments.createAppointment(body, user.userId, idempotencyKey);
  }

  @Get()
  @Auth('patient', 'doctor', 'admin')
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: string,
  ) {
    return this.appointments.getAppointments(user.userId, user.role, status);
  }

  @Get(':id')
  @Auth('patient', 'doctor', 'admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.appointments.getAppointmentById(id, user.userId, user.role);
  }

  @Post(':id/cancel')
  @Auth('patient', 'doctor', 'admin')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(CancelAppointmentSchema)) body: any,
  ) {
    return this.appointments.cancelAppointment(id, user.userId, user.role, body.reason);
  }
}
