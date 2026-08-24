import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Turns a schema rejection into 400 rather than 500.
 *
 * Without this, a body that fails `parse()` escapes as an unhandled exception and Nest
 * reports "Internal server error" — which tells the caller the server broke when in fact
 * they sent something invalid, and buries a client bug in the error logs.
 *
 * Only the failing field paths and their messages are returned. The submitted values are
 * not echoed back: a validation error on a login body would otherwise reflect the
 * password straight into the response.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(400).json({
      statusCode: 400,
      message: 'Request body is invalid',
      errors: exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}
