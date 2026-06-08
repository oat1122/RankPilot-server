import { ProjectAccessGuard } from './project-access.guard';
import { AppException } from '../common/http';

function makeCtx(params: Record<string, string>, user?: { id: number }) {
  const req = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as Parameters<ProjectAccessGuard['canActivate']>[0];
}

/** db.select().from().where().limit() → rows (chainable mock). */
function makeGuard(rows: { id: number }[]) {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const db = { select };
  return { guard: new ProjectAccessGuard(db as never), select };
}

// ProjectAccessGuard = authz multi-tenant (เอกสาร 05 §4): ผ่านเฉพาะเจ้าของ, ที่เหลือ 404
describe('ProjectAccessGuard', () => {
  it('เจ้าของ → ผ่าน', async () => {
    const { guard } = makeGuard([{ id: 5 }]);
    await expect(
      guard.canActivate(makeCtx({ projectId: '5' }, { id: 7 })),
    ).resolves.toBe(true);
  });

  it('ไม่ใช่เจ้าของ/ไม่มี → PROJECT_NOT_FOUND', async () => {
    const { guard } = makeGuard([]);
    await expect(
      guard.canActivate(makeCtx({ projectId: '5' }, { id: 7 })),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('projectId ไม่ใช่ int บวก → 404 โดยไม่ query', async () => {
    const { guard, select } = makeGuard([]);
    await expect(
      guard.canActivate(makeCtx({ projectId: 'abc' }, { id: 7 })),
    ).rejects.toBeInstanceOf(AppException);
    expect(select).not.toHaveBeenCalled();
  });

  it('ไม่มี req.user (ใช้ guard ผิดลำดับ) → ปฏิเสธ', async () => {
    const { guard } = makeGuard([{ id: 5 }]);
    await expect(
      guard.canActivate(makeCtx({ projectId: '5' }, undefined)),
    ).rejects.toBeInstanceOf(AppException);
  });
});
