import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  updateProfileRequestSchema,
  type LoginResponse,
  type MeResponse,
  type SessionUser,
} from '@sentinel/contracts';
// Value import, not `import type`: Nest reads this class from runtime metadata to inject it.
import { AuthService } from './auth.service.js';
import { Roles, SESSION_COOKIE, SessionGuard, type AuthedRequest } from './session.guard.js';
import { loadEnv } from '../config/env.js';

const env = loadEnv();

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const credentials = loginRequestSchema.parse(body);
    const outcome = await this.auth.login(credentials.email, credentials.password);

    if (!outcome.ok) {
      // Deliberately identical for wrong password, unknown email and rate limiting:
      // the response must not tell an attacker which emails exist.
      throw new UnauthorizedException('Email or password is incorrect');
    }

    res.cookie(SESSION_COOKIE, outcome.session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      expires: outcome.session.expiresAt,
      path: '/',
    });

    return { user: outcome.session.user, csrfToken: outcome.session.csrfToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    await this.auth.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Unauthenticated is a valid answer here, not an error. */
  @Get('me')
  async me(@Req() req: Request): Promise<MeResponse> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const resolved = await this.auth.resolveSession(token);
    if (!resolved) return { user: null, csrfToken: null };
    return { user: resolved.user, csrfToken: resolved.csrfToken };
  }

  /** Exists so the guard and session resolution are exercised by a real route. */
  @Get('session-check')
  @UseGuards(SessionGuard)
  check(@Req() req: AuthedRequest): { user: MeResponse['user'] } {
    return { user: req.user ?? null };
  }

  /** Change your own password. Re-verifies the current one; a wrong one is a 400, not a 500. */
  @Post('password')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async changePassword(@Body() body: unknown, @Req() req: AuthedRequest): Promise<{ ok: true }> {
    const { currentPassword, newPassword } = changePasswordRequestSchema.parse(body);
    const outcome = await this.auth.changePassword(req.user!.id, currentPassword, newPassword);
    if (outcome === 'wrong-password') {
      throw new BadRequestException('Your current password is incorrect.');
    }
    return { ok: true };
  }

  /** Update your own name and/or access level; returns the fresh profile the console re-reads. */
  @Post('profile')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async updateProfile(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<{ user: SessionUser }> {
    const patch = updateProfileRequestSchema.parse(body);
    return { user: await this.auth.updateProfile(req.user!.id, patch) };
  }

  /** Mutating and admin-only, so CSRF and role enforcement are both covered by tests. */
  @Post('admin-check')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @Roles('admin')
  adminCheck(@Req() req: AuthedRequest): { user: MeResponse['user'] } {
    return { user: req.user ?? null };
  }
}
