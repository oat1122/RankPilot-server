import { AiRunner } from './ai.runner';
import type { AiRepo } from './ai.repo';
import type { AiConfigRepo } from './ai-config.repo';
import type { PageAuditEngine } from './page-audit/engine';
import type { PageAuditStateType } from './page-audit/state';

const MODEL_MAP = {
  reasoner: 'anthropic/claude-opus-4.8',
  worker: 'anthropic/claude-sonnet-4.6',
  cheap: 'anthropic/claude-haiku-4.5',
};

function mockRepo(over: Partial<Record<keyof AiRepo, jest.Mock>> = {}) {
  return {
    createRun: jest.fn().mockResolvedValue(99),
    failRun: jest.fn().mockResolvedValue(undefined),
    setAwaitingReview: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function mockConfigRepo() {
  return { resolveModelMap: jest.fn().mockResolvedValue(MODEL_MAP) };
}

/** stub PageAuditEngine (inject ผ่าน constructor) — มॉค run/resume/cleanup. */
function stubEngine(over: {
  run?: jest.Mock;
  resume?: jest.Mock;
  cleanup?: jest.Mock;
}): PageAuditEngine {
  return {
    run: over.run ?? jest.fn(),
    resume: over.resume ?? jest.fn(),
    cleanup: over.cleanup ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as PageAuditEngine;
}

function makeRunner(
  repo: ReturnType<typeof mockRepo>,
  engine: PageAuditEngine,
  configRepo: ReturnType<typeof mockConfigRepo> = mockConfigRepo(),
): AiRunner {
  return new AiRunner(
    repo as unknown as AiRepo,
    configRepo as unknown as AiConfigRepo,
    engine,
  );
}

const doneState = {
  pageId: 5,
  diagnosis: { primaryKeyword: 'kw', reasoning: 'r', issues: [] },
  draft: { title: 'T', metaDescription: 'M', rationale: 'w' },
  priority: 10,
  draftAttempts: 2,
  tokensIn: 100,
  tokensOut: 50,
} as unknown as PageAuditStateType;

describe('AiRunner.auditPage', () => {
  it('ไม่ interrupt (HITL ปิด/persist แล้ว) → createRun → run engine → done summary', async () => {
    const repo = mockRepo();
    const run = jest.fn().mockResolvedValue({
      state: doneState,
      interrupted: false,
    });
    const runner = makeRunner(repo, stubEngine({ run }));

    const out = await runner.auditPage({ projectId: 1, pageId: 5, crawlId: 3 });

    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, pageId: 5, graph: 'page_audit' }),
    );
    const createArgs = repo.createRun.mock.calls[0] as unknown as [
      { models: Record<string, string> },
    ];
    expect(createArgs[0].models).toMatchObject({
      reasoner: 'anthropic/claude-opus-4.8',
      worker: 'anthropic/claude-sonnet-4.6',
      cheap: 'anthropic/claude-haiku-4.5',
    });

    const runArgs = run.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
    ];
    expect(runArgs[0]).toMatchObject({
      pageId: 5,
      projectId: 1,
      runId: 99,
      crawlId: 3,
    });
    expect(runArgs[1]).toBe('page:5:run:99'); // thread_id

    expect(repo.setAwaitingReview).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      projectId: 1,
      pageId: 5,
      runId: 99,
      recommendationsCreated: 4, // diagnosis/title_draft/meta_draft/priority
      draftAttempts: 2,
      tokensIn: 100,
      tokensOut: 50,
      status: 'done',
    });
  });

  it('interrupt (HITL) → setAwaitingReview(proposal+tokens) → summary awaiting_review (recs=0)', async () => {
    const repo = mockRepo();
    const run = jest.fn().mockResolvedValue({
      state: doneState,
      interrupted: true,
    });
    const runner = makeRunner(repo, stubEngine({ run }));

    const out = await runner.auditPage({ projectId: 1, pageId: 5 });

    expect(repo.setAwaitingReview).toHaveBeenCalledTimes(1);
    const [runId, payload] = repo.setAwaitingReview.mock.calls[0] as [
      number,
      {
        reviewPayload: { type: string }[];
        tokensIn: number;
        tokensOut: number;
      },
    ];
    expect(runId).toBe(99);
    expect(payload.tokensIn).toBe(100);
    expect(payload.tokensOut).toBe(50);
    expect(payload.reviewPayload.map((r) => r.type)).toContain('diagnosis');
    expect(out).toMatchObject({
      runId: 99,
      recommendationsCreated: 0,
      status: 'awaiting_review',
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it('engine.run โยน → failRun(runId) + cleanup(threadId) แล้ว rethrow', async () => {
    const repo = mockRepo();
    const boom = new Error('llm down');
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const runner = makeRunner(
      repo,
      stubEngine({ run: jest.fn().mockRejectedValue(boom), cleanup }),
    );

    await expect(runner.auditPage({ projectId: 1, pageId: 5 })).rejects.toBe(
      boom,
    );
    expect(repo.failRun).toHaveBeenCalledWith(99);
    // run ล้ม → checkpoint ใช้ resume ไม่ได้ ต้องลบกัน ai_checkpoints บวม (เช่น LLM 402/429)
    expect(cleanup).toHaveBeenCalledWith('page:5:run:99');
  });
});

describe('AiRunner.resumeReview', () => {
  it('approve → resume → cleanup → done summary (recs จาก toRecommendationRows)', async () => {
    const repo = mockRepo();
    const resume = jest.fn().mockResolvedValue({
      ...doneState,
      reviewDecision: 'approve',
    });
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const runner = makeRunner(repo, stubEngine({ resume, cleanup }));

    const out = await runner.resumeReview({
      projectId: 1,
      pageId: 5,
      runId: 99,
      decision: 'approve',
    });

    expect(resume.mock.calls[0]).toEqual(['page:5:run:99', 'approve']);
    expect(cleanup).toHaveBeenCalledWith('page:5:run:99');
    expect(out).toMatchObject({
      runId: 99,
      recommendationsCreated: 4,
      status: 'done',
    });
  });

  it('reject → recommendationsCreated=0 (ทิ้ง draft) แต่ยัง cleanup', async () => {
    const repo = mockRepo();
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const resume = jest.fn().mockResolvedValue({
      ...doneState,
      reviewDecision: 'reject',
    });
    const runner = makeRunner(repo, stubEngine({ resume, cleanup }));

    const out = await runner.resumeReview({
      projectId: 1,
      pageId: 5,
      runId: 99,
      decision: 'reject',
    });

    expect(out.recommendationsCreated).toBe(0);
    expect(out.status).toBe('done');
    expect(cleanup).toHaveBeenCalledWith('page:5:run:99');
  });

  it('engine.resume โยน → failRun(runId) แล้ว rethrow', async () => {
    const repo = mockRepo();
    const boom = new Error('resume failed');
    const runner = makeRunner(
      repo,
      stubEngine({ resume: jest.fn().mockRejectedValue(boom) }),
    );

    await expect(
      runner.resumeReview({
        projectId: 1,
        pageId: 5,
        runId: 99,
        decision: 'approve',
      }),
    ).rejects.toBe(boom);
    expect(repo.failRun).toHaveBeenCalledWith(99);
  });
});
