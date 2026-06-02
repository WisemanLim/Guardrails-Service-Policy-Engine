import { Injectable } from '@nestjs/common';
import type { RedactMatch } from './redact.types';

const PLACEHOLDER: Record<string, string> = {
  national_id_kr: '******-*******',
  ssn_us: '***-**-****',
  mynumber_jp: '****-****-****',
  passport: '[PASSPORT]',
  card_number: '[CARD]',
  iban: '[IBAN]',
  email: '[EMAIL]',
  phone_kr: '[PHONE]',
  phone_us: '[PHONE]',
  business_reg_kr: '[BRN]',
  driver_license_kr: '[DL]',
  ip_address: '[IP]',
  api_key: '[SECRET]',
};

@Injectable()
export class RedactService {
  redact(text: string, matches: RedactMatch[]): { redactedText: string; replacements: number } {
    if (!matches?.length) return { redactedText: text, replacements: 0 };
    const sorted = [...matches].sort((a, b) => b.start - a.start);
    let out = text;
    let replacements = 0;
    for (const m of sorted) {
      if (m.start < 0 || m.end > out.length || m.end <= m.start) continue;
      const ph = PLACEHOLDER[m.sub_category] ?? '[REDACTED]';
      out = out.slice(0, m.start) + ph + out.slice(m.end);
      replacements++;
    }
    return { redactedText: out, replacements };
  }
}
