import type { ConfigService } from '@nestjs/config';
import { EnrichmentService } from './enrichment.service';
import type { EnrichOrganicJobData } from './enrichment.service';
import type { AhrefsClient } from './ahrefs.client';
import type { AhrefsRepo } from './ahrefs.repo';

function makeService() {
  const ahrefs = { fetch: jest.fn() };
  const repo = {
    upsertKeyword: jest.fn().mockResolvedValue(101),
    findPageByUrlHash: jest.fn().mockResolvedValue(null),
    insertPageKeyword: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: () => 604800 } as unknown as ConfigService;
  const service = new EnrichmentService(
    ahrefs as unknown as AhrefsClient,
    repo as unknown as AhrefsRepo,
    config,
  );
  return { service, ahrefs, repo };
}

const JOB: EnrichOrganicJobData = {
  projectId: 1,
  domain: 'example.com',
  country: 'th',
  limit: 10,
  cap: 100_000,
};

describe('EnrichmentService.enrichOrganicKeywords (flow [2] slice)', () => {
  it('map organic rows → upsert keywords, ข้ามแถวที่ไม่มี keyword', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        keywords: [
          {
            keyword: 'seo',
            volume: '1000',
            difficulty: '42',
            cpc: '1.5',
            traffic_potential: '2000',
          },
          { keyword: '   ' }, // ว่าง → ข้าม
          { volume: 5 }, // ไม่มี keyword → ข้าม
        ],
      },
      unitsSpent: 70,
      rows: 3,
      cached: false,
    });

    const summary = await service.enrichOrganicKeywords(JOB);

    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { endpoint: string; params: Record<string, unknown> },
    ];
    expect(fetchArg.endpoint).toBe('site-explorer/organic-keywords');
    expect(fetchArg.params).toMatchObject({
      target: 'example.com',
      country: 'th',
      limit: 10,
    });
    expect(repo.upsertKeyword).toHaveBeenCalledTimes(1);
    expect(repo.upsertKeyword).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        keyword: 'seo',
        country: 'th',
        searchVolume: 1000,
        difficulty: 42,
        cpc: 1.5,
        trafficPotential: 2000,
      }),
    );
    expect(summary).toMatchObject({
      fetched: 3,
      keywordsUpserted: 1,
      pageKeywordsInserted: 0,
      unitsSpent: 70,
      cached: false,
    });
  });

  it('metric ที่เป็น string ว่าง/ช่องว่าง → null (ไม่ใช่ 0)', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        keywords: [{ keyword: 'seo', volume: '', difficulty: '   ', cpc: '' }],
      },
      unitsSpent: 54,
      rows: 1,
      cached: false,
    });

    await service.enrichOrganicKeywords(JOB);

    // '' / whitespace ต้องถือเป็น "ไม่มีค่า" (null) — ไม่ใช่ Number('')===0 ที่ทำให้
    // keyword ที่ไม่รู้ volume ถูกบันทึกเป็น 0 (เพี้ยนตอนคัด top 20% by traffic).
    expect(repo.upsertKeyword).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'seo',
        searchVolume: null,
        difficulty: null,
        cpc: null,
      }),
    );
  });

  it('insert page_keywords เมื่อ match หน้าที่ crawl มาแล้ว (urlHash)', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        keywords: [
          {
            keyword: 'seo',
            position: '3',
            traffic: '120',
            traffic_value: '45.5',
            best_position_url: 'https://example.com/a',
          },
        ],
      },
      unitsSpent: 54,
      rows: 1,
      cached: false,
    });
    repo.findPageByUrlHash.mockResolvedValue(55);

    const summary = await service.enrichOrganicKeywords(JOB);

    expect(repo.findPageByUrlHash).toHaveBeenCalledWith(1, expect.any(String));
    expect(repo.insertPageKeyword).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 55,
        keywordId: 101,
        position: 3,
        traffic: 120,
        trafficValue: 45.5,
      }),
    );
    expect(summary.pageKeywordsInserted).toBe(1);
  });

  it('ไม่ insert page_keywords เมื่อไม่ match หน้า (best-effort)', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        keywords: [{ keyword: 'seo', best_position_url: 'https://x/y' }],
      },
      unitsSpent: 54,
      rows: 1,
      cached: false,
    });
    // findPageByUrlHash default → null
    const summary = await service.enrichOrganicKeywords(JOB);
    expect(repo.insertPageKeyword).not.toHaveBeenCalled();
    expect(summary.pageKeywordsInserted).toBe(0);
  });

  it('ส่งผ่าน cached/unitsSpent จาก AhrefsClient', async () => {
    const { service, ahrefs } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: { keywords: [] },
      unitsSpent: 0,
      rows: 0,
      cached: true,
    });
    const summary = await service.enrichOrganicKeywords(JOB);
    expect(summary).toMatchObject({
      fetched: 0,
      keywordsUpserted: 0,
      unitsSpent: 0,
      cached: true,
    });
  });
});
