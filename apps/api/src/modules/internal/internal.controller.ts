import { Controller, Post, Get, Headers, UnauthorizedException, OnModuleInit, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { SlotsService } from '../slots/slots.service';
import { OutboxService } from '../outbox/outbox.service';
import { SlotGeneratorService } from '../availability/slot-generator.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// Called by the in-process 30s tick, not end users — CRON_SECRET already
// gates it; the global rate limiter would otherwise trip on its own traffic.
@SkipThrottle()
@Controller('internal')
export class InternalController implements OnModuleInit {
  private readonly logger = new Logger(InternalController.name);
  private lastSlotGenerationDate: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly slots: SlotsService,
    private readonly outbox: OutboxService,
    private readonly slotGenerator: SlotGeneratorService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    // Automatically trigger the tick every 30 seconds in the background.
    // This removes the need for an external cron job provider for processing the outbox.
    setInterval(() => {
      const cronSecret = this.config.get('CRON_SECRET', 'dev-cron-secret');
      this.tick(cronSecret).catch(err => this.logger.error('Background auto-tick failed', err));
    }, 30000);
  }

  /**
   * POST /internal/tick — called by Render Cron Job.
   * Sweeps expired holds, dispatches reminders, generates slots, processes outbox.
   */
  @Post('tick')
  async tick(
    @Headers('x-cron-secret') cronSecret?: string,
  ) {
    const expected = this.config.get('CRON_SECRET', 'dev-cron-secret');
    if (cronSecret !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }

    // Extend the rolling 60-day slot horizon once per calendar day (also
    // runs immediately on first-ever tick after a deploy). Generation is
    // idempotent, but running it on every 30s tick would be wasted DB load
    // for something that only needs to move forward once a day — availability
    // *changes* already trigger an immediate regeneration for that doctor
    // via AvailabilityService.setAvailability.
    const today = new Date().toISOString().slice(0, 10);
    let slotsGenerated = false;
    if (this.lastSlotGenerationDate !== today) {
      await this.slotGenerator.generateSlotsForAllDoctors();
      this.lastSlotGenerationDate = today;
      slotsGenerated = true;
    }

    const [sweptHolds, outboxProcessed] = await Promise.all([
      this.slots.sweepExpiredHolds(),
      this.outbox.processOutbox(),
    ]);

    // Dispatch medication reminders
    const overdueThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

    // Skip overdue reminders
    await this.prisma.$executeRaw`
      UPDATE medication_reminders
         SET status = 'skipped'
       WHERE status = 'pending'
         AND due_at < ${overdueThreshold}
    `;

    return {
      sweptHolds,
      outboxProcessed,
      slotsGenerated,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * POST /internal/generate-slots — trigger slot generation for all doctors.
   */
  @Post('generate-slots')
  async generateSlots(
    @Headers('x-cron-secret') cronSecret?: string,
  ) {
    const expected = this.config.get('CRON_SECRET', 'dev-cron-secret');
    if (cronSecret !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }

    await this.slotGenerator.generateSlotsForAllDoctors();
    return { success: true };
  }
}
