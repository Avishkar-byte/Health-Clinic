import { Controller, Post, Delete, Get, Param, Query } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { SlotsService } from './slots.service';

@Controller()
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get('doctors/:id/slots')
  getSlots(
    @Param('id') doctorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.slots.getSlots(doctorId, from, to);
  }

  @Post('slots/:id/hold')
  @Auth('patient')
  holdSlot(
    @Param('id') slotId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.slots.holdSlot(slotId, user.userId);
  }

  @Delete('holds/:token')
  @Auth('patient')
  releaseHold(@Param('token') token: string) {
    return this.slots.releaseHold(token);
  }
}
