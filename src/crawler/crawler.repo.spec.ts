import { CrawlerRepo } from './crawler.repo';
import type { CrawlResult } from './crawler.schema';
import { normalizeUrl, urlHash } from '../common/url';

/**
 * mock executor ของ transaction: chainable พอให้ persistPage เดินจบ (pages upsert →
 * select id → snapshot $returningId → update crawls). เก็บ values() ทุก insert ตามลำดับ
 * (inserts[0] = pages) เพื่อ assert ว่า url_hash มาจาก finalUrl.
 */
function makeTx() {
  const inserts: Array<Record<string, unknown>> = [];
  const tx = {
    insert: jest.fn(() => ({
      values: jest.fn((v: Record<string, unknown>) => {
        inserts.push(v);
        return {
          onDuplicateKeyUpdate: jest.fn().mockResolvedValue(undefined),
          $returningId: jest.fn().mockResolvedValue([{ id: 9 }]),
        };
      }),
    })),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue([{ id: 7 }]), // pageId
        })),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
    })),
  };
  return { tx, inserts };
}

function makeRepo(tx: unknown): CrawlerRepo {
  const db = {
    transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  };
  return new CrawlerRepo(
    db as unknown as ConstructorParameters<typeof CrawlerRepo>[0],
  );
}

/** หน้าที่ "ขอ http (non-www)" แล้ว 301 ไป https (+ trailing slash) — เคส redirect ปกติ. */
const REDIRECT_RESULT = {
  url: 'http://example.com/blog/seo-guide', // result.url = URL ที่ขอ (ก่อน redirect)
  finalUrl: 'https://example.com/blog/seo-guide/', // หลัง follow redirect (= canonical Ahrefs)
  httpStatus: 200,
  title: 't',
  metaDescription: null,
  h1: null,
  headings: { h1: [], h2: [], h3: [] },
  paragraphs: [],
  canonical: null,
  robotsMeta: null,
  schemaTypes: [],
  links: [],
  internalLinks: 0,
  externalLinks: 0,
  images: { total: 0, missingAlt: 0 },
  imageRows: [],
  wordCount: 0,
  contentHash: 'x',
  bodyText: '',
} as unknown as CrawlResult;

describe('CrawlerRepo.persistPage — key หน้าด้วย finalUrl (join flow [1]→[2])', () => {
  it('upsert pages ด้วย url_hash ของ finalUrl ไม่ใช่ url ที่ขอ', async () => {
    const { tx, inserts } = makeTx();
    const repo = makeRepo(tx);

    await repo.persistPage({
      crawlId: 42,
      projectId: 1,
      result: REDIRECT_RESULT,
      htmlStorageKey: null,
      cwv: { lcpMs: null, clsX1000: null, inpMs: null },
    });

    const pageValues = inserts[0] as { url: string; urlHash: string };
    // เก็บ url + hash ของ finalUrl (= สิ่งที่ Ahrefs/Google index) → join page_keywords ติด
    expect(pageValues.url).toBe(
      normalizeUrl('https://example.com/blog/seo-guide/'),
    );
    expect(pageValues.urlHash).toBe(
      urlHash('https://example.com/blog/seo-guide/'),
    );
    // regression: ต้องไม่ใช่ hash ของ url ที่ขอ (ก่อน redirect) — มิฉะนั้น Ahrefs join พลาดทุกแถว
    expect(pageValues.urlHash).not.toBe(
      urlHash('http://example.com/blog/seo-guide'),
    );
  });
});
