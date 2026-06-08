import { CrawlProcessor } from './crawl.processor';
import type { CrawlResult } from '../crawler/crawler.schema';
import { urlHash } from '../common/url';

function makeProcessor() {
  const crawler = { crawl: jest.fn() };
  const repo = {
    createCrawl: jest.fn(),
    persistPage: jest.fn(),
    markFailed: jest.fn(),
  };
  const storage = { putHtml: jest.fn() };
  const psi = { cwv: jest.fn() };
  const processor = new CrawlProcessor(
    crawler as unknown as ConstructorParameters<typeof CrawlProcessor>[0],
    repo as unknown as ConstructorParameters<typeof CrawlProcessor>[1],
    storage as unknown as ConstructorParameters<typeof CrawlProcessor>[2],
    psi as unknown as ConstructorParameters<typeof CrawlProcessor>[3],
  );
  return { processor, crawler, repo, storage, psi };
}

type ProcessArg = Parameters<CrawlProcessor['process']>[0];

const RESULT = {
  url: 'https://example.com/',
  finalUrl: 'https://example.com/',
  httpStatus: 200,
  links: [],
  imageRows: [],
  images: { total: 0, missingAlt: 0 },
  wordCount: 0,
} as unknown as CrawlResult;

function job(data: { url: string; projectId?: number }): ProcessArg {
  return { id: '1', name: 'crawl-url', data } as unknown as ProcessArg;
}

describe('CrawlProcessor.process', () => {
  it('ไม่มี projectId → crawl แต่ไม่ persist (คืน result เดิม)', async () => {
    const { processor, crawler, repo } = makeProcessor();
    crawler.crawl.mockResolvedValue({ result: RESULT, rawHtml: '<html>' });

    const out = await processor.process(job({ url: 'https://example.com/' }));

    expect(out).toBe(RESULT);
    expect(repo.createCrawl).not.toHaveBeenCalled();
    expect(repo.persistPage).not.toHaveBeenCalled();
  });

  it('มี projectId → createCrawl → disk → PSI → persistPage (พร้อม key+cwv)', async () => {
    const { processor, crawler, repo, storage, psi } = makeProcessor();
    crawler.crawl.mockResolvedValue({ result: RESULT, rawHtml: '<html>' });
    repo.createCrawl.mockResolvedValue(42);
    storage.putHtml.mockResolvedValue('projects/1/crawls/42/h.html.gz');
    const cwv = { lcpMs: 2500, clsX1000: 150, inpMs: 200 };
    psi.cwv.mockResolvedValue(cwv);
    repo.persistPage.mockResolvedValue({ pageId: 7, snapshotId: 9 });

    await processor.process(job({ url: 'https://example.com/', projectId: 1 }));

    expect(repo.createCrawl).toHaveBeenCalledWith(1, 'api');
    expect(storage.putHtml).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, crawlId: 42, html: '<html>' }),
    );
    expect(psi.cwv).toHaveBeenCalledWith('https://example.com/');
    expect(repo.persistPage).toHaveBeenCalledWith(
      expect.objectContaining({
        crawlId: 42,
        projectId: 1,
        result: RESULT,
        htmlStorageKey: 'projects/1/crawls/42/h.html.gz',
        cwv,
      }),
    );
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('storage key คิดจาก finalUrl (หลัง redirect) ให้ตรง pages.url_hash ไม่ใช่ url ที่ขอ', async () => {
    const { processor, crawler, repo, storage, psi } = makeProcessor();
    const redirected = {
      ...RESULT,
      url: 'https://example.com/old',
      finalUrl: 'https://example.com/new',
    };
    crawler.crawl.mockResolvedValue({ result: redirected, rawHtml: '<html>' });
    repo.createCrawl.mockResolvedValue(42);
    storage.putHtml.mockResolvedValue('k');
    psi.cwv.mockResolvedValue({ lcpMs: null, clsX1000: null, inpMs: null });
    repo.persistPage.mockResolvedValue({ pageId: 7, snapshotId: 9 });

    await processor.process(
      job({ url: 'https://example.com/old', projectId: 1 }),
    );

    expect(storage.putHtml).toHaveBeenCalledWith(
      expect.objectContaining({ urlHash: urlHash('https://example.com/new') }),
    );
  });

  it('persistPage throw → markFailed(crawlId) + rethrow (ไม่กลืน error)', async () => {
    const { processor, crawler, repo, storage, psi } = makeProcessor();
    crawler.crawl.mockResolvedValue({ result: RESULT, rawHtml: '<html>' });
    repo.createCrawl.mockResolvedValue(42);
    storage.putHtml.mockResolvedValue(null);
    psi.cwv.mockResolvedValue({ lcpMs: null, clsX1000: null, inpMs: null });
    repo.persistPage.mockRejectedValue(new Error('db down'));
    repo.markFailed.mockResolvedValue(undefined);

    await expect(
      processor.process(job({ url: 'https://example.com/', projectId: 1 })),
    ).rejects.toThrow('db down');
    expect(repo.markFailed).toHaveBeenCalledWith(42);
  });
});
