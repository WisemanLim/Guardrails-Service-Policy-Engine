import { Controller, Get, Query } from '@nestjs/common';
import { WhitelistService } from './whitelist.service';

@Controller('whitelist')
export class WhitelistController {
  constructor(private readonly svc: WhitelistService) {}

  @Get()
  async list(@Query('domain') domain = 'global', @Query('locale') locale = 'ko-KR') {
    return { items: await this.svc.list(domain, locale) };
  }
}
