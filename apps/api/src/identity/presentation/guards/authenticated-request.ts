import type { AuthPrincipal } from '@aegisflow/contracts';
import type { Request } from 'express';

export type AuthenticatedRequest = Request & { principal?: AuthPrincipal };
