import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { PoliciesService } from './policies.service';

@Controller('policies')
export class PoliciesController {
  constructor(private readonly svc: PoliciesService) {}

  // GET /policies/bundle?domains=global&domains=manufacturing-food&locale=ko-KR&ioType=input
  @Get('bundle')
  async getBundle(
    @Query('domains') domainsRaw: string | string[],
    @Query('locale') locale: string,
    @Query('ioType') ioType: 'input' | 'output',
  ) {
    if (!locale || !ioType) {
      throw new HttpException('locale and ioType are required', HttpStatus.BAD_REQUEST);
    }
    const domains = Array.isArray(domainsRaw)
      ? domainsRaw
      : (domainsRaw ?? 'global').split(',').map((s) => s.trim()).filter(Boolean);
    return this.svc.getBundle(domains, locale, ioType);
  }

  @Post('invalidate')
  async invalidate() {
    await this.svc.invalidate();
    return { ok: true };
  }

  @Get('domains')
  list() {
    return { domains: this.svc.enabledDomains(), rules: this.svc.ruleCount() };
  }

  @Get(':domain/count')
  count(@Param('domain') _d: string) {
    return { domain: _d, ruleCount: this.svc.ruleCount() };
  }
}
