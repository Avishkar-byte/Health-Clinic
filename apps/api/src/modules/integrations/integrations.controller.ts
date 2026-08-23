import { Controller, Get, Delete, Query, Res } from '@nestjs/common';
import { Auth } from '../auth/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

@Controller('integrations/google')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  @Auth('patient', 'doctor')
  async status(@CurrentUser() user: CurrentUserPayload) {
    return {
      connected: await this.integrations.isConnected(user.userId),
      configured: !!this.config.get('GOOGLE_CLIENT_ID'),
    };
  }

  @Get('connect')
  @Auth('patient', 'doctor')
  connect(
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const url = this.integrations.getConnectUrl(user.userId);
    if (!url) {
      return res.json({ error: 'Google Calendar integration is not configured' });
    }
    return res.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    await this.integrations.handleCallback(code, userId);
    const webUrl = this.config.get('WEB_URL', 'http://localhost:3000');
    return res.redirect(`${webUrl}/settings?google=connected`);
  }

  @Delete()
  @Auth('patient', 'doctor')
  disconnect(@CurrentUser() user: CurrentUserPayload) {
    return this.integrations.disconnect(user.userId);
  }
}
