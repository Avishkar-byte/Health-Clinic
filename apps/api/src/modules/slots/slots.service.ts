import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SlotUnavailableException } from '../../common/exceptions/problem.exceptions';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get available slots for a doctor in a date range.
   */
  async getSlots(doctorId: string, from?: string, to?: string) {
    const where: any = { doctorId };

    if (from || to) {
      where.startTs = {};
      if (from) where.startTs.gte = new Date(from);
      if (to) where.startTs.lte = new Date(to);
    } else {
      // Default: next 14 days
      const now = new Date();
      const twoWeeks = new Date();
      twoWeeks.setDate(twoWeeks.getDate() + 14);
      where.startTs = { gte: now, lte: twoWeeks };
    }

    const slots = await this.prisma.slot.findMany({
      where,
      orderBy: { startTs: 'asc' },
      select: {
        id: true,
        doctorId: true,
        startTs: true,
        endTs: true,
        status: true,
        holdExpiresAt: true,
      },
    });

    // Apply lazy expiry: held slots with expired holds show as available
    return slots.map((slot) => {
      if (
        slot.status === 'held' &&
        slot.holdExpiresAt &&
        slot.holdExpiresAt < new Date()
      ) {
        return { ...slot, status: 'available' as const, holdExpiresAt: null };
      }
      return slot;
    });
  }

  /**
   * Phase 1 — Acquire hold.
   *
   * UPDATE with lazy expiry: if a hold has expired, the slot is reclaimed
   * atomically. This means correctness never depends on the sweeper cron.
   *
   * Returns hold_token and expires_at, or throws 409 with 3 alternatives.
   */
  async holdSlot(slotId: string, patientId: string) {
    const holdToken = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // The critical query from §4.2 of the architecture doc
    const result = await this.prisma.$executeRaw`
      UPDATE slots
         SET status = 'held',
             hold_token = ${holdToken}::uuid,
             hold_expires_at = ${expiresAt},
             held_by_patient_id = ${patientId}::uuid,
             version = version + 1
       WHERE id = ${slotId}::uuid
         AND start_ts > now() + interval '30 minutes'
         AND (
              status = 'available'
              OR (status = 'held' AND hold_expires_at < now())
             )
         AND NOT EXISTS (
              SELECT 1 FROM doctor_leaves l
               WHERE l.doctor_id = slots.doctor_id
                 AND l.start_ts <= slots.start_ts
                 AND l.end_ts > slots.start_ts
             )
    `;

    if (result === 0) {
      // Slot is unavailable — find 3 alternatives
      const slot = await this.prisma.slot.findUnique({
        where: { id: slotId },
        select: { doctorId: true, startTs: true },
      });

      const alternatives = slot
        ? await this.prisma.slot.findMany({
            where: {
              doctorId: slot.doctorId,
              status: 'available',
              startTs: { gt: new Date() },
            },
            orderBy: { startTs: 'asc' },
            take: 3,
            select: {
              id: true,
              startTs: true,
              endTs: true,
              status: true,
            },
          })
        : [];

      throw new SlotUnavailableException(alternatives);
    }

    // Fetch the updated slot
    const updatedSlot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        doctorId: true,
        startTs: true,
        endTs: true,
        status: true,
        holdExpiresAt: true,
      },
    });

    return {
      slotId,
      holdToken,
      expiresAt: expiresAt.toISOString(),
      slot: updatedSlot,
    };
  }

  /**
   * Explicit hold release.
   */
  async releaseHold(holdToken: string) {
    const result = await this.prisma.$executeRaw`
      UPDATE slots
         SET status = 'available',
             hold_token = NULL,
             hold_expires_at = NULL,
             held_by_patient_id = NULL,
             version = version + 1
       WHERE hold_token = ${holdToken}::uuid
         AND status = 'held'
    `;

    return { released: result > 0 };
  }

  /**
   * Sweep expired holds — called by the cron job.
   * Correctness doesn't depend on this running (lazy expiry handles it),
   * but it keeps the availability view clean.
   */
  async sweepExpiredHolds(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE slots
         SET status = 'available',
             hold_token = NULL,
             hold_expires_at = NULL,
             held_by_patient_id = NULL,
             version = version + 1
       WHERE status = 'held'
         AND hold_expires_at < now()
    `;

    if (result > 0) {
      this.logger.log(`Swept ${result} expired holds`);
    }

    return result;
  }
}
