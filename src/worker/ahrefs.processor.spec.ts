import { AhrefsProcessor } from './ahrefs.processor';

function makeProcessor() {
  const enrichment = {
    selectTopPages: jest.fn(),
    enrichPage: jest.fn(),
    enrichSite: jest.fn(),
  };
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

function pageEnrichJob(): ProcessArg {
  return {
    id: '9',
    name: 'page-enrich',
    data: {
      projectId: 1,
      pageId: 55,
      url: 'https://example.com/p',
      domain: 'example.com',
      country: 'th',
      cap: 100_000,
      limit: 30,
    },
  } as unknown as ProcessArg;
}

describe('AhrefsProcessor page-enrich dispatch', () => {
  it("name='page-enrich' → เรียก enrichment.enrichPage(data) (ไม่ fan-out)", async () => {
    const { processor, enrichment, queue } = makeProcessor();
    enrichment.enrichPage.mockResolvedValue({ pageId: 55 });

    const summary = await processor.process(pageEnrichJob());

    expect(enrichment.enrichPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 55, url: 'https://example.com/p' }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ pageId: 55 });
  });
});

function siteEnrichJob(): ProcessArg {
  return {
    id: '10',
    name: 'site-enrich',
    data: {
      projectId: 1,
      domain: 'example.com',
      country: 'th',
      cap: 100_000,
      competitorsLimit: 10,
    },
  } as unknown as ProcessArg;
}

describe('AhrefsProcessor site-enrich dispatch', () => {
  it("name='site-enrich' → เรียก enrichment.enrichSite(data) (ไม่ fan-out)", async () => {
    const { processor, enrichment, queue } = makeProcessor();
    enrichment.enrichSite.mockResolvedValue({ domain: 'example.com' });

    const summary = await processor.process(siteEnrichJob());

    expect(enrichment.enrichSite).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, domain: 'example.com' }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ domain: 'example.com' });
  });
});
