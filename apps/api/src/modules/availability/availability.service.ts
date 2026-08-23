import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { SetAvailabilityDto } from '@healthcare/contracts';
import { SlotGeneratorService } from './slot-generator.service';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slotGenerator: SlotGeneratorService,
  ) {}

  async setAvailability(doctorId: string, dto: SetAvailabilityDto) {
    // Delete existing future availability and replace
    await this.prisma.$transaction(async (tx) => {
      // Soft-invalidate: set valid_to on existing records. Prisma rejects a
      // bare "YYYY-MM-DD" string for a DateTime/@db.Date field ("premature
      // end of input. Expected ISO-8601 DateTime") — pass a real Date.
      await tx.doctorAvailability.updateMany({
        where: {
          doctorId,
          validTo: null,
        },
        data: {
          validTo: new Date(),
        },
      });

      // Insert new availability records. slot.validFrom/validTo come in as
      // "YYYY-MM-DD" strings from the DTO — same conversion needed here.
      for (const slot of dto.slots) {
        await tx.doctorAvailability.create({
          data: {
            doctorId,
            weekday: slot.weekday,
            startTime: slot.startTime,
            endTime: slot.endTime,
            validFrom: new Date(slot.validFrom),
            validTo: slot.validTo ? new Date(slot.validTo) : null,
          },
        });
      }
    });

    // Trigger slot regeneration
    await this.slotGenerator.generateSlotsForDoctor(doctorId);

    return { success: true };
  }

  async getAvailability(doctorId: string) {
    return this.prisma.doctorAvailability.findMany({
      where: {
        doctorId,
        OR: [
          { validTo: null },
          { validTo: { gte: new Date() } },
        ],
      },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
  }
}
