import { JobsService } from './jobs.service';

/** queue เปล่า (ทุก getter คืน []) — override เฉพาะ getter ที่ต้องใช้ในแต่ละเทสต์. */
const emptyQueue = () => ({
  on: jest.fn(),
  getActive: jest.fn().mockResolvedValue([]),
  getWaiting: jest.fn().mockResolvedValue([]),
  getDelayed: jest.fn().mockResolvedValue([]),
  getCompleted: jest.fn().mockResolvedValue([]),
  getFailed: jest.fn().mockResolvedValue([]),
});

const makeJob = (over: Record<string, unknown> = {}) => ({
  id: '1',
  name: 'audit-page',
  data: { projectId: 1, pageId: 10, crawlId: 5 },
  timestamp: 1000,
  processedOn: null,
  finishedOn: null,
  failedReason: null,
  ...over,
});

/** db.select({id}).from(projects).where(...) → owned ids. */
const makeDb = (ownedIds: number[]) => ({
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(ownedIds.map((id) => ({ id }))),
    }),
  }),
});

const build = (ownedIds: number[], ai: ReturnType<typeof emptyQueue>) =>
  new JobsService(
    makeDb(ownedIds) as never,
    emptyQueue() as never,
    emptyQueue() as never,
    emptyQueue() as never,
    ai as never,
  );

describe('JobsService', () => {
  it('scope: เก็บเฉพาะงานของโปรเจคที่ user เป็นเจ้าของ + เรียง active→queued→ประวัติ', async () => {
    const ai = emptyQueue();
    ai.getActive.mockResolvedValue([
      makeJob({ id: 'a1', data: { projectId: 1, pageId: 10, crawlId: 5 } }),
    ]);
    ai.getWaiting.mockResolvedValue([
      makeJob({ id: 'a2', data: { projectId: 1, pageId: 11, crawlId: 5 } }),
      makeJob({ id: 'a3', data: { projectId: 99, pageId: 1, crawlId: 9 } }), // ข้าม owner
    ]);
    ai.getCompleted.mockResolvedValue([
      makeJob({
        id: 'a4',
        data: { projectId: 1, pageId: 12, crawlId: 5 },
        finishedOn: 2000,
      }),
    ]);

    const svc = build([1], ai);
    const { items } = await svc.list(7, {});

    expect(items.map((i) => i.id)).toEqual(['a1', 'a2', 'a4']); // proj99 ตกขอบ
    expect(items.map((i) => i.state)).toEqual([
      'active',
      'queued',
      'completed',
    ]);
    expect(items[0].crawlId).toBe(5); // crawlId ติดมาให้ FE จัดกลุ่ม ai_audit
  });

  it('map waiting/delayed → "queued"', async () => {
    const ai = emptyQueue();
    ai.getDelayed.mockResolvedValue([
      makeJob({ id: 'd1', data: { projectId: 1, crawlId: 5 } }),
    ]);
    const svc = build([1], ai);
    const { items } = await svc.list(7, {});
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('queued');
  });

  it('filter projectId/pageId กรองซ้ำ', async () => {
    const ai = emptyQueue();
    ai.getActive.mockResolvedValue([
      makeJob({ id: 'p10', data: { projectId: 1, pageId: 10, crawlId: 5 } }),
      makeJob({ id: 'p11', data: { projectId: 1, pageId: 11, crawlId: 5 } }),
    ]);
    const svc = build([1], ai);
    const { items } = await svc.list(7, { pageId: 11 });
    expect(items.map((i) => i.id)).toEqual(['p11']);
  });

  it('ไม่มีโปรเจค → คืนว่าง โดยไม่สแกนคิว', async () => {
    const ai = emptyQueue();
    const svc = build([], ai);
    const { items } = await svc.list(7, {});
    expect(items).toEqual([]);
    expect(ai.getActive).not.toHaveBeenCalled();
  });

  it('คิวพัง (Redis ล่ม) → คืนว่างของคิวนั้น ไม่ throw', async () => {
    const ai = emptyQueue();
    ai.getActive.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = build([1], ai);
    await expect(svc.list(7, {})).resolves.toEqual({ items: [] });
  });
});
