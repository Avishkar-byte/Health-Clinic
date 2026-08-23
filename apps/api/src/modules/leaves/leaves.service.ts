import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateLeaveDto } from '@healthcare/contracts';
import { createHash } from 'crypto';

/**
 * Doctor leave + cascade cancellation.
 *
 * This is the one operation that mutates already-confirmed state.
 * It runs as a single serialised transaction per §5 of the architecture doc.
 *
 * The race it closes: patient A confirms a booking at the exact millisecond
 * the admin marks leave. SELECT ... FOR UPDATE on all slots in range
 * serialises this against in-flight bookings.
 */
@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Preview the blast radius before creating leave.
   * Shows how many appointments will be cancelled.
   */
  async previewLeave(doctorId: string, startTs: string, endTs: string) {
    const affected = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: 'scheduled',
        slot: {
          startTs: { gte: new Date(startTs) },
          endTs: { lte: new Date(endTs) },
        },
      },
      include: {
        slot: true,
        patient: {
          include: { user: { select: { fullName: true } } },
        },
      },
    });

    return {
      cancelledAppointments: affected.length,
      affectedPatients: affected.map((a) => ({
        patientName: a.patient?.user?.fullName ?? 'Unknown',
        appointmentTime: a.slot.startTs.toISOString(),
        appointmentId: a.id,
      })),
    };
  }

  /**
   * Create doctor leave with cascade cancellation.
   *
   * Single serialised transaction:
   * 1. SELECT ... FOR UPDATE on all slots in range (blocks in-flight bookings)
   * 2. INSERT doctor_leaves
   * 3. UPDATE slots → blocked (available/held)
   * 4. Find affected appointments (status='scheduled')
   * 5. Cancel affected appointments
   * 6. Insert outbox events for notifications
   */
  async createLeave(doctorId: string, dto: CreateLeaveDto, createdBy: string) {
    const startTs = new Date(dto.startTs);
    const endTs = new Date(dto.endTs);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Lock all slots in the range — blocks in-flight holds/bookings
      const lockedSlots: any[] = await tx.$queryRaw`
        SELECT * FROM slots
         WHERE doctor_id = ${doctorId}::uuid
           AND start_ts >= ${startTs}
           AND start_ts < ${endTs}
         FOR UPDATE
      `;

      // 2. Insert leave record
      const leave = await tx.doctorLeave.create({
        data: {
          doctorId,
          startTs,
          endTs,
          reason: dto.reason,
          createdBy,
        },
      });

      // 3. Block all non-booked slots in range
      const freeOrHeldIds = lockedSlots
        .filter((s: any) => s.status === 'available' || s.status === 'held')
        .map((s: any) => s.id);

      if (freeOrHeldIds.length > 0) {
        await tx.$executeRaw`
          UPDATE slots
             SET status = 'blocked',
                 hold_token = NULL,
                 hold_expires_at = NULL,
                 held_by_patient_id = NULL,
                 version = version + 1
           WHERE id = ANY(${freeOrHeldIds}::uuid[])
        `;
      }

      // 4. Find affected appointments (booked slots in range)
      const bookedSlotIds = lockedSlots
        .filter((s: any) => s.status === 'booked')
        .map((s: any) => s.id);

      let cancelledAppointments: any[] = [];

      if (bookedSlotIds.length > 0) {
        cancelledAppointments = await tx.appointment.findMany({
          where: {
            slotId: { in: bookedSlotIds },
            status: 'scheduled',
          },
          include: {
            slot: true,
            symptomSubmission: true,
            aiSummaries: true,
          },
        });

        // 5. Cancel affected appointments
        if (cancelledAppointments.length > 0) {
          const cancelledIds = cancelledAppointments.map((a: any) => a.id);

          await tx.appointment.updateMany({
            where: { id: { in: cancelledIds } },
            data: {
              status: 'cancelled_by_clinic',
              cancellationReason: 'doctor_leave',
              cancelledAt: new Date(),
            },
          });

          // Block the booked slots too
          await tx.$executeRaw`
            UPDATE slots
               SET status = 'blocked',
                   version = version + 1
             WHERE id = ANY(${bookedSlotIds}::uuid[])
          `;

          // 6. Insert outbox events for each affected appointment
          for (const appt of cancelledAppointments) {
            // Patient cancellation email
            const patientDedupeKey = createHash('sha256')
              .update(`${appt.id}:leave_cancellation:patient`)
              .digest('hex');

            await tx.notification.create({
              data: {
                appointmentId: appt.id,
                recipientUserId: appt.patientId,
                channel: 'email',
                templateKey: 'appointment_cancelled_leave',
                dedupeKey: patientDedupeKey,
                payload: {
                  appointmentId: appt.id,
                  reason: 'doctor_leave',
                  doctorId,
                  slotStartTs: appt.slot.startTs.toISOString(),
                },
              },
            });

            // Outbox events for email + calendar deletion
            await tx.outbox.create({
              data: {
                aggregateType: 'appointment',
                aggregateId: appt.id,
                eventType: 'appointment.cancelled_by_clinic',
                payload: {
                  appointmentId: appt.id,
                  patientId: appt.patientId,
                  doctorId,
                  reason: 'doctor_leave',
                },
              },
            });

            await tx.outbox.create({
              data: {
                aggregateType: 'calendar',
                aggregateId: appt.id,
                eventType: 'calendar.delete',
                payload: {
                  appointmentId: appt.id,
                  patientId: appt.patientId,
                  doctorId,
                },
              },
            });
          }

          // Doctor digest notification
          const doctorDedupeKey = createHash('sha256')
            .update(`${leave.id}:leave_digest:doctor`)
            .digest('hex');

          await tx.notification.create({
            data: {
              recipientUserId: doctorId,
              channel: 'email',
              templateKey: 'leave_cancellation_digest',
              dedupeKey: doctorDedupeKey,
              payload: {
                leaveId: leave.id,
                cancelledCount: cancelledAppointments.length,
                startTs: startTs.toISOString(),
                endTs: endTs.toISOString(),
              },
            },
          });
        }
      }

      return {
        leave,
        cancelledAppointments: cancelledAppointments.length,
        blockedSlots: freeOrHeldIds.length + bookedSlotIds.length,
      };
    });

    this.logger.log(
      `Leave created for doctor ${doctorId}: ${result.cancelledAppointments} appointments cancelled, ${result.blockedSlots} slots blocked`,
    );

    return result;
  }

  /**
   * Delete leave — unblock slots.
   */
  async deleteLeave(leaveId: string) {
    const leave = await this.prisma.doctorLeave.findUnique({
      where: { id: leaveId },
    });

    if (!leave) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Leave not found' });
    }

    await this.prisma.$transaction(async (tx) => {
      // Unblock slots that are in the leave range
      await tx.$executeRaw`
        UPDATE slots
           SET status = 'available',
               version = version + 1
         WHERE doctor_id = ${leave.doctorId}::uuid
           AND start_ts >= ${leave.startTs}
           AND start_ts < ${leave.endTs}
           AND status = 'blocked'
      `;

      await tx.doctorLeave.delete({ where: { id: leaveId } });
    });

    return { success: true };
  }

  /**
   * Get all leaves for a doctor.
   */
  async getDoctorLeaves(doctorId: string) {
    return this.prisma.doctorLeave.findMany({
      where: {
        doctorId,
        endTs: { gte: new Date() },
      },
      orderBy: { startTs: 'asc' },
    });
  }
}
