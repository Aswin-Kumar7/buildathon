import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users, type DbHandle } from '@sentinel/db';
import type { NotificationPrefs, UpdateNotificationPrefsRequest } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';

/**
 * The per-user notification preferences behind the console's notification bell.
 *
 * There is no email or chat delivery here on purpose: a notification is a real incident the bell
 * surfaces, so nothing is claimed to have been "sent" that the backend could not prove. This service
 * only stores which incidents should reach a user and the watermark of what they have already seen —
 * the incidents themselves come from the incidents list, unchanged.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async prefs(userId: string): Promise<NotificationPrefs> {
    const [row] = await this.handle.db
      .select({
        notifyMinSeverity: users.notifyMinSeverity,
        notifySimulated: users.notifySimulated,
        notificationsSeenAt: users.notificationsSeenAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (row === undefined) throw new Error('notification prefs requested for unknown user');
    return this.shape(row);
  }

  async update(userId: string, patch: UpdateNotificationPrefsRequest): Promise<NotificationPrefs> {
    const set: { notifyMinSeverity?: string; notifySimulated?: boolean } = {};
    if (patch.minSeverity !== undefined) set.notifyMinSeverity = patch.minSeverity;
    if (patch.simulated !== undefined) set.notifySimulated = patch.simulated;

    const [row] = await this.handle.db
      .update(users)
      .set(set)
      .where(eq(users.id, userId))
      .returning();
    if (row === undefined) throw new Error('notification prefs update affected no user');
    return this.shape(row);
  }

  /**
   * Marks everything up to now as read. The timestamp is the server's clock, never a value the
   * client supplies — a "seen" watermark a caller could set to the future would silence real
   * notifications.
   */
  async markSeen(userId: string): Promise<NotificationPrefs> {
    const [row] = await this.handle.db
      .update(users)
      .set({ notificationsSeenAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (row === undefined) throw new Error('notification seen update affected no user');
    return this.shape(row);
  }

  private shape(row: {
    notifyMinSeverity: string;
    notifySimulated: boolean;
    notificationsSeenAt: Date | null;
  }): NotificationPrefs {
    const minSeverity =
      row.notifyMinSeverity === 'medium' || row.notifyMinSeverity === 'high'
        ? row.notifyMinSeverity
        : 'low';
    return {
      minSeverity,
      simulated: row.notifySimulated,
      seenAt: row.notificationsSeenAt === null ? null : row.notificationsSeenAt.toISOString(),
    };
  }
}
