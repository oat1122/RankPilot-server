import type { ConfigService } from '@nestjs/config';
import { EnrichmentService } from './enrichment.service';
import type {
  EnrichOrganicJobData,
  EnrichKeywordsJobData,
  TopPagesJobData,
  CompetitorsJobData,
  SerpOverviewJobData,
  KeywordIdeasJobData,
  BacklinksJobData,
} from './enrichment.service';
import type { AhrefsClient } from './client/ahrefs.client';
import type { AhrefsRepo } from './ahrefs.repo';

function makeService() {
  const ahrefs = { fetch: jest.fn() };
  const repo = {
    upsertKeyword: jest.fn().mockResolvedValue(101),
    findPageByUrlHash: jest.fn().mockResolvedValue(null),
    insertPageKeyword: jest.fn().mockResolvedValue(undefined),
    upsertCompetitor: jest.fn().mockResolvedValue(undefined),
    insertSerpResults: jest.fn().mockResolvedValue(undefined),
    insertContentGap: jest.fn().mockResolvedValue(undefined),
    insertBacklinkSnapshot: jest.fn().mockResolvedValue(undefined),
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

const KW_JOB: EnrichKeywordsJobData = {
  projectId: 1,
  country: 'th',
  keywords: ['seo', 'b', 'seo', '  a  ', ''], // ซ้ำ/มีช่องว่าง/ว่าง → worker จัดให้
  cap: 100_000,
};

const TP_JOB: TopPagesJobData = {
  projectId: 1,
  domain: 'example.com',
  country: 'th',
  limit: 100,
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
            parent_topic: 'search engine optimization',
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
      order_by: 'traffic:desc',
    });
    // date pin กับ period (YYYY-MM-01) → cache key นิ่งทั้งเดือน (เอกสาร 03a §3)
    expect(fetchArg.params.date).toMatch(/^\d{4}-\d{2}-01$/);
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
        parentTopic: 'search engine optimization',
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

describe('EnrichmentService.enrichKeywordOverview (Tier 2 — เอกสาร 03a §4.1)', () => {
  it('dedup+trim+sort keyword, upsert ทุกแถวที่มี keyword, ข้ามแถวว่าง', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        keywords: [
          {
            keyword: 'a',
            volume: '10',
            difficulty: '5',
            cpc: '0.2',
            traffic_potential: '50',
            parent_topic: 'pa',
          },
          { keyword: 'b' },
          { keyword: '  ' }, // ไม่มี keyword → ข้าม
        ],
      },
      unitsSpent: 120,
      rows: 3,
      cached: false,
    });

    const summary = await service.enrichKeywordOverview(KW_JOB);

    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { endpoint: string; params: Record<string, unknown> },
    ];
    expect(fetchArg.endpoint).toBe('keywords-explorer/overview');
    // 'seo' ซ้ำ → ตัด, '  a  ' → 'a', '' → ทิ้ง, แล้ว sort → 'a,b,seo'
    expect(fetchArg.params.keywords).toBe('a,b,seo');
    expect(fetchArg.params).toMatchObject({ country: 'th' });
    expect(fetchArg.params.date).toMatch(/^\d{4}-\d{2}-01$/);
    expect(repo.upsertKeyword).toHaveBeenCalledTimes(2);
    expect(repo.upsertKeyword).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'a',
        country: 'th',
        searchVolume: 10,
        difficulty: 5,
        cpc: 0.2,
        trafficPotential: 50,
        parentTopic: 'pa',
      }),
    );
    expect(summary).toMatchObject({
      requested: 3, // unique keywords
      fetched: 3,
      keywordsUpserted: 2,
      unitsSpent: 120,
      cached: false,
    });
  });
});

