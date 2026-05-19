import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { PoliciesModule } from './policies/policies.module';
import { DomainsModule } from './domains/domains.module';
import { WhitelistModule } from './whitelist/whitelist.module';
import { CacheModule } from './cache/cache.module';
import { DbModule } from './db/db.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule,
    DbModule,
    PoliciesModule,
    DomainsModule,
    WhitelistModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
