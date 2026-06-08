import { AiRunner } from './ai.runner';
import type { AiRepo } from './ai.repo';
import type { PageAuditGraph } from './page-audit/graph';
import type { PageAuditStateType } from './page-audit/state';

function mockRepo(over: Partial<Record<keyof AiRepo, jest.Mock>> = {}) {
  return {
    createRun: jest.fn().mockResolvedValue(99),
    failRun: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** stub compiled graph (inject ผ่าน constructor) — มॉคแค่ invoke. */
function stubGraph(invoke: jest.Mock): PageAuditGraph {
  return { invoke } as unknown as PageAuditGraph;
}

function makeRunner(
  repo: ReturnType<typeof mockRepo>,
  graph: PageAuditGraph,
): AiRunner {
  return new AiRunner(repo as unknown as AiRepo, graph);
}

describe('AiRunner.auditPage', () => {
  it('createRun (พร้อม models snapshot) → invoke graph → คืน summary จาก final state', async () => {
    const repo = mockRepo();
    const finalState = {
      pageId: 5,
      diagnosis: { primaryKeyword: 'kw', reasoning: 'r', issues: [] },
      draft: { title: 'T', metaDescription: 'M', rationale: 'w' },
      priority: 10,
      draftAttempts: 2,
      tokensIn: 100,
      tokensOut: 50,
    } as unknown as PageAuditStateType;
    const invoke = jest.fn().mockResolvedValue(finalState);
    const runner = makeRunner(repo, stubGraph(invoke));

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

    const invokeArgs = invoke.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { configurable: { thread_id: string } },
    ];
    expect(invokeArgs[0]).toMatchObject({
      pageId: 5,
      projectId: 1,
      runId: 99,
      crawlId: 3,
    });
    expect(invokeArgs[1].configurable.thread_id).toBe('page:5:run:99');

    expect(out).toMatchObject({
      projectId: 1,
      pageId: 5,
      runId: 99,
      recommendationsCreated: 4,
      draftAttempts: 2,
      tokensIn: 100,
      tokensOut: 50,
      status: 'done',
    });
  });

  it('graph โยน → failRun(runId) แล้ว rethrow', async () => {
    const repo = mockRepo();
    const boom = new Error('llm down');
    const runner = makeRunner(
      repo,
      stubGraph(jest.fn().mockRejectedValue(boom)),
    );

    await expect(runner.auditPage({ projectId: 1, pageId: 5 })).rejects.toBe(
      boom,
    );
    expect(repo.failRun).toHaveBeenCalledWith(99);
  });
});