describe('EnrichmentService.selectTopPages (Tier 2 — เอกสาร 03a §4.2)', () => {
  it('คัด top 20% by traffic + ทิ้งแถวที่ไม่มี url', async () => {
    const { service, ahrefs } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        pages: [
          { url: 'https://example.com/a', traffic: '100', top_keyword: 'a' },
          { url: 'https://example.com/b', traffic: '500', top_keyword: 'b' },
          { url: 'https://example.com/c', traffic: '50' },
          { url: 'https://example.com/d', traffic: '300' },
          { url: 'https://example.com/e', traffic: '10' },
          { traffic: '999' }, // ไม่มี url → ทิ้ง (ไม่นับ/ไม่ถูกคัด)
        ],
      },
      unitsSpent: 80,
      rows: 6,
      cached: false,
    });

    const summary = await service.selectTopPages(TP_JOB);

    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { endpoint: string; params: Record<string, unknown> },
    ];
    expect(fetchArg.endpoint).toBe('site-explorer/top-pages');
    expect(fetchArg.params).toMatchObject({
      target: 'example.com',
      country: 'th',
      order_by: 'traffic:desc',
    });
    expect(summary.fetched).toBe(5); // url-less row ถูกทิ้ง
    expect(summary.topCount).toBe(1); // ceil(5 * 0.2) = 1
    expect(summary.topPages).toEqual([
      { url: 'https://example.com/b', traffic: 500, topKeyword: 'b' },
    ]);
    expect(summary.unitsSpent).toBe(80);
  });
});

describe('EnrichmentService.enrichOrganicKeywords target/mode (orchestration)', () => {
  it('ส่ง target=URL + mode=exact และ summary.domain = URL', async () => {
    const { service, ahrefs } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: { keywords: [] },
      unitsSpent: 50,
      rows: 0,
      cached: false,
    });
    const summary = await service.enrichOrganicKeywords({
      ...JOB,
      target: 'https://example.com/blog/post',
      mode: 'exact',
    });
    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { params: Record<string, unknown> },
    ];
    expect(fetchArg.params).toMatchObject({
      target: 'https://example.com/blog/post',
      mode: 'exact',
    });
    expect(summary.domain).toBe('https://example.com/blog/post');
  });

  it('ไม่ใส่ mode ลง params เมื่อไม่ระบุ (cache key งาน domain เดิมไม่เปลี่ยน)', async () => {
    const { service, ahrefs } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: { keywords: [] },
      unitsSpent: 50,
      rows: 0,
      cached: false,
    });
    await service.enrichOrganicKeywords(JOB);
    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { params: Record<string, unknown> },
    ];
    expect(fetchArg.params).not.toHaveProperty('mode');
    expect(fetchArg.params.target).toBe('example.com');
  });
});

const COMP_JOB: CompetitorsJobData = {
  projectId: 1,
  domain: 'example.com',
  country: 'th',
  limit: 10,
  cap: 100_000,
};

describe('EnrichmentService.enrichCompetitors (Tier 2 — เอกสาร 03a §4.3)', () => {
  it('upsert คู่แข่งทุกแถวที่มี domain, ข้ามแถวว่าง', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        competitors: [
          { competitor_domain: 'rival-a.com', common_keywords: '120' },
          { competitor_domain: '  ' }, // ว่าง → ข้าม
          { common_keywords: '5' }, // ไม่มี domain → ข้าม
          { competitor_domain: 'rival-b.com' },
        ],
      },
      unitsSpent: 60,
      rows: 4,
      cached: false,
    });

    const summary = await service.enrichCompetitors(COMP_JOB);

    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { endpoint: string; params: Record<string, unknown> },
    ];
    expect(fetchArg.endpoint).toBe('site-explorer/organic-competitors');
    expect(fetchArg.params).toMatchObject({
      target: 'example.com',
      order_by: 'common_keywords:desc',
    });
    expect(repo.upsertCompetitor).toHaveBeenCalledTimes(2);
    expect(repo.upsertCompetitor).toHaveBeenCalledWith(1, 'rival-a.com');
    expect(repo.upsertCompetitor).toHaveBeenCalledWith(1, 'rival-b.com');
    expect(summary).toMatchObject({
      fetched: 4,
      competitorsUpserted: 2,
      unitsSpent: 60,
      cached: false,
    });
  });
});

const SERP_JOB: SerpOverviewJobData = {
  projectId: 1,
  keyword: 'seo tools',
  country: 'th',
  limit: 10,
  cap: 100_000,
};

