import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Rule, RuleSchema } from './policy.types';

const log = new Logger('PolicyLoader');

export interface LoadedRules {
  byDomain: Map<string, Rule[]>;
  total: number;
}

export async function loadPoliciesFromDir(rootDir: string, enabledDomains: string[]): Promise<LoadedRules> {
  const byDomain = new Map<string, Rule[]>();
  let total = 0;

  for (const domain of enabledDomains) {
    const dir = path.join(rootDir, domain);
    const rules = await walkAndLoad(dir, domain);
    if (rules.length) {
      byDomain.set(domain, rules);
      total += rules.length;
    } else {
      log.warn(`No rules found for domain "${domain}" under ${dir}`);
    }
  }

  return { byDomain, total };
}

/**
 * Load flat bundle files from a directory (e.g. `scripts/`).
 *
 * Bundle file format (matches the output of `scripts/gen-rules.py`):
 *   { "$schema": ..., "domain": "global", "locale": "ko-KR",
 *     "totalRules": 245, "rules": [ ... ] }
 *
 * Filename is informational only — `bundle.domain` is the source of truth.
 * Each bundle is included if its declared domain is in `enabledDomains`.
 * Rules whose `domain` field disagrees with the bundle's `domain` are
 * skipped with a warning.
 */
export async function loadBundlesFromDir(rootDir: string, enabledDomains: string[]): Promise<LoadedRules> {
  const byDomain = new Map<string, Rule[]>();
  let total = 0;
  const enabled = new Set(enabledDomains);

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return { byDomain, total };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = path.join(rootDir, entry.name);
    let raw: any;
    try {
      raw = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch (e) {
      log.error(`Failed to read bundle ${full}: ${(e as Error).message}`);
      continue;
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) continue;
    const bundleDomain = String(raw.domain ?? '');
    if (!bundleDomain || !enabled.has(bundleDomain)) {
      log.debug?.(`Skip bundle ${entry.name}: domain "${bundleDomain}" not in enabled set.`);
      continue;
    }
    const arr = byDomain.get(bundleDomain) ?? [];
    let added = 0;
    for (const item of raw.rules) {
      const parsed = RuleSchema.safeParse(item);
      if (!parsed.success) {
        log.warn(`Skipping invalid rule in ${full}: ${parsed.error.message}`);
        continue;
      }
      if (parsed.data.domain !== bundleDomain) {
        log.warn(
          `Rule ${parsed.data.ruleId} domain mismatch in ${entry.name} (bundle=${bundleDomain}, rule=${parsed.data.domain})`,
        );
        continue;
      }
      arr.push(parsed.data);
      added++;
    }
    if (added > 0) {
      byDomain.set(bundleDomain, arr);
      total += added;
      log.log(`Loaded bundle ${entry.name}: ${added} rules → ${bundleDomain}`);
    }
  }
  return { byDomain, total };
}

async function walkAndLoad(dir: string, expectedDomain: string): Promise<Rule[]> {
  const out: Rule[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkAndLoad(full, expectedDomain)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const raw = JSON.parse(await fs.readFile(full, 'utf8'));
        const arr = Array.isArray(raw) ? raw : Array.isArray(raw.rules) ? raw.rules : [raw];
        for (const item of arr) {
          const parsed = RuleSchema.safeParse(item);
          if (!parsed.success) {
            log.warn(`Skipping invalid rule in ${full}: ${parsed.error.message}`);
            continue;
          }
          if (parsed.data.domain !== expectedDomain) {
            log.warn(`Rule ${parsed.data.ruleId} domain mismatch (expected ${expectedDomain}, got ${parsed.data.domain})`);
            continue;
          }
          out.push(parsed.data);
        }
      } catch (e) {
        log.error(`Failed to load ${full}: ${(e as Error).message}`);
      }
    }
  }
  return out;
}
