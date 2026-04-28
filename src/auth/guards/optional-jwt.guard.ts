import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * OptionalJwtGuard
 *
 * Used on endpoints that support BOTH authenticated users AND guests
 * (e.g. POST /payments for guest MOMO payments with payerPhone).
 *
 * Rules:
 *   - No Authorization header  → req.user = null  (guest, allowed through)
 *   - Valid JWT                → req.user = { userId, email }  (authenticated)
 *   - Present but invalid/expired JWT → 401  (security: never silently downgrade)
 *
 * Downstream handlers should check `req.user?.userId ?? ''` to detect guests.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser = { userId: string; email: string }>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser | null {
    // Real exception from strategy (e.g. database error) → re-throw
    if (err) throw err;

    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const hasAuthHeader = !!req.headers['authorization'];

    // No Authorization header at all → guest access
    if (!hasAuthHeader) return null;

    // Header present but token is invalid / expired → reject (security boundary)
    if (!user) {
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }

    return user;
  }
}
