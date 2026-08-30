import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  notificationPrefsSchema,
  updateNotificationPrefsRequestSchema,
  type NotificationPrefs,
} from '@sentinel/contracts';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { NotificationsService } from './notifications.service.js';

/** The notification bell's preferences and read-watermark, all scoped to the signed-in user. */
@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('prefs')
  async prefs(@Req() req: AuthedRequest): Promise<NotificationPrefs> {
    return notificationPrefsSchema.parse(await this.notifications.prefs(req.user!.id));
  }

  @Post('prefs')
  @HttpCode(200)
  async update(@Body() body: unknown, @Req() req: AuthedRequest): Promise<NotificationPrefs> {
    const patch = updateNotificationPrefsRequestSchema.parse(body);
    return notificationPrefsSchema.parse(await this.notifications.update(req.user!.id, patch));
  }

  /** Marks everything currently in the bell as read for this user. */
  @Post('seen')
  @HttpCode(200)
  async seen(@Req() req: AuthedRequest): Promise<NotificationPrefs> {
    return notificationPrefsSchema.parse(await this.notifications.markSeen(req.user!.id));
  }
}
