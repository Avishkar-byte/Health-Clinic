import { Controller, Post, Patch, Get, Body, Param, Query } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { UsersService } from './users.service';
import { CreateDoctorSchema, UpdateDoctorSchema } from '@healthcare/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('admin/doctors')
  @Auth('admin')
  createDoctor(
    @Body(new ZodValidationPipe(CreateDoctorSchema)) body: any,
  ) {
    return this.users.createDoctor(body);
  }

  @Patch('admin/doctors/:id')
  @Auth('admin')
  updateDoctor(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDoctorSchema)) body: any,
  ) {
    return this.users.updateDoctor(id, body);
  }

  @Get('doctors')
  findDoctors(
    @Query('specialisation') specialisation?: string,
    @Query('q') q?: string,
  ) {
    return this.users.findDoctors({ specialisation, q });
  }

  @Get('doctors/:id')
  findDoctorById(@Param('id') id: string) {
    return this.users.findDoctorById(id);
  }
}
