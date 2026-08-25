import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePolicy, policyHash, InvalidPolicy, type Policy } from '@sentinel/policy';

/**
 * Loads `policy.yaml` once, at startup, and refuses to start without it.
 *
 * Read from disk rather than the database on purpose. A policy that can be edited from a console
 * is a policy whose history lives in a table nobody diffs; one that lives in the repository is
 * reviewed, versioned and reverted like any other change — and the question "who decided the
 * threshold should be 0.75" has an answer with a name on it.
 *
 * Failing to start on a broken policy is deliberate. The alternative is running with defaults
 * nobody chose, which is how a system ends up doing something to a customer that no file
 * anywhere says it should.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private readonly loaded: Policy;
  private readonly hash: string;

  constructor() {
    // Resolved from the working directory, which is the API package when running and `/repo`
    // in the container. Both put the file at the workspace root.
    const candidates = ['policy.yaml', '../../policy.yaml', '../policy.yaml'];

    let source: string | null = null;
    for (const candidate of candidates) {
      try {
        source = readFileSync(resolve(process.cwd(), candidate), 'utf8');
        break;
      } catch {
        continue;
      }
    }

    if (source === null) {
      throw new Error(
        `policy.yaml not found (looked in ${candidates.join(', ')} from ${process.cwd()}). ` +
          'The system will not run without a policy: the alternative is acting on defaults ' +
          'nobody chose.',
      );
    }

    try {
      this.loaded = parsePolicy(source);
    } catch (error) {
      if (error instanceof InvalidPolicy) {
        throw new Error(`policy.yaml is not usable:\n  ${error.problems.join('\n  ')}`);
      }
      throw error;
    }

    this.hash = policyHash(this.loaded);
    this.logger.log(`policy v${this.loaded.version} loaded (${this.hash})`);
  }

  get policy(): Policy {
    return this.loaded;
  }

  get version(): number {
    return this.loaded.version;
  }

  get fingerprint(): string {
    return this.hash;
  }
}
