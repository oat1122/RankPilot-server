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
