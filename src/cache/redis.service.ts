import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  private readonly client: Redis;
  private connected = false;

  constructor() {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    this.client = new Redis({
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    this.client.connect().then(
      () => {
        this.connected = true;
        this.log.log(`Redis connected ${host}:${port}`);
      },
      (err) => this.log.warn(`Redis not connected: ${err.message} — running cache-less.`),
    );
  }

  isConnected(): boolean {
    return this.connected;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected) return null;
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSec = 300): Promise<void> {
    if (!this.connected) return;
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
  }

  async del(prefix: string): Promise<void> {
    if (!this.connected) return;
    const stream = this.client.scanStream({ match: `${prefix}*`, count: 100 });
    for await (const keys of stream) {
      if ((keys as string[]).length) await this.client.del(...(keys as string[]));
    }
  }

  async onModuleDestroy() {
    if (this.connected) await this.client.quit();
  }
}
