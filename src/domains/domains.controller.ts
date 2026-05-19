import { Controller, Get, Param } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { resolveDomainChain, resolveMultiDomainChain } from '../policies/domain-resolver';

@Controller('domains')
export class DomainsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list() {
    if (!this.db.isAvailable()) {
      return { source: 'fallback', driver: this.db.driver, items: [{ domainKey: 'global', status: 'active' }] };
    }
    const items = await this.db.listDomains();
    return { source: 'db', driver: this.db.driver, items };
  }

  @Get(':key/chain')
  chain(@Param('key') key: string) {
    return { domain: key, chain: resolveDomainChain(key) };
  }

  @Get(':keys/chain-multi')
  chainMulti(@Param('keys') keys: string) {
    return { domains: keys.split(','), chain: resolveMultiDomainChain(keys.split(',')) };
  }
}
