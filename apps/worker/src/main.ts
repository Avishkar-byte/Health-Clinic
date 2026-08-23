import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Worker } from 'bullmq';
import { createLlmPrevisitProcessor } from './processors/llm-previsit.processor';
import { createLlmPostvisitProcessor } from './processors/llm-postvisit.processor';
import { createEmailProcessor } from './processors/email.processor';
import { createCalendarProcessor } from './processors/calendar.processor';

async function main() {
  console.log('Worker starting...');

  const prisma = new PrismaClient();
  await prisma.$connect();

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('REDIS_URL is required for the worker');
    process.exit(1);
  }
  if (redisUrl.startsWith('http://') || redisUrl.startsWith('https://')) {
    console.error(
      `REDIS_URL is set to a REST URL (${redisUrl}). ioredis/BullMQ need the ` +
        `TCP connection string instead (starts with redis:// or rediss://) — ` +
        `in Upstash, copy the "ioredis" / "Node" connection string, not the REST URL.`,
    );
    process.exit(1);
  }

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  redis.on('error', (err) => {
    console.error('Worker Redis connection error:', err.message);
  });

  const connection = { connection: redis };

  // LLM pre-visit processor — concurrency 2 (Groq ~30 RPM)
  const previsitWorker = new Worker(
    'llm.previsit',
    createLlmPrevisitProcessor(prisma),
    { ...connection, concurrency: 2 },
  );

  // LLM post-visit processor — concurrency 2
  const postvisitWorker = new Worker(
    'llm.postvisit',
    createLlmPostvisitProcessor(prisma),
    { ...connection, concurrency: 2 },
  );

  // Email processor
  const emailWorker = new Worker(
    'email.send',
    createEmailProcessor(prisma),
    { ...connection, concurrency: 5 },
  );

  // Google Calendar sync processor
  const calendarWorker = new Worker(
    'calendar.sync',
    createCalendarProcessor(prisma),
    { ...connection, concurrency: 3 },
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Worker shutting down...');
    await Promise.all([
      previsitWorker.close(),
      postvisitWorker.close(),
      emailWorker.close(),
      calendarWorker.close(),
    ]);
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('Worker ready — processing queues: llm.previsit, llm.postvisit, email.send, calendar.sync');
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
