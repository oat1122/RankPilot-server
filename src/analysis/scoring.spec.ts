import {
  keywordCoverage,
  healthScore,
  detectFindings,
  impactScore,
  TITLE_MAX,
  THIN_CONTENT_WORDS,
  type SnapshotView,
} from './scoring';

/** snapshot "สุขภาพดี" เป็น base — แต่ละเทสต์ override เฉพาะ field ที่สนใจ. */
function healthy(over: Partial<SnapshotView> = {}): SnapshotView {
  return {
    url: 'https://example.com/best-running-shoes',
    httpStatus: 200,
    title: 'Best Running Shoes for Beginners 2026',
    metaDescription: 'A complete guide to the best running shoes.',
    h1: 'Best Running Shoes',
    headings: {
      h1: ['Best Running Shoes'],
      h2: ['Best Running Shoes reviews', 'Top picks'],
      h3: [],
    },
    paragraphs: ['We review the best running shoes for new runners.'],
    wordCount: 800,
    robotsMeta: null,
    isIndexable: true,
    imagesTotal: 4,
    imagesMissingAlt: 0,
    lcpMs: 1800,
    clsX1000: 50,
    inpMs: 120,
    primaryKeyword: 'best running shoes',
    pageTraffic: 100,
    inboundInternalLinks: 3,
    ...over,
  };
}

describe('keywordCoverage', () => {
  it('ครบทั้ง 5 ช่อง → 100', () => {
    const r = keywordCoverage(healthy());
    expect(r.score).toBe(100);
    expect(r.breakdown).toMatchObject({
      title: true,
      url: true,
      h1: true,
      h2: true,
      intro: true,
    });
  });

  it('จับ slug ที่มี hyphen กับ keyword ที่มี space ได้ (normalize)', () => {
    const r = keywordCoverage(
      healthy({
        title: null,
        h1: null,
        headings: { h1: [], h2: [], h3: [] },
        paragraphs: [],
        url: 'https://example.com/best-running-shoes',
      }),
    );
    expect(r.breakdown.url).toBe(true);
    expect(r.score).toBe(20); // เฉพาะ url
  });

  it('keyword อยู่ใน host/โดเมน (EMD) แต่ slug ไม่มี → url = false (ไม่ false +20)', () => {
    const r = keywordCoverage(
      healthy({
        title: null,
        h1: null,
        headings: { h1: [], h2: [], h3: [] },
        paragraphs: [],
        url: 'https://best-running-shoes.com/about', // keyword อยู่ใน host เท่านั้น
        primaryKeyword: 'best running shoes',
      }),
    );
    expect(r.breakdown.url).toBe(false); // เทียบเฉพาะ pathname (/about) → ไม่ match host
    expect(r.score).toBe(0);
  });

  it('ไม่มี primary keyword → score = null', () => {
    const r = keywordCoverage(healthy({ primaryKeyword: null }));
    expect(r.score).toBeNull();
    expect(r.breakdown.keyword).toBeNull();
  });

  it('para1 อ่านจาก paragraphs[0]', () => {
    const r = keywordCoverage(
      healthy({
        title: null,
        url: 'https://example.com/x',
        h1: null,
        headings: { h1: [], h2: [], h3: [] },
        paragraphs: ['intro mentions best running shoes here'],
      }),
    );
    expect(r.breakdown.intro).toBe(true);
    expect(r.score).toBe(20);
  });
});

