import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { RedisService } from '../cache/redis.service';
import { DbService } from '../db/db.service';
import { resolveMultiDomainChain } from './domain-resolver';
import { loadBundlesFromDir, loadPoliciesFromDir } from './loader';
import { buildCompiledBundle } from './merger';
import { CompiledBundle, Rule, RuleSchema } from './policy.types';

@Injectable()
export class PoliciesService implements OnModuleInit {
  private readonly log = new Logger(PoliciesService.name);
  private rulesByDomain = new Map<string, Rule[]>();
  private domains: string[] = [];
  private bundleVersion = '0.1.0';

  constructor(private readonly redis: RedisService, private readonly db: DbService) {}

  async onModuleInit() {
    this.domains = (process.env.GUARDRAILS_ENABLED_DOMAINS ?? 'global')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await this.refresh();
    await this.seedIfNeeded();
    // Refresh once more so the freshly-seeded DB rows are visible to
    // subsequent bundle queries (refresh merges file + DB).
    await this.refresh();
  }

  /**
   * Seed file-loaded rules into the DB on first boot, per-domain. Idempotent:
   * any domain with one or more pre-existing rows is skipped. This means
   * Admin edits — and indeed any prior DB state — are never overwritten by
   * a subsequent restart. Works identically in production (Postgres) and
   * local (SQLite) modes via the DbService driver abstraction.
   */
  async seedIfNeeded(): Promise<void> {
    if (!this.db.isAvailable()) {
      this.log.warn('DB unavailable, skipping rule seed.');
      return;
    }
    for (const [domain, rules] of this.rulesByDomain.entries()) {
      const existing = await this.db.countRulesByDomain(domain);
      if (existing > 0) {
        this.log.log(`Skip seed for "${domain}": ${existing} rule(s) already in DB.`);
        continue;
      }
      if (rules.length === 0) continue;
      const rows = rules.map((r) => ({
        rule_id: r.ruleId,
        domain: r.domain,
        locale: r.locale,
        io_type: r.ioType,
        category: r.category,
        sub_category: r.subCategory ?? null,
        severity: r.severity,
        priority: r.priority,
        action: r.action,
        pattern_bundle: r.patterns ?? {},
        message_template: r.messageTemplate ?? {},
        regulation_tags: r.regulationTags ?? [],
        examples_positive: r.examplesPositive ?? [],
        examples_negative: r.examplesNegative ?? [],
        enabled: r.enabled,
        version: r.version,
      }));
      const inserted = await this.db.bulkInsertRules(rows, 'file');
      this.log.log(`Seeded ${inserted}/${rules.length} rules into "${domain}" (source=file).`);
    }
  }

  /**
   * Reload rules from both the file bundle (boot baseline) and the DB
   * (admin-managed mutations). DB rules override file rules with the same
   * ruleId, and DB-only rules are appended even if GUARDRAILS_ENABLED_DOMAINS
   * doesn't include their domain explicitly — this keeps Admin-created rules
   * visible after a write without a service restart.
   */
  async refresh(): Promise<void> {
    const ancestors = resolveMultiDomainChain(this.domains);
    const dir = process.env.POLICY_DIR ?? path.resolve(__dirname, '../../policies');
    const seedsDir = process.env.SEEDS_DIR ?? path.resolve(__dirname, '../../../../MCP-type-Guardrails-Service/scripts');
    const merged = new Map<string, Rule[]>();

    // 1a) directory-style file rules (legacy: policies/<domain>/<category>/...)
    const fileLoaded = await loadPoliciesFromDir(dir, ancestors);
    for (const [d, rules] of fileLoaded.byDomain.entries()) {
      merged.set(d, [...rules]);
    }
    // 1b) flat bundle files (preferred: scripts/<phase>.<locale>.json — gen-rules.py output)
    const bundleLoaded = await loadBundlesFromDir(seedsDir, ancestors);
    for (const [d, rules] of bundleLoaded.byDomain.entries()) {
      const existing = merged.get(d) ?? [];
      const byId = new Map(existing.map((r) => [r.ruleId, r] as const));
      for (const r of rules) byId.set(r.ruleId, r);  // bundle wins on ruleId conflict
      merged.set(d, [...byId.values()]);
    }

    // 2) db rules (admin overrides / additions)
    let dbCount = 0;
    if (this.db.isAvailable()) {
      const dbRows = await this.db.listAllRules();
      const byId = new Map<string, { domain: string; idx: number }>();
      for (const [d, rules] of merged.entries()) {
        rules.forEach((r, i) => byId.set(r.ruleId, { domain: d, idx: i }));
      }
      for (const row of dbRows) {
        const dto = {
          ruleId: row.rule_id,
          domain: row.domain,
          locale: row.locale,
          ioType: row.io_type,
          category: row.category,
          subCategory: row.sub_category ?? undefined,
          description: '',
          patternType: 'classifier',
          patterns: (row.pattern_bundle ?? {}) as Rule['patterns'],
          severity: row.severity,
          priority: row.priority,
          action: row.action,
          messageTemplate: (row.message_template ?? {}) as Record<string, string>,
          regulationTags: row.regulation_tags ?? [],
          examplesPositive: row.examples_positive ?? [],
          examplesNegative: row.examples_negative ?? [],
          enabled: row.enabled,
          version: row.version,
        };
        const parsed = RuleSchema.safeParse(dto);
        if (!parsed.success) {
          this.log.warn(`DB rule ${row.rule_id} invalid: ${parsed.error.message}`);
          continue;
        }
        const existing = byId.get(row.rule_id);
        if (existing) {
          merged.get(existing.domain)![existing.idx] = parsed.data;
        } else {
          const arr = merged.get(row.domain) ?? [];
          arr.push(parsed.data);
          merged.set(row.domain, arr);
        }
        dbCount++;
      }
    }

    this.rulesByDomain = merged;
    let total = 0;
    for (const arr of merged.values()) total += arr.length;
    this.log.log(
      `Loaded ${total} rules across ${merged.size} domains ` +
      `(file=${fileLoaded.total}, bundle=${bundleLoaded.total}, db=${dbCount}).`,
    );
  }

  enabledDomains(): string[] {
    return [...this.domains];
  }

  ruleCount(): number {
    let n = 0;
    for (const arr of this.rulesByDomain.values()) n += arr.length;
    return n;
  }

  async getBundle(domains: string[], locale: string, ioType: 'input' | 'output'): Promise<CompiledBundle> {
    const chain = resolveMultiDomainChain(domains);
    const cacheKey = `bundle:${chain.join('+')}:${locale}:${ioType}`;
    const cached = await this.redis.get<CompiledBundle>(cacheKey);
    if (cached) return cached;
    const compiled = buildCompiledBundle(this.rulesByDomain, chain, locale, ioType, this.bundleVersion);
    await this.redis.set(cacheKey, compiled, 300);
    return compiled;
  }

  /**
   * Invalidate triggers both a Redis cache flush and a refresh from file+DB.
   * Admin service calls this after every CRUD mutation.
   */
  async invalidate(): Promise<void> {
    await this.redis.del('bundle:');
    await this.refresh();
  }
}
