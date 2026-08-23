import { Controller, Post, Delete, Get, Param, Body, Query } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { LeavesService } from './leaves.service';
import { CreateLeaveSchema } from '@healthcare/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller()
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Get('admin/doctors/:id/leaves/preview')
  @Auth('admin')
  previewLeave(
    @Param('id') doctorId: string,
    @Query('startTs') startTs: string,
    @Query('endTs') endTs: string,
  ) {
    return this.leaves.previewLeave(doctorId, startTs, endTs);
  }

  @Post('admin/doctors/:id/leaves')
  @Auth('admin')
  createLeave(
    @Param('id') doctorId: string,
    @Body(new ZodValidationPipe(CreateLeaveSchema)) body: any,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.leaves.createLeave(doctorId, body, user.userId);
  }

  @Delete('admin/leaves/:id')
  @Auth('admin')
  deleteLeave(@Param('id') leaveId: string) {
    return this.leaves.deleteLeave(leaveId);
  }

  @Get('admin/doctors/:id/leaves')
  @Auth('admin', 'doctor')
  getDoctorLeaves(@Param('id') doctorId: string) {
    return this.leaves.getDoctorLeaves(doctorId);
  }
}
