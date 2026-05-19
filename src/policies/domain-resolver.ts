/**
 * Resolve domain-merge escalation order.
 *
 * Given a leaf domain (e.g. "manufacturing-food"), produce the chain
 *   ["global", "manufacturing", "manufacturing-food"]
 *
 * Convention: parents are inferred from the kebab-case prefix path.
 * The "global" baseline is always prepended.
 */
export function resolveDomainChain(leaf: string): string[] {
  if (leaf === 'global') return ['global'];
  const parts = leaf.split('-');
  const chain: string[] = ['global'];
  for (let i = 1; i <= parts.length; i++) {
    chain.push(parts.slice(0, i).join('-'));
  }
  // Dedup while preserving order.
  return Array.from(new Set(chain));
}

/**
 * For a request with multiple leaf domains (e.g. ["manufacturing-food", "manufacturing-chemical"]),
 * union the chains preserving escalation order (less specific → more specific).
 */
export function resolveMultiDomainChain(leaves: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // First pass: ensure ancestors come before descendants.
  const chains = leaves.map(resolveDomainChain);
  // Sort domains by depth (shorter first), then by original order.
  const depthOf = (d: string) => (d === 'global' ? 0 : d.split('-').length);
  const all = chains.flat().sort((a, b) => depthOf(a) - depthOf(b));
  for (const d of all) {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}
