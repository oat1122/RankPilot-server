import { AnalysisRunner } from './analysis.runner';
import type { AnalysisRepo, PageSignals, SnapshotRow } from './analysis.repo';
import { AppException, ErrorCode } from '../common/http';

/** snapshot row "สะอาด" — override เฉพาะที่ทดสอบ. */
function snap(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    snapshotId: 10,
    pageId: 1,
    url: 'https://example.com/best-running-shoes',
    isIndexable: true,
    httpStatus: 200,
    title: 'Best Running Shoes for Beginners 2026',
    metaDescription: 'Guide to the best running shoes.',
    h1: 'Best Running Shoes',
    headings: { h1: ['Best Running Shoes'], h2: ['Top picks'], h3: [] },
    paragraphs: ['We review the best running shoes.'],
    wordCount: 800,
    robotsMeta: null,
    imagesTotal: 2,
    imagesMissingAlt: 0,
    lcpMs: 1500,
    clsX1000: 40,
    inpMs: 100,
    ...over,
  };
}

/**
 * mock repo เป็น plain object ของ jest.fn() (ไม่ cast เป็น jest.Mocked<AnalysisRepo>
 * เพื่อเลี่ยง unbound-method ตอน assert) — cast เป็น AnalysisRepo เฉพาะตอนส่งเข้า runner.
 */
function mockRepo(over: Partial<Record<keyof AnalysisRepo, jest.Mock>> = {}) {
  return {
    latestCrawlId: jest.fn(),
    snapshotsForCrawl: jest.fn().mockResolvedValue([]),
    pageSignalsForCrawl: jest
      .fn()
      .mockResolvedValue(new Map<number, PageSignals>()),
    inboundInternalCountByPage: jest.fn().mockResolvedValue(new Map()),
    upsertScore: jest.fn().mockResolvedValue(undefined),
    clearFindingsForCrawl: jest.fn().mockResolvedValue(undefined),
    insertFindings: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** สร้าง runner จาก mock (cast เฉพาะที่ DI boundary). */
function makeRunner(repo: ReturnType<typeof mockRepo>): AnalysisRunner {
  return new AnalysisRunner(repo as unknown as AnalysisRepo);
}

describe('AnalysisRunner', () => {
  it('โยน ANALYSIS_NO_CRAWL เมื่อ project ไม่มี crawl', async () => {
    const repo = mockRepo({ latestCrawlId: jest.fn().mockResolvedValue(null) });
    const runner = makeRunner(repo);
    await expect(runner.analyzeCrawl({ projectId: 5 })).rejects.toMatchObject({
      constructor: AppException,
    });
    await runner.analyzeCrawl({ projectId: 5 }).catch((e: AppException) => {
      expect(e.code).toBe(ErrorCode.ANALYSIS_NO_CRAWL);
    });
  });

  it('resolve crawl ล่าสุดเมื่อไม่ระบุ crawlId', async () => {
    const repo = mockRepo({
      latestCrawlId: jest.fn().mockResolvedValue(77),
      snapshotsForCrawl: jest.fn().mockResolvedValue([snap()]),
    });
    const runner = makeRunner(repo);
    const out = await runner.analyzeCrawl({ projectId: 5 });
    expect(repo.latestCrawlId).toHaveBeenCalledWith(5);
    expect(repo.snapshotsForCrawl).toHaveBeenCalledWith(77);
    expect(out.crawlId).toBe(77);
  });

  it('โยน ANALYSIS_NO_CRAWL เมื่อ crawl ที่ resolve ได้ไม่มี snapshot (ยังไม่เสร็จ/ล้ม)', async () => {
    const repo = mockRepo({
      snapshotsForCrawl: jest.fn().mockResolvedValue([]),
    });
    const runner = makeRunner(repo);
    await runner
      .analyzeCrawl({ projectId: 5, crawlId: 42 })
      .then(() => {
        throw new Error('ควรโยน ANALYSIS_NO_CRAWL');
      })
      .catch((e: AppException) => {
        expect(e).toBeInstanceOf(AppException);
        expect(e.code).toBe(ErrorCode.ANALYSIS_NO_CRAWL);
      });
    // ต้องไม่เขียนอะไรลง DB เมื่อไม่มี snapshot
    expect(repo.upsertScore).not.toHaveBeenCalled();
    expect(repo.insertFindings).not.toHaveBeenCalled();
  });

  it('ไม่สร้าง orphan เมื่อ crawl มีหน้าเดียว (single-URL → multiPage=false)', async () => {
    const only = snap({ snapshotId: 10, pageId: 1 });
    const repo = mockRepo({
      snapshotsForCrawl: jest.fn().mockResolvedValue([only]),
      inboundInternalCountByPage: jest.fn().mockResolvedValue(new Map()), // 0 inbound
    });
    const runner = makeRunner(repo);
    const out = await runner.analyzeCrawl({ projectId: 5, crawlId: 99 });
    expect(out.pagesAnalyzed).toBe(1);
    expect(out.byType.orphan ?? 0).toBe(0); // หน้าเดียว → ไม่ flag orphan ปลอม
  });

  it('คำนวณ score ทุกหน้า + สร้าง orphan finding ให้หน้าที่ไม่มี inbound link', async () => {
    const clean = snap({ snapshotId: 10, pageId: 1 });
    const orphan = snap({
      snapshotId: 20,
      pageId: 2,
      url: 'https://example.com/lonely',
    });
    const signals = new Map<number, PageSignals>([
      [1, { primaryKeyword: 'best running shoes', pageTraffic: 100 }],
      [2, { primaryKeyword: null, pageTraffic: 0 }],
    ]);
    const inbound = new Map<number, number>([[1, 3]]); // page 2 = orphan

    const repo = mockRepo({
      snapshotsForCrawl: jest.fn().mockResolvedValue([clean, orphan]),
      pageSignalsForCrawl: jest.fn().mockResolvedValue(signals),
      inboundInternalCountByPage: jest.fn().mockResolvedValue(inbound),
    });
    const runner = makeRunner(repo);
    const out = await runner.analyzeCrawl({ projectId: 5, crawlId: 99 });

    expect(out.pagesAnalyzed).toBe(2);
    expect(out.scoresUpserted).toBe(2);
    expect(repo.upsertScore).toHaveBeenCalledTimes(2);
    expect(out.byType.orphan).toBe(1);
    expect(out.findingsCreated).toBe(1);

    // idempotent: clear ก่อน insert
    const clearOrder = repo.clearFindingsForCrawl.mock.invocationCallOrder[0];
    const insertOrder = repo.insertFindings.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(insertOrder);
    expect(repo.clearFindingsForCrawl).toHaveBeenCalledWith(5, 99);

    const calls = repo.insertFindings.mock.calls as unknown as Array<
      [Array<{ pageId: number; type: string; crawlId: number }>]
    >;
    const inserted = calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      pageId: 2,
      type: 'orphan',
      crawlId: 99,
    });
  });
});
