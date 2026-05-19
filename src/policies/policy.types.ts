import { z } from 'zod';

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export const IoType = z.enum(['input', 'output', 'both']);
export const Action = z.enum([
  'allow',
  'warn',
  'redact',
  'sanitize',
  'block',
  'block_or_redact',
  'block_or_pseudonymize',
  'aggregate_only',
  'refuse',
  'escalate',
  'add_disclaimer',
  'route',
]);

export const RuleSchema = z.object({
  ruleId: z.string(),
  domain: z.string(),
  locale: z.string(),
  ioType: IoType,
  category: z.string(),
  subCategory: z.string().optional(),
  description: z.string(),
  patternType: z.string(),
  patterns: z
    .object({
      regex: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      entities: z.array(z.string()).optional(),
      luhnCheck: z.boolean().optional(),
      minContextWindow: z.number().optional(),
      requiresPersonLink: z.boolean().optional(),
    })
    .optional(),
  severity: Severity,
  priority: z.number().int().default(100),
  action: Action,
  messageTemplate: z.record(z.string(), z.string()).default({}),
  regulationTags: z.array(z.string()).default([]),
  examplesPositive: z.array(z.string()).default([]),
  examplesNegative: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  version: z.string().default('1.0.0'),
});
export type Rule = z.infer<typeof RuleSchema>;

export interface CompiledBundle {
  domain: string;
  locale: string;
  ioType: 'input' | 'output' | 'both';
  rules: Rule[];
  version: string;
  evaluatedDomains: string[];
  generatedAt: string;
}
