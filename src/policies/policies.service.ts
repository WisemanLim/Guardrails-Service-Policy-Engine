import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { RedisService } from '../cache/redis.service';
import { resolveMultiDomainChain } from './domain-resolver';
import { loadPoliciesFromDir } from './loader';
import { buildCompiledBundle } from './merger';
import { CompiledBundle, Rule } from './policy.types';

@Injectable()
export class PoliciesService implements OnModuleInit {
  private readonly log = new Logger(PoliciesService.name);
  private rulesByDomain = new Map<string, Rule[]>();
  private domains: string[] = [];
  private bundleVersion = '0.1.0';

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    const dir = process.env.POLICY_DIR ?? path.resolve(__dirname, '../../policies');
    this.domains = (process.env.GUARDRAILS_ENABLED_DOMAINS ?? 'global')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ancestors = resolveMultiDomainChain(this.domains);
    const loaded = await loadPoliciesFromDir(dir, ancestors);
    this.rulesByDomain = loaded.byDomain;
    this.log.log(`Loaded ${loaded.total} rules across ${this.rulesByDomain.size} domains from ${dir}`);
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

  async invalidate(): Promise<void> {
    await this.redis.del('bundle:');
  }
}
