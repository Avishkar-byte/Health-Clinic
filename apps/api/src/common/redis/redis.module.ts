import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          // Return a mock/noop for development without Redis
          console.warn('REDIS_URL not set — queue features disabled');
          return null;
        }
        if (url.startsWith('http://') || url.startsWith('https://')) {
          console.error(
            `REDIS_URL is set to a REST URL (${url}). ioredis/BullMQ need the ` +
              `TCP connection string instead (starts with redis:// or rediss://) — ` +
              `in Upstash, copy the "ioredis" / "Node" connection string, not the REST URL. ` +
              `Queue features are disabled until this is fixed.`,
          );
          return null;
        }
        const client = new Redis(url, {
          maxRetriesPerRequest: null, // Required by BullMQ
          enableReadyCheck: false,
        });
        client.on('error', (err) => {
          console.error('Redis connection error:', err.message);
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
