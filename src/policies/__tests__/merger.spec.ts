import { mergeRules } from '../merger';
import type { Rule } from '../policy.types';

const base: Omit<Rule, 'ruleId' | 'domain' | 'action' | 'priority'> = {
  locale: 'ko-KR',
  ioType: 'input',
  category: 'pii',
  subCategory: 'national_id_kr',
  description: '',
  patternType: 'regex',
  patterns: { regex: ['x'] },
  severity: 'high',
  messageTemplate: {},
  regulationTags: [],
  examplesPositive: [],
  examplesNegative: [],
  enabled: true,
  version: '1.0.0',
};

const mkRule = (id: string, domain: string, action: Rule['action'], priority: number): Rule => ({
  ...base,
  ruleId: id,
  domain,
  action,
  priority,
});

describe('mergeRules', () => {
  it('lets stricter (block) override warn from ancestor domain', () => {
    const map = new Map<string, Rule[]>();
    map.set('global', [mkRule('a', 'global', 'warn', 100)]);
    map.set('manufacturing-food', [mkRule('b', 'manufacturing-food', 'block', 100)]);
    const merged = mergeRules(map, ['global', 'manufacturing-food'], 'ko-KR', 'input');
    expect(merged).toHaveLength(1);
    expect(merged[0].ruleId).toBe('b');
    expect(merged[0].action).toBe('block');
  });

  it('keeps stricter ancestor rule when descendant tries to weaken', () => {
    const map = new Map<string, Rule[]>();
    map.set('global', [mkRule('a', 'global', 'block', 100)]);
    map.set('manufacturing-food', [mkRule('b', 'manufacturing-food', 'warn', 100)]);
    const merged = mergeRules(map, ['global', 'manufacturing-food'], 'ko-KR', 'input');
    expect(merged[0].action).toBe('block');
  });

  it('filters by locale and ioType', () => {
    const en: Rule = { ...mkRule('a', 'global', 'block', 100), locale: 'en' };
    const map = new Map<string, Rule[]>();
    map.set('global', [en]);
    expect(mergeRules(map, ['global'], 'ko-KR', 'input')).toHaveLength(0);
  });
});
