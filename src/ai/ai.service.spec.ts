import { AiService } from './ai.service';
import type { ConfigService } from '@nestjs/config';
import type { AiRepo } from './ai.repo';
import { ErrorCode } from '../common/http';
import type { ReviewRunDto } from './dto/create-ai-audit.dto';

function makeService(
  over: {
    reviewableRun?: {
      id: number;
      pageId: number | null;
      status: string;
    } | null;
  } = {},
) {
  const add = jest.fn().mockResolvedValue({ id: 'job-1' });
  const queue = { on: jest.fn(), add };
  // เลือกค่าตาม key จริง (ไม่งั้น withTimeout ได้ object → NaN timer)
  const cfg: Record<string, unknown> = { QUEUE_ENQUEUE_TIMEOUT_MS: 5000 };
  const config = {
    get: (k: string) => cfg[k],
  } as unknown as ConfigService;
  const repo = {
    getReviewableRun: jest
      .fn()
      .mockResolvedValue(
        'reviewableRun' in over
          ? over.reviewableRun
          : { id: 7, pageId: 5, status: 'awaiting_review' },
      ),
  };
  const service = new AiService(
    queue as unknown as ConstructorParameters<typeof AiService>[0],
    config,
    repo as unknown as AiRepo,
  );
  return { service, add, repo };
}

const APPROVE = { decision: 'approve' } as ReviewRunDto;

describe('AiService.review (HITL resume enqueue)', () => {
  // regression: ก่อนแก้ enqueue ไม่มี jobId → กดอนุมัติซ้ำ/retry สร้าง resume job หลายตัว →
  // persistRun เขียน ai_recommendations ซ้ำ. jobId คงที่ให้ BullMQ dedupe.
  it('enqueue resume-review ด้วย jobId คงที่ต่อ run (resume:<runId>)', async () => {
    const { service, add } = makeService();

    await service.review(1, 7, APPROVE);

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(name).toBe('resume-review');
    expect(data).toMatchObject({ runId: 7, pageId: 5, decision: 'approve' });
    expect(opts).toEqual({ jobId: 'resume:7' });
  });

  it('run ไม่อยู่สถานะ awaiting_review → โยน AI_RUN_NOT_REVIEWABLE ไม่ enqueue', async () => {
    const { service, add } = makeService({
      reviewableRun: { id: 7, pageId: 5, status: 'done' },
    });
    await expect(service.review(1, 7, APPROVE)).rejects.toMatchObject({
      code: ErrorCode.AI_RUN_NOT_REVIEWABLE,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('run ไม่พบ → โยน AI_RUN_NOT_FOUND ไม่ enqueue', async () => {
    const { service, add } = makeService({ reviewableRun: null });
    await expect(service.review(1, 7, APPROVE)).rejects.toMatchObject({
      code: ErrorCode.AI_RUN_NOT_FOUND,
    });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('AiService.enqueue (userId snapshot ลง ai_runs)', () => {
  // acceptance: ใครสั่ง audit ต้องถูกบันทึก → usage analytics ต่อคนได้ (Phase 6 AI Settings).
  it('แนบ userId (จาก @CurrentUser) ลง job data ของทุกเพจที่ fan-out', async () => {
    const addBulk = jest.fn().mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
    const queue = { on: jest.fn(), addBulk };
    const cfg: Record<string, unknown> = { QUEUE_ENQUEUE_TIMEOUT_MS: 5000 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService;
    const repo = {
      projectExists: jest.fn().mockResolvedValue(true),
      latestCrawlId: jest.fn().mockResolvedValue(9),
      pageIdsForCrawl: jest.fn().mockResolvedValue([5, 6]),
    };
    const service = new AiService(
      queue as unknown as ConstructorParameters<typeof AiService>[0],
      config,
      repo as unknown as AiRepo,
    );

    await service.enqueue(1, {}, 77);

    expect(addBulk).toHaveBeenCalledTimes(1);
    const [jobs] = addBulk.mock.calls[0] as [
      Array<{ name: string; data: Record<string, unknown> }>,
    ];
    expect(jobs).toHaveLength(2);
    for (const j of jobs)
      expect(j.data).toMatchObject({ projectId: 1, crawlId: 9, userId: 77 });
    expect(jobs.map((j) => j.data.pageId)).toEqual([5, 6]);
  });
});
