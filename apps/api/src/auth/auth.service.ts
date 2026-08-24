import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { loginAttempts, sessions, users, type DbHandle } from '@sentinel/db';
import type { SessionUser } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';

export interface SessionCreated {
  token: string;
  csrfToken: string;
  user: SessionUser;
  expiresAt: Date;
}

export type LoginFailure = 'invalid-credentials' | 'rate-limited';

export type LoginOutcome =
  { ok: true; session: SessionCreated } | { ok: false; reason: LoginFailure };

/**
 * A hash of a password nobody uses, so an unknown email still costs a full argon2
 * verification. Without it, response timing tells an attacker which emails exist.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2VudGluZWxkZWNveXNhbHQ$8Xn0Q0m0v0M4iZ8Yy3Q0oQ1nQ0Xw2Z9m0M0aQ0bQ0cQ';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async hashPassword(plain: string): Promise<string> {
    return hash(plain);
  }

  async login(email: string, password: string): Promise<LoginOutcome> {
    const normalised = email.trim().toLowerCase();

    if (await this.isRateLimited(normalised)) {
      return { ok: false, reason: 'rate-limited' };
    }

    const [user] = await this.handle.db
      .select()
      .from(users)
      .where(eq(users.email, normalised))
      .limit(1);

    // Always verify against something so an unknown email and a wrong password
    // take comparable time.
    const stored = user?.passwordHash ?? DECOY_HASH;
    let valid = false;
    try {
      valid = await verify(stored, password);
    } catch {
      valid = false;
    }

    if (!user || !valid || user.disabledAt !== null) {
      await this.recordAttempt(normalised, false);
      return { ok: false, reason: 'invalid-credentials' };
    }

    await this.recordAttempt(normalised, true);

    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3600 * 1000);

    await this.handle.db.insert(sessions).values({
      id: hashToken(token),
      userId: user.id,
      csrfToken,
      expiresAt,
    });

    return {
      ok: true,
      session: {
        token,
        csrfToken,
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      },
    };
  }

  async resolveSession(
    token: string | undefined,
  ): Promise<{ user: SessionUser; csrfToken: string } | null> {
    if (token === undefined || token === '') return null;

    const rows = await this.handle.db
      .select({
        csrfToken: sessions.csrfToken,
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        disabledAt: users.disabledAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || row.disabledAt !== null) return null;

    return {
      csrfToken: row.csrfToken,
      user: { id: row.id, email: row.email, displayName: row.displayName, role: row.role },
    };
  }

  async revoke(token: string | undefined): Promise<void> {
    if (token === undefined || token === '') return;
    await this.handle.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, hashToken(token)));
  }

  private async isRateLimited(email: string): Promise<boolean> {
    const since = new Date(Date.now() - this.env.LOGIN_WINDOW_MINUTES * 60 * 1000);
    const rows = await this.handle.db
      .select({ succeeded: loginAttempts.succeeded })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, since)))
      .orderBy(desc(loginAttempts.attemptedAt))
      .limit(this.env.LOGIN_MAX_ATTEMPTS);

    return (
      rows.length >= this.env.LOGIN_MAX_ATTEMPTS && rows.every((row) => row.succeeded === false)
    );
  }

  private async recordAttempt(email: string, succeeded: boolean): Promise<void> {
    await this.handle.db.insert(loginAttempts).values({ email, succeeded });
  }

  async createUser(input: {
    email: string;
    displayName: string;
    password: string;
    role?: 'analyst' | 'admin';
  }): Promise<void> {
    await this.handle.db
      .insert(users)
      .values({
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName,
        passwordHash: await this.hashPassword(input.password),
        role: input.role ?? 'analyst',
      })
      .onConflictDoNothing();
  }

  async countUsers(): Promise<number> {
    const [row] = await this.handle.db.select({ count: sql<number>`count(*)::int` }).from(users);
    return row?.count ?? 0;
  }
}
