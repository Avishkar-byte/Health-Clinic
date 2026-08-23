import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Batch size for createMany — keeps well under Postgres's bind-param limit
 * while cutting round-trips from one-per-slot to one-per-few-hundred. */
const INSERT_CHUNK_SIZE = 500;

/**
 * Materialises slots for a rolling 60-day horizon from doctor_availability.
 * Generation is idempotent — ON CONFLICT (doctor_id, start_ts) DO NOTHING.
 *
 * This is the foundation of the double-booking prevention design.
 * Slots are physical rows, not computed ranges.
 */
@Injectable()
export class SlotGeneratorService {
  private readonly logger = new Logger(SlotGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate slots for a specific doctor over the next 60 days.
   */
  async generateSlotsForDoctor(doctorId: string): Promise<number> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: doctorId },
    });

    if (!doctor) {
      this.logger.warn(`Doctor ${doctorId} not found, skipping slot generation`);
      return 0;
    }

    const availability = await this.prisma.doctorAvailability.findMany({
      where: {
        doctorId,
        OR: [
          { validTo: null },
          { validTo: { gte: new Date() } },
        ],
      },
    });

    if (availability.length === 0) {
      this.logger.log(`No availability for doctor ${doctorId}`);
      return 0;
    }

    // Get existing leaves to skip
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);

    const leaves = await this.prisma.doctorLeave.findMany({
      where: {
        doctorId,
        startTs: { lte: horizon },
        endTs: { gte: now },
      },
    });

    const slotDuration = doctor.slotDurationMin;
    const buffer = doctor.bufferMin;

    // Build every candidate slot in memory first — no DB calls in this loop.
    // Generating a full 60-day horizon can mean thousands of slots; doing
    // one awaited round-trip per slot (the original approach) took minutes
    // against a pooled connection. A single batched createMany is orders of
    // magnitude faster.
    const candidates: { startTs: Date; endTs: Date }[] = [];

    // Generate slots for each day in the 60-day horizon
    for (let dayOffset = 0; dayOffset <= 60; dayOffset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + dayOffset);
      date.setHours(0, 0, 0, 0);

      const weekday = date.getDay(); // 0=Sun..6=Sat

      // Find matching availability for this weekday
      const dayAvailability = availability.filter((a) => {
        if (a.weekday !== weekday) return false;
        const validFrom = new Date(a.validFrom);
        if (date < validFrom) return false;
        if (a.validTo) {
          const validTo = new Date(a.validTo);
          if (date > validTo) return false;
        }
        return true;
      });

      for (const avail of dayAvailability) {
        const [startHour, startMin] = avail.startTime.split(':').map(Number);
        const [endHour, endMin] = avail.endTime.split(':').map(Number);

        // Generate slots within this availability window
        let currentMinutes = (startHour ?? 0) * 60 + (startMin ?? 0);
        const endMinutes = (endHour ?? 0) * 60 + (endMin ?? 0);

        while (currentMinutes + slotDuration <= endMinutes) {
          const slotStart = new Date(date);
          slotStart.setHours(Math.floor(currentMinutes / 60), currentMinutes % 60, 0, 0);

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

          // Skip if slot is in the past
          if (slotStart <= now) {
            currentMinutes += slotDuration + buffer;
            continue;
          }

          // Skip if slot overlaps with any leave
          const isOnLeave = leaves.some(
            (l) => slotStart >= l.startTs && slotStart < l.endTs,
          );

          if (!isOnLeave) {
            candidates.push({ startTs: slotStart, endTs: slotEnd });
          }

          currentMinutes += slotDuration + buffer;
        }
      }
    }

    if (candidates.length === 0) return 0;

    // skipDuplicates relies on the same UNIQUE(doctor_id, start_ts)
    // constraint that made the old row-by-row ON CONFLICT DO NOTHING
    // idempotent — same guarantee, just batched.
    let insertedCount = 0;
    for (let i = 0; i < candidates.length; i += INSERT_CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + INSERT_CHUNK_SIZE);
      const result = await this.prisma.slot.createMany({
        data: chunk.map((c) => ({
          doctorId,
          startTs: c.startTs,
          endTs: c.endTs,
          status: 'available',
          version: 0,
        })),
        skipDuplicates: true,
      });
      insertedCount += result.count;
    }

    this.logger.log(
      `Generated ${insertedCount} new slots for doctor ${doctorId} (${candidates.length} candidates, ${candidates.length - insertedCount} already existed)`,
    );
    return insertedCount;
  }

  /**
   * Generate slots for all active doctors.
   * Called by the nightly cron job.
   */
  async generateSlotsForAllDoctors(): Promise<void> {
    const doctors = await this.prisma.doctor.findMany({
      where: { isAcceptingBookings: true },
      select: { userId: true },
    });

    for (const doctor of doctors) {
      await this.generateSlotsForDoctor(doctor.userId);
    }

    this.logger.log(`Slot generation complete for ${doctors.length} doctors`);
  }
}
