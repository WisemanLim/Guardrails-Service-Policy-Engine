import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface WhitelistEntry {
  id: string;
  domain: string;
  locale: string;
  category: string;
  patterns: string[];
  scoreAdjustment: number;
}

@Injectable()
export class WhitelistService {
  constructor(private readonly db: DbService) {}

  async list(domain: string, locale: string): Promise<WhitelistEntry[]> {
    const rows = await this.db.listWhitelist(domain, locale);
    return rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      locale: r.locale,
      category: r.category,
      patterns: r.patterns,
      scoreAdjustment: r.score_adjustment,
    }));
  }
}
