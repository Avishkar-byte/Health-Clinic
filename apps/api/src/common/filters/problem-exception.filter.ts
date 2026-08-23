import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * RFC 7807 problem+json error responses.
 * Every 4xx carries a machine-readable `code` so the frontend can recover.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'object' && exResponse !== null) {
        const obj = exResponse as Record<string, unknown>;
        title = (obj['title'] as string) || (obj['error'] as string) || exception.message;
        detail = (obj['detail'] as string) || (obj['message'] as string) || undefined;
        code = (obj['code'] as string) || undefined;

        // Handle class-validator errors
        if (Array.isArray(obj['message'])) {
          detail = (obj['message'] as string[]).join('; ');
          code = 'VALIDATION_ERROR';
        }
      } else {
        title = exResponse as string;
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
    }

    const problem = {
      type: `https://api.healthcare.app/problems/${code?.toLowerCase() || 'internal-error'}`,
      title,
      status,
      ...(detail && { detail }),
      ...(code && { code }),
      instance: request.url,
    };

    response
      .status(status)
      .header('Content-Type', 'application/problem+json')
      .json(problem);
  }
}
