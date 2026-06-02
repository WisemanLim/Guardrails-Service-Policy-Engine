import { z } from 'zod';

export const RedactMatchSchema = z.object({
  sub_category: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  matched_text: z.string().optional(),
  detector_id: z.string().optional(),
  category: z.string().optional(),
});
export type RedactMatch = z.infer<typeof RedactMatchSchema>;

export const RedactRequestSchema = z.object({
  text: z.string(),
  matches: z.array(RedactMatchSchema).default([]),
});
export type RedactRequest = z.infer<typeof RedactRequestSchema>;

export interface RedactResponse {
  redactedText: string;
  replacements: number;
}
