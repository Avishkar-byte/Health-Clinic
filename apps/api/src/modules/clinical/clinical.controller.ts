import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { ClinicalService } from './clinical.service';
import { VisitNoteSchema } from '@healthcare/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller()
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @Get('appointments/:id/pre-visit')
  @Auth('doctor')
  getPreVisit(
    @Param('id') appointmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.clinical.getPreVisitSummary(appointmentId, user.userId);
  }

  @Post('appointments/:id/notes')
  @Auth('doctor')
  submitNotes(
    @Param('id') appointmentId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(VisitNoteSchema)) body: any,
  ) {
    return this.clinical.submitVisitNotes(appointmentId, user.userId, body);
  }

  @Get('appointments/:id/post-visit')
  @Auth('patient')
  getPostVisit(
    @Param('id') appointmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.clinical.getPostVisitSummary(appointmentId, user.userId);
  }

  @Get('patients/me/medications')
  @Auth('patient')
  getMyMedications(@CurrentUser() user: CurrentUserPayload) {
    return this.clinical.getPatientMedications(user.userId);
  }
}
