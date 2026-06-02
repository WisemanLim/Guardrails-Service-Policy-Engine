import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedactController } from './redact.controller';
import { RedactService } from './redact.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [RedactController, HealthController],
  providers: [RedactService],
})
export class RedactAppModule {}
