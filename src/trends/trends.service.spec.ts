import { TrendsService } from './trends.service';
import type { TrendsRepo } from './trends.repo';

// TrendsService = coerce DECIMAL(string) ของ mysql2 → number + default window 30 วัน
describe('TrendsService', () => {
  const makeRepo = () =>
    ({
      scoreTrend: jest.fn(),
      crawlActivity: jest.fn(),
    }) as unknown as jest.Mocked<TrendsRepo>;

  it('scoreTrend → coerce AVG(string) เป็น number 1 ตำแหน่ง + คง null', async () => {
    const repo = makeRepo();
    repo.scoreTrend.mockResolvedValue([
      {
        crawlId: 1,
        createdAt: new Date('2026-06-01'),
        pagesCrawled: 3,
        avgHealthScore: '72.6666',
        avgKeywordCoverage: null,
      },
    ] as never);
    const svc = new TrendsService(repo);
    const out = await svc.scoreTrend(5, {});
    expect(out.points[0]).toMatchObject({
      crawlId: 1,
      avgHealthScore: 72.7,
      avgKeywordCoverage: null,
    });
  });

  it('crawlActivity → coerce count/SUM + null pages เป็น 0', async () => {
    const repo = makeRepo();
    repo.crawlActivity.mockResolvedValue([
      { day: '2026-06-01', crawls: 2, pagesCrawled: '5' },
      { day: '2026-06-02', crawls: 1, pagesCrawled: null },
    ] as never);
    const svc = new TrendsService(repo);
    const out = await svc.crawlActivity(5, {});
    expect(out.points).toEqual([
      { day: '2026-06-01', crawls: 2, pagesCrawled: 5 },
      { day: '2026-06-02', crawls: 1, pagesCrawled: 0 },
    ]);
  });

  it('default window = 30 วันล่าสุด (to - from ≈ 30 วัน)', async () => {
    const repo = makeRepo();
    repo.scoreTrend.mockResolvedValue([] as never);
    const svc = new TrendsService(repo);
    await svc.scoreTrend(5, {});
    const [, window] = repo.scoreTrend.mock.calls[0];
    const days =
      (window.to.getTime() - window.from.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(30, 0);
  });

  it('ระบุ from/to → ขอบวัน UTC (from=00:00, to=23:59:59.999)', async () => {
    const repo = makeRepo();
    repo.crawlActivity.mockResolvedValue([] as never);
    const svc = new TrendsService(repo);
    await svc.crawlActivity(5, {
      from: '2026-06-01',
      to: '2026-06-08',
    });
    const [, window] = repo.crawlActivity.mock.calls[0];
    expect(window.from.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-06-08T23:59:59.999Z');
  });
});
