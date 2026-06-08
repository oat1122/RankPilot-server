import { AuthRepo } from './auth.repo';
import { AppException, ErrorCode } from '../common/http';

type Row = {
  id: number;
  clerkUserId: string | null;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
};

/**
 * mock Drizzle handle — chain select().from().where().limit() คืนผลจาก selectQueue (shift ต่อ
 * query), update().set().where() บันทึก set ที่ calls.updates, insert().values().$returningId()
 * คืน id คงที่. พอสำหรับทดสอบ branching ของ resolveUser โดยไม่ต้องต่อ DB จริง.
 */
function makeDb(selectQueue: Row[][]) {
  const calls = {
    updates: [] as Record<string, unknown>[],
    inserts: [] as Record<string, unknown>[],
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        calls.inserts.push(v);
        return { $returningId: () => Promise.resolve([{ id: 99 }]) };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          calls.updates.push(s);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return { db, calls };
}

const activeUser = (over: Partial<Row> = {}): Row => ({
  id: 1,
  clerkUserId: 'c1',
  email: 'e@x.com',
  role: 'user',
  status: 'active',
  ...over,
});

// resolveUser = หัวใจ "ไม่มี self sign-up" (allowlist + soft-disable + env-admin authority).
// ครอบทั้ง 6 สาขาเพื่อกัน regression ของ security boundary.
describe('AuthRepo.resolveUser', () => {
  it('[1] เจอด้วย clerk id → คืน user เดิม (ไม่ update)', async () => {
    const { db, calls } = makeDb([[activeUser()]]);
    const repo = new AuthRepo(db as never);
    const u = await repo.resolveUser({
      clerkUserId: 'c1',
      email: 'e@x.com',
      provisionAsAdmin: false,
    });
    expect(u).toEqual({
      id: 1,
      clerkUserId: 'c1',
      email: 'e@x.com',
      role: 'user',
    });
    expect(calls.updates).toHaveLength(0);
  });

  it('[2] ไม่เจอ clerk แต่เจอ invite ด้วย email (clerk=null) → bind clerk id', async () => {
    const invite = activeUser({ id: 2, clerkUserId: null, email: 'inv@x.com' });
    const { db, calls } = makeDb([[], [invite]]);
    const repo = new AuthRepo(db as never);
    const u = await repo.resolveUser({
      clerkUserId: 'fresh_clerk',
      email: 'inv@x.com',
      provisionAsAdmin: false,
    });
    expect(u).toMatchObject({
      id: 2,
      clerkUserId: 'fresh_clerk',
      role: 'user',
    });
    expect(calls.updates).toContainEqual({ clerkUserId: 'fresh_clerk' });
  });

  it('[3] ไม่มีใน DB + provisionAsAdmin → สร้าง admin ใหม่ (active)', async () => {
    const { db, calls } = makeDb([[], []]);
    const repo = new AuthRepo(db as never);
    const u = await repo.resolveUser({
      clerkUserId: 'boss',
      email: 'admin@x.com',
      provisionAsAdmin: true,
    });
    expect(u).toEqual({
      id: 99,
      clerkUserId: 'boss',
      email: 'admin@x.com',
      role: 'admin',
    });
    expect(calls.inserts).toContainEqual({
      clerkUserId: 'boss',
      email: 'admin@x.com',
      role: 'admin',
      status: 'active',
    });
  });

  it('[4] ไม่อยู่ allowlist (ไม่เจอ + ไม่ใช่ admin) → USER_NOT_PROVISIONED', async () => {
    const { db } = makeDb([[], []]);
    const repo = new AuthRepo(db as never);
    const err = await repo
      .resolveUser({
        clerkUserId: 'stranger',
        email: 'no@x.com',
        provisionAsAdmin: false,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ErrorCode.USER_NOT_PROVISIONED);
  });

  it('[5] บัญชีถูก disable → USER_DISABLED', async () => {
    const { db } = makeDb([[activeUser({ status: 'disabled' })]]);
    const repo = new AuthRepo(db as never);
    await expect(
      repo.resolveUser({
        clerkUserId: 'c1',
        email: 'e@x.com',
        provisionAsAdmin: false,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_DISABLED });
  });

  it('[6] user เดิม + provisionAsAdmin (env authority) → ยกระดับเป็น admin', async () => {
    const { db, calls } = makeDb([[activeUser({ role: 'user' })]]);
    const repo = new AuthRepo(db as never);
    const u = await repo.resolveUser({
      clerkUserId: 'c1',
      email: 'e@x.com',
      provisionAsAdmin: true,
    });
    expect(u.role).toBe('admin');
    expect(calls.updates).toContainEqual({ role: 'admin' });
  });
});
