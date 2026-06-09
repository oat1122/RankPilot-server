import { CrawlProcessor } from './crawl.processor';
import type { CrawlResult } from '../crawler/crawler.schema';
import { urlHash } from '../common/url';

function makeProcessor() {
  const crawler = { crawl: jest.fn() };
  const repo = {
    createCrawl: jest.fn(),
    persistPage: jest.fn(),
    persistPageWithinCrawl: jest.fn(),
    finishCrawl: jest.fn(),
    projectDomain: jest.fn(),
    markFailed: jest.fn(),
  };
  const storage = { putHtml: jest.fn() };
  const psi = { cwv: jest.fn() };
  const sitemap = { discover: jest.fn() };
  const config = { get: jest.fn() };
  const processor = new CrawlProcessor(
    crawler as unknown as ConstructorParameters<typeof CrawlProcessor>[0],
    repo as unknown as ConstructorParameters<typeof CrawlProcessor>[1],
    storage as unknown as ConstructorParameters<typeof CrawlProcessor>[2],
    psi as unknown as ConstructorParameters<typeof CrawlProcessor>[3],
    sitemap as unknown as ConstructorParameters<typeof CrawlProcessor>[4],
    config as unknown as ConstructorParameters<typeof CrawlProcessor>[5],
  );
  return { processor, crawler, repo, storage, psi, sitemap, config };
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

function siteJob(data: {
  mode: 'site';
  projectId: number;
  maxPages: number;
}): ProcessArg {
  return { id: 's1', name: 'site-crawl', data } as unknown as ProcessArg;
}

const SITE_RESULT = {
  url: 'https://example.com/',
  finalUrl: 'https://example.com/',
  httpStatus: 200,
  links: [
    {
      url: 'https://example.com/a',
      anchorText: 'a',
      rel: null,
      isInternal: true,
    },
    {
      url: 'https://example.com/b',
      anchorText: 'b',
      rel: null,
      isInternal: true,
    },
    {
      url: 'https://other.com/x',
      anchorText: 'x',
      rel: null,
      isInternal: false,
    },
  ],
  imageRows: [],
  images: { total: 0, missingAlt: 0 },
  wordCount: 0,
} as unknown as CrawlResult;

describe('CrawlProcessor.process (site)', () => {
  it('site: discover sitemap → BFS internal links จนถึง maxPages → persist หลายหน้า + finishCrawl', async () => {
    const { processor, crawler, repo, storage, sitemap, config } =
      makeProcessor();
    repo.projectDomain.mockResolvedValue('example.com');
    config.get.mockReturnValue(200); // CRAWLER_SITE_MAX_PAGES hard cap
    sitemap.discover.mockResolvedValue(['https://example.com/']);
    crawler.crawl.mockImplementation((u: string) =>
      Promise.resolve({
        result: { ...SITE_RESULT, url: u, finalUrl: u },
        rawHtml: '<html>',
      }),
    );
    storage.putHtml.mockResolvedValue('k');
    repo.createCrawl.mockResolvedValue(99);
    repo.persistPageWithinCrawl.mockResolvedValue({ pageId: 1, snapshotId: 1 });
    repo.finishCrawl.mockResolvedValue(undefined);

    const out = (await processor.process(
      siteJob({ mode: 'site', projectId: 1, maxPages: 2 }),
    )) as { crawlId: number; pagesCrawled: number };

    expect(sitemap.discover).toHaveBeenCalledWith('example.com');
    expect(repo.persistPageWithinCrawl).toHaveBeenCalledTimes(2); // maxPages=2
    expect(out.pagesCrawled).toBe(2);
    expect(repo.finishCrawl).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ pagesCrawled: 2 }),
    );
  });

  it('site: ไม่พบ domain ของ project → throw', async () => {
    const { processor, repo, config } = makeProcessor();
    config.get.mockReturnValue(200);
    repo.projectDomain.mockResolvedValue(null);
    await expect(
      processor.process(siteJob({ mode: 'site', projectId: 9, maxPages: 5 })),
    ).rejects.toThrow();
  });
});
