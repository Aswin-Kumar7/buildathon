import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { loginAttempts, sessions, users, type DbHandle } from '@sentinel/db';
import type { SessionUser, UpdateProfileRequest } from '@sentinel/contracts';
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

  /**
   * Changes a user's own password, after re-verifying the current one.
   *
   * Returns a discriminated result rather than throwing on a wrong password: a bad current password
   * is an ordinary outcome the caller shows the person, not an exception. The new hash replaces the
   * old in place; existing sessions are left alone, so the person is not signed out of other devices
   * by changing their password here — that is a separate control.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<'ok' | 'wrong-password'> {
    const [user] = await this.handle.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return 'wrong-password';

    let valid = false;
    try {
      valid = await verify(user.passwordHash, currentPassword);
    } catch {
      valid = false;
    }
    if (!valid) return 'wrong-password';

    await this.handle.db
      .update(users)
      .set({ passwordHash: await this.hashPassword(newPassword) })
      .where(eq(users.id, userId));
    return 'ok';
  }

  /**
   * Updates the caller's own name and/or access level, and returns the fresh profile.
   *
   * Self-service by design: this is the single-operator settings page, not team administration,
   * so a person edits their own record here. Role is a real permission, so the console makes the
   * consequence plain rather than hiding it — dropping to analyst gives up approval and publish.
   */
  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<SessionUser> {
    const set: { displayName?: string; role?: 'analyst' | 'admin' } = {};
    if (patch.displayName !== undefined) set.displayName = patch.displayName.trim();
    if (patch.role !== undefined) set.role = patch.role;

    const [row] = await this.handle.db
      .update(users)
      .set(set)
      .where(eq(users.id, userId))
      .returning();
    if (row === undefined) throw new Error('profile update affected no user');
    return { id: row.id, email: row.email, displayName: row.displayName, role: row.role };
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
}
