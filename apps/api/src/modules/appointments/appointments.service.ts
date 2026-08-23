import { Injectable, Logger, NotFoundException, BadRequestException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  HoldExpiredException,
  IdempotencyConflictException,
  SlotConflictException,
} from '../../common/exceptions/problem.exceptions';
import type { CreateAppointmentDto } from '@healthcare/contracts';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 2 — Confirm booking.
   *
   * All inside one transaction:
   * 1. UPDATE slot (consume hold_token, verify not expired)
   * 2. INSERT appointment
   * 3. INSERT symptom_submission
   * 4. INSERT ai_summaries (pre_visit, status=pending)
   * 5. INSERT outbox events
   *
   * Idempotency-Key: replaying a key returns the original response.
   */
  async createAppointment(
    dto: CreateAppointmentDto,
    patientId: string,
    idempotencyKey: string,
  ) {
    // Check idempotency key — if already processed, return the original response
    const existingAppointment = await this.prisma.appointment.findUnique({
      where: { idempotencyKey },
      include: {
        slot: true,
        symptomSubmission: true,
      },
    });

    if (existingAppointment) {
      // Verify it was the same patient (not an idempotency key collision)
      if (existingAppointment.patientId !== patientId) {
        throw new IdempotencyConflictException();
      }
      return this.formatAppointment(existingAppointment);
    }

    // Execute the booking transaction
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Consume the hold — verify token and expiry, and get back the
        //    exact slot row that was just consumed (not just "a" slot the
        //    patient happens to have booked — that was ambiguous once a
        //    patient had more than one booking, see commit message).
        const [slot] = await tx.$queryRaw<
          Array<{ id: string; doctor_id: string; start_ts: Date; end_ts: Date }>
        >`
          UPDATE slots
             SET status = 'booked',
                 hold_token = NULL,
                 hold_expires_at = NULL,
                 held_by_patient_id = NULL,
                 version = version + 1
           WHERE hold_token = ${dto.holdToken}::uuid
             AND status = 'held'
             AND hold_expires_at > now()
          RETURNING id, doctor_id, start_ts, end_ts
        `;

        if (!slot) {
          throw new HoldExpiredException();
        }

        const appointmentId = uuidv4();

        // 2. Insert appointment
        const appointment = await tx.appointment.create({
          data: {
            id: appointmentId,
            slotId: slot.id,
            patientId,
            doctorId: slot.doctor_id,
            status: 'scheduled',
            idempotencyKey,
          },
        });

        // 3. Insert symptom submission
        await tx.symptomSubmission.create({
          data: {
            appointmentId,
            rawSymptoms: dto.symptoms.rawSymptoms,
            durationDays: dto.symptoms.durationDays,
            severity: dto.symptoms.severity,
            existingConditions: dto.symptoms.existingConditions,
            currentMedications: dto.symptoms.currentMedications,
            additionalNotes: dto.symptoms.additionalNotes,
          },
        });

        // 4. Insert pending pre-visit AI summary
        await tx.aiSummary.create({
          data: {
            appointmentId,
            kind: 'pre_visit',
            status: 'pending',
          },
        });

        // 5. Insert outbox events
        const dedupeBase = `${appointmentId}:appointment.booked`;

        // Event for patient confirmation email
        await tx.outbox.create({
          data: {
            aggregateType: 'appointment',
            aggregateId: appointmentId,
            eventType: 'appointment.booked',
            payload: {
              appointmentId,
              patientId,
              doctorId: slot.doctor_id,
              slotStartTs: slot.start_ts.toISOString(),
              slotEndTs: slot.end_ts.toISOString(),
            },
          },
        });

        // Calendar sync event — one job syncs both participants' own
        // calendars (skipped per-participant if they haven't connected).
        await tx.outbox.create({
          data: {
            aggregateType: 'calendar',
            aggregateId: appointmentId,
            eventType: 'calendar.create',
            payload: {
              appointmentId,
              patientId,
              doctorId: slot.doctor_id,
            },
          },
        });

        // Notification row with deduplication
        const patientDedupeKey = createHash('sha256')
          .update(`${appointmentId}:booking_confirmed:patient`)
          .digest('hex');

        await tx.notification.create({
          data: {
            appointmentId,
            recipientUserId: patientId,
            channel: 'email',
            templateKey: 'booking_confirmed',
            dedupeKey: patientDedupeKey,
            payload: {
              appointmentId,
              slotStartTs: slot.start_ts.toISOString(),
              slotEndTs: slot.end_ts.toISOString(),
            },
          },
        });

        // Notification for doctor
        const doctorDedupeKey = createHash('sha256')
          .update(`${appointmentId}:new_appointment:doctor`)
          .digest('hex');

        await tx.notification.create({
          data: {
            appointmentId,
            recipientUserId: slot.doctor_id,
            channel: 'email',
            templateKey: 'new_appointment',
            dedupeKey: doctorDedupeKey,
            payload: {
              appointmentId,
              slotStartTs: slot.start_ts.toISOString(),
              slotEndTs: slot.end_ts.toISOString(),
            },
          },
        });

        return tx.appointment.findUnique({
          where: { id: appointmentId },
          include: {
            slot: true,
            symptomSubmission: true,
          },
        });
      }, { timeout: 20000 });

      return this.formatAppointment(result);
    } catch (error: any) {
      this.logger.error('Booking failed', error.stack || error.message);
      if (error instanceof HttpException) throw error;

      // Known Prisma conflict — someone else booked this slot in the
      // narrow window between the hold check and the insert. Not a bug,
      // just a real race; tell the patient plainly instead of leaking
      // the raw constraint-violation message.
      if (error.code === 'P2002') {
        throw new SlotConflictException();
      }

      throw new BadRequestException({
        code: 'BOOKING_FAILED',
        title: 'Could not confirm booking',
        detail: 'Something went wrong while confirming your booking. Please try again.',
      });
    }
  }

  /**
   * Get appointments — scoped by JWT role.
   */
  async getAppointments(userId: string, role: string, status?: string) {
    const where: any = {};

    if (role === 'patient') {
      where.patientId = userId;
    } else if (role === 'doctor') {
      where.doctorId = userId;
    }
    // admin sees all

    if (status) {
      where.status = status;
    }

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: {
        slot: true,
        patient: { include: { user: { select: { fullName: true, email: true } } } },
        doctor: { include: { user: { select: { fullName: true } }, specialisation: true } },
        symptomSubmission: true,
        aiSummaries: true,
      },
      orderBy: { slot: { startTs: 'desc' } },
    });

    return appointments.map(this.formatAppointmentFull);
  }

  /**
   * Get a single appointment by ID — with ownership check.
   */
  async getAppointmentById(appointmentId: string, userId: string, role: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        slot: true,
        patient: { include: { user: { select: { fullName: true, email: true } } } },
        doctor: { include: { user: { select: { fullName: true } }, specialisation: true } },
        symptomSubmission: true,
        aiSummaries: true,
        visitNote: true,
        prescription: { include: { items: true } },
      },
    });

    if (!appointment) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Appointment not found',
      });
    }

    // Resource-level ownership check per §11
    if (role === 'patient' && appointment.patientId !== userId) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }
    if (role === 'doctor' && appointment.doctorId !== userId) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }

    return this.formatAppointmentFull(appointment);
  }

  /**
   * Cancel an appointment — release the slot, insert outbox events.
   */
  async cancelAppointment(appointmentId: string, userId: string, role: string, reason?: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { slot: true },
    });

    if (!appointment) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }

    if (appointment.status !== 'scheduled') {
      throw new BadRequestException({
        code: 'INVALID_STATE',
        title: 'Cannot cancel',
        detail: 'Only scheduled appointments can be cancelled.',
      });
    }

    // Ownership check
    if (role === 'patient' && appointment.patientId !== userId) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }

    const cancelStatus = role === 'patient' ? 'cancelled_by_patient' : 'cancelled_by_clinic';

    await this.prisma.$transaction(async (tx) => {
      // Release the slot
      await tx.slot.update({
        where: { id: appointment.slotId },
        data: {
          status: 'available',
          holdToken: null,
          holdExpiresAt: null,
          heldByPatientId: null,
          version: { increment: 1 },
        },
      });

      // Update appointment
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: cancelStatus as any,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });

      // Outbox event
      await tx.outbox.create({
        data: {
          aggregateType: 'appointment',
          aggregateId: appointmentId,
          eventType: `appointment.${cancelStatus}`,
          payload: {
            appointmentId,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            reason,
          },
        },
      });

      // Remove the calendar event from both participants' own calendars.
      await tx.outbox.create({
        data: {
          aggregateType: 'calendar',
          aggregateId: appointmentId,
          eventType: 'calendar.delete',
          payload: {
            appointmentId,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
          },
        },
      });

      // Patient notification
      const patientDedupeKey = createHash('sha256')
        .update(`${appointmentId}:cancellation:patient`)
        .digest('hex');
      await tx.notification.create({
        data: {
          appointmentId,
          recipientUserId: appointment.patientId,
          channel: 'email',
          templateKey: role === 'patient' ? 'cancellation_acknowledged' : 'appointment_cancelled',
          dedupeKey: patientDedupeKey,
          payload: { appointmentId, reason },
        },
      });

      // Doctor notification
      const doctorDedupeKey = createHash('sha256')
        .update(`${appointmentId}:cancellation:doctor`)
        .digest('hex');
      await tx.notification.create({
        data: {
          appointmentId,
          recipientUserId: appointment.doctorId,
          channel: 'email',
          templateKey: 'slot_freed',
          dedupeKey: doctorDedupeKey,
          payload: { appointmentId, reason },
        },
      });
    }, { timeout: 20000 });

    return { success: true, status: cancelStatus };
  }

  private formatAppointment(appt: any) {
    if (!appt) return null;
    return {
      id: appt.id,
      slotId: appt.slotId,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      status: appt.status,
      bookedAt: appt.bookedAt,
      startTs: appt.slot?.startTs,
      endTs: appt.slot?.endTs,
      idempotencyKey: appt.idempotencyKey,
    };
  }

  private formatAppointmentFull(appt: any) {
    if (!appt) return null;
    return {
      id: appt.id,
      slotId: appt.slotId,
      status: appt.status,
      bookedAt: appt.bookedAt,
      cancelledAt: appt.cancelledAt,
      cancellationReason: appt.cancellationReason,
      startTs: appt.slot?.startTs,
      endTs: appt.slot?.endTs,
      patient: appt.patient
        ? {
            id: appt.patientId,
            name: appt.patient.user?.fullName,
            email: appt.patient.user?.email,
          }
        : undefined,
      doctor: appt.doctor
        ? {
            id: appt.doctorId,
            name: appt.doctor.user?.fullName,
            specialisation: appt.doctor.specialisation?.name,
          }
        : undefined,
      symptoms: appt.symptomSubmission
        ? {
            rawSymptoms: appt.symptomSubmission.rawSymptoms,
            durationDays: appt.symptomSubmission.durationDays,
            severity: appt.symptomSubmission.severity,
            existingConditions: appt.symptomSubmission.existingConditions,
            currentMedications: appt.symptomSubmission.currentMedications,
          }
        : undefined,
      aiSummaries: appt.aiSummaries?.map((s: any) => ({
        kind: s.kind,
        status: s.status,
        urgency: s.urgency,
        chiefComplaint: s.chiefComplaint,
        suggestedQuestions: s.suggestedQuestions,
        patientSummary: s.patientSummary,
      })),
      visitNote: appt.visitNote
        ? {
            clinicalNotes: appt.visitNote.clinicalNotes,
            diagnosis: appt.visitNote.diagnosis,
            followUpDate: appt.visitNote.followUpDate,
          }
        : undefined,
      prescription: appt.prescription
        ? {
            items: appt.prescription.items,
            issuedAt: appt.prescription.issuedAt,
          }
        : undefined,
    };
  }
}
