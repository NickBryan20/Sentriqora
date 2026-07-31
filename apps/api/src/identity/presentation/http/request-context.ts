import type { Request } from 'express';

import type { RequestContext } from '../../application/identity.use-cases';

export function requestContext(request: Request): RequestContext {
  return {
    correlationId: request.header('x-correlation-id') ?? 'unavailable',
    ipAddress: request.ip || request.socket.remoteAddress || '0.0.0.0',
    userAgent: (request.header('user-agent') ?? 'unknown-client').slice(0, 512),
  };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.header('cookie');
  if (header === undefined) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const cookieName = part.slice(0, separator).trim();
    if (cookieName === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