describe('healthScore', () => {
  it('หน้าสะอาด → 100 ไม่มีการหัก', () => {
    const r = healthScore(healthy());
    expect(r.score).toBe(100);
    expect(r.breakdown.deductions).toHaveLength(0);
  });

  it('หัก http_error + clamp ไม่ต่ำกว่า 0', () => {
    const r = healthScore(
      healthy({
        httpStatus: 500,
        title: null,
        metaDescription: null,
        h1: null,
        wordCount: 0,
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    const reasons = r.breakdown.deductions.map((d) => d.reason);
    expect(reasons).toContain('http_error');
    expect(reasons).toContain('no_title');
    expect(reasons).toContain('no_h1');
  });

  it('missing_alt หักตามสัดส่วน', () => {
    const r = healthScore(healthy({ imagesTotal: 4, imagesMissingAlt: 4 }));
    const d = r.breakdown.deductions.find((x) => x.reason === 'missing_alt');
    expect(d?.points).toBe(15); // 100% ขาด → เต็มเพดาน
  });

  it('noindex หัก 15', () => {
    const r = healthScore(healthy({ robotsMeta: 'noindex, follow' }));
    expect(
      r.breakdown.deductions.find((x) => x.reason === 'noindex')?.points,
    ).toBe(15);
  });
});

describe('impactScore', () => {
  it('severity × (1 + traffic)', () => {
    expect(impactScore('low', 0)).toBe(1);
    expect(impactScore('high', 99)).toBe(3 * 100);
    expect(impactScore('critical', 0)).toBe(4);
  });
});

describe('detectFindings', () => {
  it('หน้าสะอาด → ไม่มี finding', () => {
    expect(detectFindings(healthy())).toHaveLength(0);
  });

  it('orphan: indexable + http ok + ไม่มี inbound internal link (crawl หลายหน้า)', () => {
    const f = detectFindings(healthy({ inboundInternalLinks: 0 }), {
      multiPage: true,
    });
    const orphan = f.find((x) => x.type === 'orphan');
    expect(orphan).toBeDefined();
    expect(orphan?.severity).toBe('high'); // มี traffic → high
  });

  it('ไม่เป็น orphan ถ้า crawl หน้าเดียว (multiPage=false) แม้ inbound=0', () => {
    const f = detectFindings(healthy({ inboundInternalLinks: 0 })); // default multiPage=false
    expect(f.find((x) => x.type === 'orphan')).toBeUndefined();
  });

  it('ไม่เป็น orphan ถ้า noindex', () => {
    const f = detectFindings(
      healthy({ inboundInternalLinks: 0, robotsMeta: 'noindex' }),
      { multiPage: true },
    );
    expect(f.find((x) => x.type === 'orphan')).toBeUndefined();
    expect(f.find((x) => x.type === 'noindex')).toBeDefined();
  });

  it('no_h1 + missing_meta + thin_content', () => {
    const f = detectFindings(
      healthy({
        h1: null,
        headings: { h1: [], h2: [], h3: [] },
        metaDescription: null,
        wordCount: THIN_CONTENT_WORDS - 1,
      }),
    );
    const types = f.map((x) => x.type);
    expect(types).toEqual(
      expect.arrayContaining(['no_h1', 'missing_meta', 'thin_content']),
    );
  });

  it('title_len: หาย=medium, ยาวเกิน=low', () => {
    const missing = detectFindings(healthy({ title: null }));
    expect(missing.find((x) => x.type === 'title_len')?.severity).toBe(
      'medium',
    );

    const tooLong = detectFindings(
      healthy({ title: 'x'.repeat(TITLE_MAX + 5) }),
    );
    expect(tooLong.find((x) => x.type === 'title_len')?.severity).toBe('low');
  });

  it('http_error: 5xx=critical, 4xx=high', () => {
    expect(
      detectFindings(healthy({ httpStatus: 503 })).find(
        (x) => x.type === 'http_error',
      )?.severity,
    ).toBe('critical');
    expect(
      detectFindings(healthy({ httpStatus: 404 })).find(
        (x) => x.type === 'http_error',
      )?.severity,
    ).toBe('high');
  });

  it('multi_h1 เมื่อมี h1 หลายตัว', () => {
    const f = detectFindings(
      healthy({ headings: { h1: ['a', 'b'], h2: [], h3: [] } }),
    );
    expect(f.find((x) => x.type === 'multi_h1')?.details).toMatchObject({
      count: 2,
    });
  });

  it('slow CWV เฉพาะที่เกิน threshold', () => {
    const f = detectFindings(
      healthy({ lcpMs: 4000, clsX1000: 250, inpMs: 500 }),
    );
    const types = f.map((x) => x.type);
    expect(types).toEqual(
      expect.arrayContaining(['slow_lcp', 'slow_cls', 'slow_inp']),
    );
  });
});
