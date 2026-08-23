import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { encryptSecret } from '@healthcare/contracts';

/**
 * Google Calendar OAuth 2.0 integration.
 * Degrades gracefully when GOOGLE_CLIENT_ID is not set.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly isEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.isEnabled = !!this.config.get('GOOGLE_CLIENT_ID');
    if (!this.isEnabled) {
      this.logger.warn('Google Calendar integration disabled — GOOGLE_CLIENT_ID not set');
    }
  }

  /**
   * Generate OAuth consent URL.
   */
  getConnectUrl(userId: string): string {
    if (!this.isEnabled) {
      return '';
    }

    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.get('GOOGLE_REDIRECT_URI');
    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri!,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
      state: userId,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Handle OAuth callback — exchange code for tokens.
   */
  async handleCallback(code: string, userId: string) {
    if (!this.isEnabled) return { success: false, reason: 'Google Calendar not configured' };

    const clientId = this.config.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.config.get('GOOGLE_REDIRECT_URI');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri!,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      this.logger.error(`OAuth token exchange failed: ${response.status}`);
      return { success: false, reason: 'Token exchange failed' };
    }

    const tokens = await response.json() as any;

    // A refresh_token is only returned on the first consent (prompt=consent
    // forces this), so on a re-connect we may not get a new one — keep the
    // existing encrypted refresh token rather than overwriting it with ''.
    const existing = await this.prisma.oauthCredential.findUnique({
      where: { userId_provider: { userId, provider: 'google' } },
    });

    const refreshTokenEnc = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : existing?.refreshTokenEnc;

    if (!refreshTokenEnc) {
      this.logger.error(`No refresh token available for user ${userId} on first connect`);
      return { success: false, reason: 'Google did not return a refresh token' };
    }

    await this.prisma.oauthCredential.upsert({
      where: { userId_provider: { userId, provider: 'google' } },
      create: {
        userId,
        provider: 'google',
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc,
        scope: tokens.scope,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      },
      update: {
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc,
        scope: tokens.scope,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        revokedAt: null,
      },
    });

    return { success: true };
  }

  /**
   * Revoke and delete stored tokens.
   */
  async disconnect(userId: string) {
    await this.prisma.oauthCredential.updateMany({
      where: { userId, provider: 'google' },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Check if user has connected Google Calendar.
   */
  async isConnected(userId: string): Promise<boolean> {
    const cred = await this.prisma.oauthCredential.findFirst({
      where: { userId, provider: 'google', revokedAt: null },
    });
    return !!cred;
  }
}
