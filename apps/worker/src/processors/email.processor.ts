import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';

/**
 * Email processor with retry policy from §7.2:
 * Transient (429, 500, socket timeout) → Retry at 1m → 5m → 15m → 1h → 6h
 * Hard bounce (550) → Mark dead immediately
 * Config error (bad API key) → Mark dead, retrying won't help
 */
export function createEmailProcessor(prisma: PrismaClient) {
  // Create transport — provider-agnostic via SMTP env vars
  const transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    : null;

  if (!transport) {
    console.warn('SMTP not configured — emails will be logged to console');
  }

  return async (job: Job) => {
    const { eventType, payload } = job.data;

    // Find queued notifications related to this event
    const notifications = await prisma.notification.findMany({
      where: {
        status: 'queued',
        appointmentId: payload.appointmentId || undefined,
      },
      include: {
        recipient: { select: { email: true, fullName: true } },
      },
      take: 10,
    });

    for (const notification of notifications) {
      try {
        const emailContent = renderEmailTemplate(
          notification.templateKey,
          notification.payload as Record<string, unknown>,
          notification.recipient?.fullName || 'Patient',
        );

        if (transport) {
          await transport.sendMail({
            from: `"${process.env.SMTP_FROM_NAME || 'Health Clinic'}" <${process.env.SMTP_FROM || 'clinic@example.com'}>`,
            to: notification.recipient?.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
        } else {
          // Console fallback for development
          console.log(`[EMAIL] To: ${notification.recipient?.email}`);
          console.log(`[EMAIL] Subject: ${emailContent.subject}`);
          console.log(`[EMAIL] Template: ${notification.templateKey}`);
        }

        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'sent',
            attemptCount: { increment: 1 },
          },
        });
      } catch (error: any) {
        const attemptCount = notification.attemptCount + 1;

        // Hard bounce — mark dead
        if (error.responseCode >= 550 || error.responseCode === 553) {
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: 'dead',
              attemptCount,
              lastError: error.message,
            },
          });
          continue;
        }

        // Retry schedule: 1m, 5m, 15m, 1h, 6h
        const retryDelays = [60, 300, 900, 3600, 21600]; // seconds
        const nextDelay = retryDelays[attemptCount - 1];

        if (nextDelay && attemptCount < 5) {
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: 'failed',
              attemptCount,
              lastError: error.message,
              nextRetryAt: new Date(Date.now() + nextDelay * 1000),
            },
          });
        } else {
          // Max retries — mark dead
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: 'dead',
              attemptCount,
              lastError: error.message,
            },
          });
        }
      }
    }
  };
}

/**
 * Simple email template renderer.
 */
function renderEmailTemplate(
  templateKey: string,
  payload: Record<string, unknown>,
  recipientName: string,
): { subject: string; html: string } {
  const templates: Record<string, { subject: string; body: string }> = {
    booking_confirmed: {
      subject: 'Your appointment is confirmed',
      body: `<p>Hi ${recipientName},</p>
        <p>Your appointment has been confirmed for <strong>${payload.slotStartTs}</strong>.</p>
        <p>Please arrive 10 minutes early.</p>`,
    },
    new_appointment: {
      subject: 'New appointment scheduled',
      body: `<p>Hi Dr.,</p>
        <p>A new appointment has been booked at <strong>${payload.slotStartTs}</strong>.</p>`,
    },
    appointment_cancelled_leave: {
      subject: 'Your appointment has been rescheduled',
      body: `<p>Hi ${recipientName},</p>
        <p>We're sorry — your doctor has marked leave and your appointment has been cancelled.</p>
        <p>Please rebook at your earliest convenience.</p>`,
    },
    cancellation_acknowledged: {
      subject: 'Appointment cancellation confirmed',
      body: `<p>Hi ${recipientName},</p>
        <p>Your appointment has been cancelled as requested.</p>`,
    },
    slot_freed: {
      subject: 'Appointment slot freed',
      body: `<p>A patient has cancelled their appointment. The slot is now available.</p>`,
    },
    post_visit_ready: {
      subject: 'Your visit summary is ready',
      body: `<p>Hi ${recipientName},</p>
        <p>Your visit summary and prescription details are now available in your portal.</p>`,
    },
    leave_cancellation_digest: {
      subject: 'Leave cancellation summary',
      body: `<p>Your leave has been processed. ${payload.cancelledCount} appointments were cancelled and patients notified.</p>`,
    },
    medication_reminder: {
      subject: 'Medication reminder',
      body: `<p>Hi ${recipientName},</p>
        <p>It's time to take your medication: <strong>${payload.drugName}</strong> (${payload.doseText}).</p>`,
    },
  };

  const template = templates[templateKey] || {
    subject: 'Notification from Health Clinic',
    body: `<p>Hi ${recipientName}, you have a new notification.</p>`,
  };

  return {
    subject: template.subject,
    html: template.body,
  };
}
