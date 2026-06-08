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
  // resolveUser คืน role ตาม provisionAsAdmin (mock allowlist) — สะท้อนพฤติกรรมจริงของ repo.
  const repo = {
    resolveUser: jest
      .fn()
      .mockImplementation(
        (p: {
          clerkUserId: string;
          email: string | null;
          provisionAsAdmin: boolean;
        }) =>
          Promise.resolve({
            id: 1,
            clerkUserId: p.clerkUserId,
            email: p.email ?? 'fallback',
            role: p.provisionAsAdmin ? 'admin' : 'user',
          }),
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

// ClerkAuthGuard = secure-by-default (เอกสาร 05 §4): public ข้าม, dev-bypass(admin) ตอนไม่มี key,
// verify จริง + allowlist resolve ตอนมี key. ครอบทุกเส้นทาง decision เพื่อกัน regression ของ auth.
describe('ClerkAuthGuard', () => {
  it('@Public → ผ่านโดยไม่แตะ token/repo', async () => {
    const { guard, repo, verifier } = makeGuard({ isPublic: true });
    const { ctx } = makeCtx();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.resolveUser).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('dev-bypass (ไม่มี CLERK_SECRET_KEY, ไม่ใช่ prod) → inject dev admin', async () => {
    const { guard, repo } = makeGuard({ config: { NODE_ENV: 'test' } });
    const { ctx, req } = makeCtx();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.resolveUser).toHaveBeenCalledWith({
      clerkUserId: 'dev_user',
      email: 'dev@rankpilot.local',
      provisionAsAdmin: true,
    });
    expect(req.user).toEqual({
      id: 1,
      clerkUserId: 'dev_user',
      email: 'dev@rankpilot.local',
      role: 'admin',
    });
  });

  it('มี key แต่ไม่มี Bearer → 401 (ไม่เรียก verify/resolve)', async () => {
    const { guard, verifier, repo } = makeGuard({
      config: { CLERK_SECRET_KEY: 'sk' },
    });
    await expect(guard.canActivate(makeCtx().ctx)).rejects.toBeInstanceOf(
      AppException,
    );
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(repo.resolveUser).not.toHaveBeenCalled();
  });

  it('มี key + Bearer valid, email ปกติ → resolve เป็น user (provisionAsAdmin=false)', async () => {
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
    expect(repo.resolveUser).toHaveBeenCalledWith({
      clerkUserId: 'user_42',
      email: 'a@b.com',
      provisionAsAdmin: false,
    });
    expect(req.user).toMatchObject({ role: 'user', clerkUserId: 'user_42' });
  });

  it('มี key + email ∈ ADMIN_EMAILS (case-insensitive) → provisionAsAdmin=true', async () => {
    const { guard, verifier, repo } = makeGuard({
      config: { CLERK_SECRET_KEY: 'sk', ADMIN_EMAILS: 'boss@x.com, A@B.com' },
    });
    verifier.verify.mockResolvedValue({ clerkUserId: 'u1', email: 'a@b.com' });
    const { ctx, req } = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(repo.resolveUser).toHaveBeenCalledWith({
      clerkUserId: 'u1',
      email: 'a@b.com',
      provisionAsAdmin: true,
    });
    expect(req.user).toMatchObject({ role: 'admin' });
  });

  it('prod ไม่มี key → ปฏิเสธ (กันพลาด ไม่ปล่อย bypass)', async () => {
    const { guard, repo } = makeGuard({ config: { NODE_ENV: 'production' } });
    await expect(guard.canActivate(makeCtx().ctx)).rejects.toBeInstanceOf(
      AppException,
    );
    expect(repo.resolveUser).not.toHaveBeenCalled();
  });
});
