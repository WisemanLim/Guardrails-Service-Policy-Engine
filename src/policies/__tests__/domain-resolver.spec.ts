import { resolveDomainChain, resolveMultiDomainChain } from '../domain-resolver';

describe('resolveDomainChain', () => {
  it('produces ancestor chain for leaf', () => {
    expect(resolveDomainChain('manufacturing-food')).toEqual(['global', 'manufacturing', 'manufacturing-food']);
  });
  it('handles global', () => {
    expect(resolveDomainChain('global')).toEqual(['global']);
  });
  it('handles 3-level leaf', () => {
    expect(resolveDomainChain('manufacturing-automotive-battery')).toEqual([
      'global',
      'manufacturing',
      'manufacturing-automotive',
      'manufacturing-automotive-battery',
    ]);
  });
});

describe('resolveMultiDomainChain', () => {
  it('orders ancestors before descendants and dedupes', () => {
    const chain = resolveMultiDomainChain(['manufacturing-food', 'manufacturing-chemical']);
    expect(chain[0]).toBe('global');
    expect(chain.indexOf('manufacturing')).toBeGreaterThan(0);
    expect(chain).toContain('manufacturing-food');
    expect(chain).toContain('manufacturing-chemical');
    expect(new Set(chain).size).toBe(chain.length);
  });
});
