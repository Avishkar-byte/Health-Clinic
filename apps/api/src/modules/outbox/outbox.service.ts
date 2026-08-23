import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

/**
 * Transactional outbox relay.
 *
 * Polls outbox WHERE published_at IS NULL with FOR UPDATE SKIP LOCKED,
 * enqueues to BullMQ, and marks rows published.
 *
 * This ensures at-least-once delivery. The dedupe_key on notifications
 * makes at-least-once safe.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private queues: Map<string, Queue> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    if (this.redis) {
      this.queues.set('email.send', new Queue('email.send', { connection: this.redis }));
      this.queues.set('llm.previsit', new Queue('llm.previsit', { connection: this.redis }));
      this.queues.set('llm.postvisit', new Queue('llm.postvisit', { connection: this.redis }));
      this.queues.set('calendar.sync', new Queue('calendar.sync', { connection: this.redis }));
    }
  }

  /**
   * Process unpublished outbox events.
   * Called by the cron tick or scheduled interval.
   */
  async processOutbox(): Promise<number> {
    if (!this.redis) {
      this.logger.warn('Redis not available — outbox relay paused');
      return 0;
    }

    // Poll with FOR UPDATE SKIP LOCKED for parallel-safe processing
    const events: any[] = await this.prisma.$queryRaw`
      SELECT id, aggregate_type, aggregate_id, event_type, payload
        FROM outbox
       WHERE published_at IS NULL
       ORDER BY id
       LIMIT 100
       FOR UPDATE SKIP LOCKED
    `;

    if (events.length === 0) return 0;

    for (const event of events) {
      const queueName = this.mapEventToQueue(event.event_type);
      const queue = this.queues.get(queueName);

      if (queue) {
        // Calendar sync is the one queue whose processor doesn't manage
        // its own internal retry loop (unlike LLM/email) — it rethrows on
        // transient failure and relies on BullMQ's retry per §8's "Retry
        // ×5" policy.
        const jobOptions =
          queueName === 'calendar.sync'
            ? { attempts: 5, backoff: { type: 'exponential' as const, delay: 2000 } }
            : undefined;

        await queue.add(
          event.event_type,
          {
            outboxId: event.id,
            eventType: event.event_type,
            aggregateType: event.aggregate_type,
            aggregateId: event.aggregate_id,
            payload: event.payload,
          },
          jobOptions,
        );
      }

      // Mark as published
      await this.prisma.$executeRaw`
        UPDATE outbox SET published_at = now() WHERE id = ${event.id}::uuid
      `;
    }

    this.logger.log(`Processed ${events.length} outbox events`);
    return events.length;
  }

  private mapEventToQueue(eventType: string): string {
    if (eventType.startsWith('llm.previsit') || eventType === 'appointment.booked') {
      return 'llm.previsit';
    }
    if (eventType.startsWith('llm.postvisit') || eventType === 'notes.submitted') {
      return 'llm.postvisit';
    }
    if (eventType.startsWith('calendar.')) {
      return 'calendar.sync';
    }
    return 'email.send';
  }
}
