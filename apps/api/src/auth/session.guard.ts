import { ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
// Reflector and AuthService are injected, so they must be value imports: Nest reads the
// constructor's design:paramtypes metadata at runtime, and `import type` erases it.
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import type { Request } from 'express';
import type { Role, SessionUser } from '@sentinel/contracts';

export const SESSION_COOKIE = 'sentinel_session';
export const CSRF_HEADER = 'x-csrf-token';
export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]): MethodDecorator => SetMetadata(ROLES_KEY, roles);

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];

    const resolved = await this.auth.resolveSession(token);
    if (!resolved) throw new UnauthorizedException('Not signed in');

    // Double-submit CSRF: the cookie alone must never be enough to mutate state.
    if (!SAFE_METHODS.has(request.method)) {
      const sent = request.header(CSRF_HEADER);
      if (sent === undefined || sent !== resolved.csrfToken) {
        throw new ForbiddenException('Invalid CSRF token');
      }
    }

    request.user = resolved.user;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== undefined && !required.includes(resolved.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
