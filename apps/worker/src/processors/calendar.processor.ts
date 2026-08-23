import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from '@healthcare/contracts';
import {
  CalendarApiError,
  calendarEventId,
  deleteEvent,
  refreshAccessToken,
  upsertEvent,
} from '../google-calendar';

/**
 * Calendar sync processor — handles calendar.create and calendar.delete
 * outbox events. Two events per appointment, one per participant's own
 * calendar (§8: "Patient and doctor each authorise their own calendar").
 *
 * Never blocks booking: a participant who hasn't connected Google is
 * silently skipped (the .ics/email confirmation is the guaranteed floor),
 * and sync failures are recorded on calendar_links, not thrown back into
 * the booking flow — this job runs entirely after the booking committed.
 */
export function createCalendarProcessor(prisma: PrismaClient) {
  return async (job: Job) => {
    const { eventType, payload } = job.data;
    const { appointmentId, patientId, doctorId } = payload;

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        slot: true,
        patient: { include: { user: true } },
        doctor: { include: { user: true, specialisation: true } },
      },
    });
    if (!appointment) return;

    await Promise.all([
      syncParticipant(prisma, eventType, appointment, patientId, appointment.patient.user.timezone),
      syncParticipant(prisma, eventType, appointment, doctorId, appointment.doctor.user.timezone),
    ]);
  };
}

async function syncParticipant(
  prisma: PrismaClient,
  eventType: string,
  appointment: any,
  userId: string,
  timezone: string,
) {
  const cred = await prisma.oauthCredential.findUnique({
    where: { userId_provider: { userId, provider: 'google' } },
  });
  // Not connected — nothing to sync. Booking already succeeded; this
  // participant just doesn't get a Calendar entry (they got the .ics
  // attachment in their confirmation email instead).
  if (!cred || cred.revokedAt) return;

  const eventId = calendarEventId(appointment.id, userId);

  try {
    let accessToken = decryptSecret(cred.accessTokenEnc);
    const isExpired = !cred.expiresAt || cred.expiresAt.getTime() < Date.now() + 60_000;

    if (isExpired) {
      const refreshToken = decryptSecret(cred.refreshTokenEnc);
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      await prisma.oauthCredential.update({
        where: { id: cred.id },
        data: {
          accessTokenEnc: encryptSecret(accessToken),
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      });
    }

    if (eventType === 'calendar.delete') {
      await deleteEvent(accessToken, eventId);
      await prisma.calendarLink.upsert({
        where: { appointmentId_userId: { appointmentId: appointment.id, userId } },
        create: {
          appointmentId: appointment.id,
          userId,
          provider: 'google',
          externalEventId: eventId,
          syncState: 'deleted',
          lastSyncedAt: new Date(),
        },
        update: { syncState: 'deleted', lastSyncedAt: new Date() },
      });
      return;
    }

    const isPatient = userId === appointment.patientId;
    await upsertEvent(accessToken, eventId, {
      summary: isPatient
        ? `Appointment with Dr. ${appointment.doctor.user.fullName}`
        : `Appointment with ${appointment.patient.user.fullName}`,
      description: `Health Clinic appointment${appointment.doctor.specialisation ? ` — ${appointment.doctor.specialisation.name}` : ''}`,
      startIso: appointment.slot.startTs.toISOString(),
      endIso: appointment.slot.endTs.toISOString(),
      timeZone: timezone || 'Asia/Kolkata',
    });

    await prisma.calendarLink.upsert({
      where: { appointmentId_userId: { appointmentId: appointment.id, userId } },
      create: {
        appointmentId: appointment.id,
        userId,
        provider: 'google',
        externalEventId: eventId,
        calendarId: 'primary',
        syncState: 'synced',
        lastSyncedAt: new Date(),
      },
      update: {
        externalEventId: eventId,
        calendarId: 'primary',
        syncState: 'synced',
        lastSyncedAt: new Date(),
      },
    });
  } catch (error: any) {
    // §8 lifecycle mapping: 401 invalid_grant → revoke the credential and
    // stop retrying (nothing will fix it until the user reconnects).
    // Everything else is transient — rethrow so BullMQ's configured
    // attempts/backoff (set where calendar.sync jobs are enqueued) retries.
    const isInvalidGrant = error instanceof CalendarApiError && error.status === 401;

    await prisma.calendarLink.upsert({
      where: { appointmentId_userId: { appointmentId: appointment.id, userId } },
      create: {
        appointmentId: appointment.id,
        userId,
        provider: 'google',
        externalEventId: eventId,
        syncState: 'failed',
        lastSyncedAt: new Date(),
      },
      update: { syncState: 'failed', lastSyncedAt: new Date() },
    });

    if (isInvalidGrant) {
      await prisma.oauthCredential.update({
        where: { id: cred.id },
        data: { revokedAt: new Date() },
      });
      console.error(`Google Calendar token revoked for user ${userId} (invalid_grant) — needs reconnect`);
      return;
    }

    console.error(`Calendar sync failed for user ${userId}, appointment ${appointment.id}:`, error.message);
    throw error;
  }
}
