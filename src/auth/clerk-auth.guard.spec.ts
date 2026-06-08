import { ClerkAuthGuard } from './clerk-auth.guard';
import { AppException } from '../common/http';

/** ประกอบ ExecutionContext จำลอง + req object ที่ guard เขียน req.user ลงไป. */
function makeCtx(headers: Record<string, string> = {}) {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  };
  return {
    req,
    ctx: ctx as unknown as Parameters<ClerkAuthGuard['canActivate']>[0],
  };
}

interface Overrides {
  config?: Record<string, string>;
  isPublic?: boolean;
}

function makeGuard(over: Overrides = {}) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(over.isPublic ?? false),
  };
  const config = { get: jest.fn((k: string) => over.config?.[k]) };
  const verifier = { verify: jest.fn() };
  const repo = {
    upsertUser: jest
      .fn()
      .mockImplementation((clerkUserId: string, email: string | null) =>
        Promise.resolve({ id: 1, clerkUserId, email: email ?? 'fallback' }),
      ),
  };
  const guard = new ClerkAuthGuard(
    reflector as never,
    config as never,
    verifier as never,
    repo as never,
  );
  return { guard, reflector, config, verifier, repo };
}

// ClerkAuthGuard = secure-by-default (เอกสาร 05 §4): public ข้าม, dev-bypass ตอนไม่มี key,
// verify จริงตอนมี key. ครอบทุกเส้นทาง decision เพื่อกัน regression ของ auth.
describe('ClerkAuthGuard', () => {
  it('@Public → ผ่านโดยไม่แตะ token/repo', async () => {
    const { guard, repo, verifier } = makeGuard({ isPublic: true });
    const { ctx } = makeCtx();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.upsertUser).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('dev-bypass (ไม่มี CLERK_SECRET_KEY, ไม่ใช่ prod) → inject dev user', async () => {
    const { guard, repo } = makeGuard({ config: { NODE_ENV: 'test' } });
    const { ctx, req } = makeCtx();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.upsertUser).toHaveBeenCalledWith(
      'dev_user',
      'dev@rankpilot.local',
    );
    expect(req.user).toEqual({
      id: 1,
      clerkUserId: 'dev_user',
      email: 'dev@rankpilot.local',
    });
  });

  it('cache → upsert ครั้งเดียวข้ามหลาย request', async () => {
    const { guard, repo } = makeGuard({ config: { NODE_ENV: 'test' } });
    await guard.canActivate(makeCtx().ctx);
    await guard.canActivate(makeCtx().ctx);
    expect(repo.upsertUser).toHaveBeenCalledTimes(1);
  });

  it('มี key แต่ไม่มี Bearer → 401 (ไม่เรียก verify)', async () => {
    const { guard, verifier } = makeGuard({
      config: { CLERK_SECRET_KEY: 'sk' },
    });
    await expect(guard.canActivate(makeCtx().ctx)).rejects.toBeInstanceOf(
      AppException,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('มี key + Bearer valid → verify → upsert → req.user', async () => {
    const { guard, verifier, repo } = makeGuard({
      config: { CLERK_SECRET_KEY: 'sk' },
    });
    verifier.verify.mockResolvedValue({
      clerkUserId: 'user_42',
      email: 'a@b.com',
    });
    const { ctx, req } = makeCtx({ authorization: 'Bearer tok123' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('tok123');
    expect(repo.upsertUser).toHaveBeenCalledWith('user_42', 'a@b.com');
    expect(req.user).toEqual({
      id: 1,
      clerkUserId: 'user_42',
      email: 'a@b.com',
    });
  });

  it('prod ไม่มี key → ปฏิเสธ (กันพลาด ไม่ปล่อย bypass)', async () => {
    const { guard, repo } = makeGuard({ config: { NODE_ENV: 'production' } });
    await expect(guard.canActivate(makeCtx().ctx)).rejects.toBeInstanceOf(
      AppException,
    );
    expect(repo.upsertUser).not.toHaveBeenCalled();
  });
});