describe('EnrichmentService.fetchSerpOverview (Tier 3 — เอกสาร 03a §5)', () => {
  it('upsert keyword → insert serp (เติม domain จาก url ถ้าไม่มี), ข้ามแถวไม่ครบ', async () => {
    const { service, ahrefs, repo } = makeService();
    repo.upsertKeyword.mockResolvedValue(202);
    ahrefs.fetch.mockResolvedValue({
      data: {
        serp: [
          { position: '1', url: 'https://a.com/x', domain: 'a.com' },
          { position: '2', url: 'https://b.com/y' }, // ไม่มี domain → เติมจาก url
          { position: '3' }, // ไม่มี url → ข้าม
        ],
      },
      unitsSpent: 150,
      rows: 3,
      cached: false,
    });

    const summary = await service.fetchSerpOverview(SERP_JOB);

    expect(repo.upsertKeyword).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'seo tools', country: 'th' }),
    );
    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { endpoint: string; params: Record<string, unknown> },
    ];
    expect(fetchArg.endpoint).toBe('serp-overview');
    expect(fetchArg.params).toMatchObject({ keyword: 'seo tools' });
    expect(repo.insertSerpResults).toHaveBeenCalledWith([
      { keywordId: 202, position: 1, url: 'https://a.com/x', domain: 'a.com' },
      { keywordId: 202, position: 2, url: 'https://b.com/y', domain: 'b.com' },
    ]);
    expect(summary).toMatchObject({
      keyword: 'seo tools',
      fetched: 3,
      serpInserted: 2,
      unitsSpent: 150,
    });
  });
});

const IDEAS_JOB: KeywordIdeasJobData = {
  projectId: 1,
  seed: 'seo',
  country: 'th',
  limit: 50,
  cap: 100_000,
  mode: 'related',
};

describe('EnrichmentService.fetchKeywordIdeas (Tier 3 — เอกสาร 03a §5)', () => {
  it('related → related-terms endpoint, insert content_gaps ต่อ idea, ข้ามว่าง', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        keywords: [
          { keyword: 'seo tools', volume: '500' },
          { keyword: '   ' }, // ข้าม
          { keyword: 'seo audit', volume: '300' },
        ],
      },
      unitsSpent: 90,
      rows: 3,
      cached: false,
    });

    const summary = await service.fetchKeywordIdeas(IDEAS_JOB);

    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [
      { endpoint: string; params: Record<string, unknown> },
    ];
    expect(fetchArg.endpoint).toBe('keywords-explorer/related-terms');
    expect(fetchArg.params).toMatchObject({
      keywords: 'seo',
      order_by: 'volume:desc',
    });
    expect(repo.insertContentGap).toHaveBeenCalledTimes(2);
    expect(repo.insertContentGap).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, missingSubtopic: 'seo tools' }),
    );
    expect(summary).toMatchObject({
      seed: 'seo',
      mode: 'related',
      fetched: 3,
      gapsInserted: 2,
      unitsSpent: 90,
    });
  });

  it('matching (default) → matching-terms endpoint', async () => {
    const { service, ahrefs } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: { keywords: [] },
      unitsSpent: 50,
      rows: 0,
      cached: false,
    });
    await service.fetchKeywordIdeas({ ...IDEAS_JOB, mode: 'matching' });
    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [{ endpoint: string }];
    expect(fetchArg.endpoint).toBe('keywords-explorer/matching-terms');
  });
});

const BL_JOB: BacklinksJobData = {
  projectId: 1,
  domain: 'example.com',
  country: 'th',
  cap: 100_000,
};

describe('EnrichmentService.fetchBacklinks (Tier 4 — เอกสาร 03a §6)', () => {
  it('แกะ metric เดี่ยวจาก nested object → insert backlink_snapshot', async () => {
    const { service, ahrefs, repo } = makeService();
    ahrefs.fetch.mockResolvedValue({
      data: {
        metrics: {
          domain_rating: '72',
          url_rating: '40',
          referring_domains: '1500',
        },
      },
      unitsSpent: 55,
      rows: 1,
      cached: false,
    });

    const summary = await service.fetchBacklinks(BL_JOB);

    const [fetchArg] = ahrefs.fetch.mock.calls[0] as [{ endpoint: string }];
    expect(fetchArg.endpoint).toBe('site-explorer/metrics');
    expect(repo.insertBacklinkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        pageId: null,
        domainRating: 72,
        urlRating: 40,
        referringDomains: 1500,
      }),
    );
    expect(summary).toMatchObject({
      domain: 'example.com',
      domainRating: 72,
      urlRating: 40,
      referringDomains: 1500,
      unitsSpent: 55,
    });
  });
});
