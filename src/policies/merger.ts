import { CompiledBundle, Rule } from './policy.types';

const ACTION_STRICTNESS: Record<string, number> = {
  allow: 0,
  warn: 1,
  add_disclaimer: 2,
  sanitize: 3,
  redact: 4,
  block_or_redact: 5,
  block_or_pseudonymize: 5,
  aggregate_only: 5,
  refuse: 6,
  escalate: 6,
  block: 7,
  route: 4,
};

/**
 * Merge order: caller passes domain list in escalation order
 *   ["global","manufacturing","manufacturing-food", ...tenantOverrides]
 * Conflict resolution: stricter action wins; on tie, higher priority wins;
 * on further tie, later (more-specific) domain wins.
 */
export function mergeRules(
  perDomain: Map<string, Rule[]>,
  domainOrder: string[],
  locale: string,
  ioType: 'input' | 'output',
): Rule[] {
  const byKey = new Map<string, { rule: Rule; orderIdx: number }>();

  for (let idx = 0; idx < domainOrder.length; idx++) {
    const d = domainOrder[idx];
    const list = perDomain.get(d) ?? [];
    for (const r of list) {
      if (!r.enabled) continue;
      if (r.locale !== locale && r.locale !== '*') continue;
      if (r.ioType !== ioType && r.ioType !== 'both') continue;

      const key = `${r.category}:${r.subCategory ?? ''}:${r.locale}:${r.ioType}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { rule: r, orderIdx: idx });
        continue;
      }
      const newer = stricter(existing.rule, r) ? r : existing.rule;
      // If new rule comes from a more specific domain and is at least equal strictness, prefer it.
      if (newer === r || idx >= existing.orderIdx) {
        byKey.set(key, { rule: newer, orderIdx: idx });
      }
    }
  }

  return Array.from(byKey.values())
    .map((v) => v.rule)
    .sort((a, b) => b.priority - a.priority);
}

function stricter(a: Rule, b: Rule): boolean {
  const sa = ACTION_STRICTNESS[a.action] ?? 0;
  const sb = ACTION_STRICTNESS[b.action] ?? 0;
  if (sb !== sa) return sb > sa;
  return b.priority > a.priority;
}

export function buildCompiledBundle(
  perDomain: Map<string, Rule[]>,
  domainOrder: string[],
  locale: string,
  ioType: 'input' | 'output',
  version: string,
): CompiledBundle {
  return {
    domain: domainOrder[domainOrder.length - 1],
    locale,
    ioType,
    rules: mergeRules(perDomain, domainOrder, locale, ioType),
    version,
    evaluatedDomains: domainOrder,
    generatedAt: new Date().toISOString(),
  };
}
