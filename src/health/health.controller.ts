import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { PoliciesService } from '../policies/policies.service';

@Controller('health')
export class HealthController {
  constructor(private readonly policies: PoliciesService, private readonly db: DbService) {}

  @Get()
  health() {
    return {
      status: 'ok',
      enabledDomains: this.policies.enabledDomains(),
      rulesLoaded: this.policies.ruleCount(),
      db: { driver: this.db.driver, available: this.db.isAvailable() },
    };
  }
}
