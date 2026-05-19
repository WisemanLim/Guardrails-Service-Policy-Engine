import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Pool } from 'pg';
import { POLICY_ENGINE_SQLITE_SCHEMA } from './schema.sqlite';

export interface DomainRow {
  domain_key: string;
  status: string;
  version: string;
}

export interface WhitelistRow {
  id: string;
  domain: string;
  locale: string;
  category: string;
  patterns: string[];
  score_adjustment: number;
}

type Driver = 'postgres' | 'sqlite';

/**
 * Backend-neutral DB facade for the Policy Engine.
 *
 * - `DB_DRIVER=postgres` (default, production stack)  → `pg` Pool
 * - `DB_DRIVER=sqlite`                                → `better-sqlite3` (single-file, no daemon)
 *
 * Each typed method handles per-driver SQL and value adaptation
 * (TEXT[] / JSONB on Postgres ↔ JSON strings on SQLite). Callers do not
 * write raw SQL.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  readonly driver: Driver;
  private pg?: Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sqlite?: any;
  private _available = false;
  private readonly sqlitePath: string;

  constructor() {
    this.driver = ((process.env.DB_DRIVER ?? 'postgres').toLowerCase() === 'sqlite' ? 'sqlite' : 'postgres');
    this.sqlitePath = process.env.SQLITE_PATH ?? './var/policy-engine.db';
  }

  async onModuleInit(): Promise<void> {
    if (this.driver === 'sqlite') await this.openSqlite();
    else await this.openPostgres();
  }

  isAvailable(): boolean {
    return this._available;
  }

  private async openSqlite(): Promise<void> {
    try {
      const Database = (await import('better-sqlite3')).default;
      mkdirSync(dirname(this.sqlitePath), { recursive: true });
      this.sqlite = new Database(this.sqlitePath);
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('synchronous = NORMAL');
      this.sqlite.exec(POLICY_ENGINE_SQLITE_SCHEMA);
      this._available = true;
      this.log.log(`SQLite ready at ${this.sqlitePath}`);
    } catch (e) {
      this.log.warn(`SQLite open failed: ${(e as Error).message}`);
    }
  }

  private async openPostgres(): Promise<void> {
    this.pg = new Pool({
      host: process.env.POSTGRES_HOST ?? '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'guardrails',
      user: process.env.POSTGRES_USER ?? 'guardrails',
      password: process.env.POSTGRES_PASSWORD ?? 'guardrails',
      max: 10,
    });
    try {
      await this.pg.query('SELECT 1');
      this._available = true;
      this.log.log('Postgres connected');
    } catch (e) {
      this.log.warn(`Postgres unavailable: ${(e as Error).message} — running file-only mode.`);
    }
  }

  // ---------------- public API used by services ----------------

  async listDomains(): Promise<DomainRow[]> {
    if (!this._available) return [];
    if (this.driver === 'sqlite') {
      return this.sqlite
        .prepare('SELECT domain_key, status, version FROM domains ORDER BY domain_key')
        .all() as DomainRow[];
    }
    const res = await this.pg!.query<DomainRow>(
      'SELECT domain_key, status, version FROM domains ORDER BY domain_key',
    );
    return res.rows;
  }

  async listAllRules(): Promise<Array<{
    rule_id: string;
    domain: string;
    locale: string;
    io_type: 'input' | 'output' | 'both';
    category: string;
    sub_category: string | null;
    severity: string;
    priority: number;
    action: string;
    pattern_bundle: unknown;
    message_template: unknown;
    regulation_tags: string[];
    examples_positive: string[];
    examples_negative: string[];
    enabled: boolean;
    version: string;
  }>> {
    if (!this._available) return [];
    if (this.driver === 'sqlite') {
      const rows = this.sqlite.prepare('SELECT * FROM rules WHERE enabled = 1').all() as Array<{
        rule_id: string;
        domain: string;
        locale: string;
        io_type: 'input' | 'output' | 'both';
        category: string;
        sub_category: string | null;
        severity: string;
        priority: number;
        action: string;
        pattern_bundle: string;
        message_template: string;
        regulation_tags: string;
        examples_positive: string;
        examples_negative: string;
        enabled: number;
        version: string;
      }>;
      return rows.map((r) => ({
        ...r,
        enabled: !!r.enabled,
        pattern_bundle: r.pattern_bundle ? JSON.parse(r.pattern_bundle) : {},
        message_template: r.message_template ? JSON.parse(r.message_template) : {},
        regulation_tags: r.regulation_tags ? JSON.parse(r.regulation_tags) : [],
        examples_positive: r.examples_positive ? JSON.parse(r.examples_positive) : [],
        examples_negative: r.examples_negative ? JSON.parse(r.examples_negative) : [],
      }));
    }
    const res = await this.pg!.query(
      'SELECT rule_id, domain, locale, io_type, category, sub_category, severity, priority, action, pattern_bundle, message_template, regulation_tags, examples_positive, examples_negative, enabled, version FROM rules WHERE enabled = TRUE',
    );
    return res.rows as unknown as Array<{
      rule_id: string;
      domain: string;
      locale: string;
      io_type: 'input' | 'output' | 'both';
      category: string;
      sub_category: string | null;
      severity: string;
      priority: number;
      action: string;
      pattern_bundle: unknown;
      message_template: unknown;
      regulation_tags: string[];
      examples_positive: string[];
      examples_negative: string[];
      enabled: boolean;
      version: string;
    }>;
  }

  async listWhitelist(domain: string, locale: string): Promise<WhitelistRow[]> {
    if (!this._available) return [];
    if (this.driver === 'sqlite') {
      const rows = this.sqlite
        .prepare(
          'SELECT id, domain, locale, category, patterns, score_adjustment FROM whitelists WHERE domain = ? AND locale = ?',
        )
        .all(domain, locale) as Array<Omit<WhitelistRow, 'patterns'> & { patterns: string }>;
      return rows.map((r) => ({
        ...r,
        patterns: r.patterns ? (JSON.parse(r.patterns) as string[]) : [],
        score_adjustment: Number(r.score_adjustment),
      }));
    }
    const res = await this.pg!.query<{
      id: string;
      domain: string;
      locale: string;
      category: string;
      patterns: string[];
      score_adjustment: string;
    }>(
      'SELECT id, domain, locale, category, patterns, score_adjustment FROM whitelists WHERE domain = $1 AND locale = $2',
      [domain, locale],
    );
    return res.rows.map((r) => ({ ...r, score_adjustment: Number(r.score_adjustment) }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pg) await this.pg.end().catch(() => undefined);
    if (this.sqlite) this.sqlite.close();
  }
}
