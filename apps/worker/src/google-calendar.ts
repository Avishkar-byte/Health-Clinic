import { createHash } from 'crypto';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Deterministic event ID per §8: "Using a deterministic one... means a
 * retried create returns 409 duplicate instead of producing a second
 * event." A sha1 hex digest only uses [0-9a-f], which already satisfies
 * Google's event ID charset ([a-v0-9]{5,1024}) without further encoding.
 */
export function calendarEventId(appointmentId: string, userId: string): string {
  return createHash('sha1').update(`${appointmentId}${userId}`).digest('hex');
}

export class CalendarApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new CalendarApiError(`Token refresh failed: ${await res.text()}`, res.status);
  }

  const json = (await res.json()) as any;
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  timeZone: string;
}

/**
 * Idempotent create-or-update. Google returns 409 if the deterministic
 * ID already exists — treat that as "patch instead" rather than a hard
 * failure (covers both retries and this being a re-run of the same job).
 */
export async function upsertEvent(
  accessToken: string,
  eventId: string,
  event: CalendarEventInput,
): Promise<'created' | 'updated'> {
  const body = {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.startIso, timeZone: event.timeZone },
    end: { dateTime: event.endIso, timeZone: event.timeZone },
  };

  const insertRes = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: eventId, ...body }),
  });

  if (insertRes.ok) return 'created';

  if (insertRes.status === 409) {
    const patchRes = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!patchRes.ok) {
      throw new CalendarApiError(`Calendar patch failed: ${await patchRes.text()}`, patchRes.status);
    }
    return 'updated';
  }

  throw new CalendarApiError(`Calendar insert failed: ${await insertRes.text()}`, insertRes.status);
}

/** 404/410 mean the event is already gone — treat as success per §8. */
export async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  const res = await fetch(`${CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new CalendarApiError(`Calendar delete failed: ${await res.text()}`, res.status);
  }
}
