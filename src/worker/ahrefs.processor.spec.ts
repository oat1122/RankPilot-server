import { AhrefsProcessor } from './ahrefs.processor';

function makeProcessor() {
  const enrichment = { selectTopPages: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const processor = new AhrefsProcessor(
    enrichment as unknown as ConstructorParameters<typeof AhrefsProcessor>[0],
    queue as unknown as ConstructorParameters<typeof AhrefsProcessor>[1],
  );
  return { processor, enrichment, queue };
}

type ProcessArg = Parameters<AhrefsProcessor['process']>[0];

const TOP_SUMMARY = {
  projectId: 1,
  domain: 'example.com',
  fetched: 5,
  topCount: 2,
  topPages: [
    { url: 'https://example.com/a', traffic: 500, topKeyword: 'a' },
    { url: 'https://example.com/b', traffic: 300, topKeyword: 'b' },
  ],
  unitsSpent: 80,
  cached: false,
};

function topPagesJob(enrichSelected?: boolean): ProcessArg {
  return {
    id: '1',
    name: 'top-pages',
    data: {
      projectId: 1,
      domain: 'example.com',
      country: 'th',
      limit: 100,
      cap: 100_000,
      ...(enrichSelected !== undefined ? { enrichSelected } : {}),
    },
  } as unknown as ProcessArg;
}

describe('AhrefsProcessor top-pages orchestration (เอกสาร 03a §8)', () => {
  it('enrichSelected=true → fan-out organic exact ต่อ topPage', async () => {
    const { processor, enrichment, queue } = makeProcessor();
    enrichment.selectTopPages.mockResolvedValue(TOP_SUMMARY);

    const summary = await processor.process(topPagesJob(true));

    expect(enrichment.selectTopPages).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'enrich-organic',
      expect.objectContaining({
        projectId: 1,
        domain: 'example.com',
        target: 'https://example.com/a',
        mode: 'exact',
      }),
    );
    expect(summary).toMatchObject({ topCount: 2 });
  });

  it('ไม่ได้ตั้ง enrichSelected → ไม่ fan-out', async () => {
    const { processor, enrichment, queue } = makeProcessor();
    enrichment.selectTopPages.mockResolvedValue({
      ...TOP_SUMMARY,
      topCount: 1,
      topPages: [TOP_SUMMARY.topPages[0]],
    });

    await processor.process(topPagesJob());

    expect(queue.add).not.toHaveBeenCalled();
  });
});
