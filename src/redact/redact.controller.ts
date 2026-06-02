import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { RedactService } from './redact.service';
import { RedactRequestSchema, type RedactResponse } from './redact.types';

@Controller('redact')
export class RedactController {
  constructor(private readonly redact: RedactService) {}

  @Post()
  apply(@Body() body: unknown): RedactResponse {
    const parsed = RedactRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'invalid_redact_request',
        details: parsed.error.flatten(),
      });
    }
    const { text, matches } = parsed.data;
    const { redactedText, replacements } = this.redact.redact(text, matches);
    return { redactedText, replacements };
  }
}
