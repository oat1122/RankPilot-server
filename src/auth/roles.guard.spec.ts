import { RolesGuard } from './roles.guard';
import { AppException, ErrorCode } from '../common/http';
import type { UserRole } from './auth-user';

function makeCtx(user?: { role: UserRole }) {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as Parameters<RolesGuard['canActivate']>[0];
}

function makeGuard(required: UserRole[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  };
  return new RolesGuard(reflector as never);
}

/** เรียก fn แล้วคืน error ที่ throw (typed unknown) — canActivate เป็น sync. */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e: unknown) {
    return e;
  }
  return undefined;
}

// RolesGuard = RBAC gate หลัง ClerkAuthGuard (req.user.role พร้อม). ครอบ allow/deny/edge.
describe('RolesGuard', () => {
  it('ไม่มี @Roles (undefined) → ผ่าน (ไม่จำกัด)', () => {
    expect(makeGuard(undefined).canActivate(makeCtx({ role: 'user' }))).toBe(
      true,
    );
  });

  it('@Roles ว่าง [] → ผ่าน', () => {
    expect(makeGuard([]).canActivate(makeCtx({ role: 'user' }))).toBe(true);
  });

  it('role ตรง → ผ่าน', () => {
    expect(makeGuard(['admin']).canActivate(makeCtx({ role: 'admin' }))).toBe(
      true,
    );
  });

  it('role ไม่ตรง → FORBIDDEN', () => {
    const err = capture(() =>
      makeGuard(['admin']).canActivate(makeCtx({ role: 'user' })),
    );
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ErrorCode.FORBIDDEN);
  });

  it('ไม่มี user (ใช้ guard ผิดลำดับ) → UNAUTHORIZED', () => {
    const err = capture(() =>
      makeGuard(['admin']).canActivate(makeCtx(undefined)),
    );
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ErrorCode.UNAUTHORIZED);
  });
});
