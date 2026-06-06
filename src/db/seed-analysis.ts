import { db } from './client';
import {
  crawls,
  keywords,
  pageKeywords,
  pageLinks,
  pageSnapshots,
  pages,
  projects,
  users,
} from './schema';
import { urlHash } from '../common/url';

/**
 * Seed สำหรับทดสอบ stage [3] Analysis แบบ end-to-end (เอกสาร 04 §7) —
 * รัน: `npm run db:seed:analysis` (= tsx --env-file=.env src/db/seed-analysis.ts).
 *
 * สร้าง project + crawl + หลายหน้า "จงใจมีปัญหา" + กราฟลิงก์ภายใน + keywords/page_keywords
 * ให้ analysis คำนวณ seo_scores + audit_findings ได้ครบหลายชนิด:
 *   - home   : สะอาด, coverage ครบ (มี primary keyword + inbound link)
 *   - about  : no_h1 + title ยาว + missing_meta + missing_alt
 *   - orphan : ไม่มีลิงก์ภายในชี้เข้า (orphan) + thin_content + ไม่มี keyword (coverage=null)
 *   - broken : http 404 (http_error)
 *
 * สร้าง project ใหม่ทุกครั้ง (autoinc) → ไม่ชน uq เดิม. พิมพ์ projectId/crawlId ท้ายสุด
 * เพื่อเอาไปยิง POST /projects/:id/analysis ต่อ.
 */

const DOMAIN = 'seed-analysis.example.com';
const base = (path: string) => `https://${DOMAIN}${path}`;

// seed script: ใช้ table แบบหลวม ๆ เพื่อ reuse helper กับหลายตาราง (ไม่กระทบโค้ด prod).
async function insertReturningId(
  table: any,
  values: Record<string, unknown>,
): Promise<number> {
  const [{ id }] = await db.insert(table).values(values).$returningId();
  return id as number;
}

async function addPage(
  projectId: number,
  crawlId: number,
  path: string,
  snap: Partial<typeof pageSnapshots.$inferInsert>,
  isIndexable = true,
): Promise<number> {
  const url = base(path);
  const pageId = await insertReturningId(pages, {
    projectId,
    url,
    urlHash: urlHash(url),
    isIndexable,
  });
  await db.insert(pageSnapshots).values({
    crawlId,
    pageId,
    httpStatus: 200,
    wordCount: 800,
    headings: { h1: [], h2: [], h3: [] },
    paragraphs: [],
    schemaTypes: [],
    internalLinks: 0,
    externalLinks: 0,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    contentHash: urlHash(url).slice(0, 40),
    ...snap,
  });
  return pageId;
}

async function main() {
  const ownerId = await insertReturningId(users, {
    clerkUserId: `seed_${Date.now()}`,
    email: `seed_${Date.now()}@example.com`,
  });
  const projectId = await insertReturningId(projects, {
    ownerId,
    name: 'SEED — Analysis stage [3]',
    domain: DOMAIN,
    country: 'th',
  });
  const crawlId = await insertReturningId(crawls, {
    projectId,
    status: 'done',
    trigger: 'manual',
    pagesDiscovered: 4,
    pagesCrawled: 4,
    startedAt: new Date(),
    finishedAt: new Date(),
  });

  // home — สะอาด, coverage ครบ (primary keyword 'running shoes')
  const home = await addPage(projectId, crawlId, '/running-shoes', {
    title: 'Best Running Shoes 2026 — Buyer Guide',
    metaDescription: 'Find the best running shoes for every runner.',
    h1: 'Best Running Shoes',
    headings: {
      h1: ['Best Running Shoes'],
      h2: ['Top running shoes picks', 'How we test'],
      h3: [],
    },
    paragraphs: ['Our editors review the best running shoes of the year.'],
    wordCount: 1200,
    internalLinks: 2,
    externalLinks: 1,
    imagesTotal: 5,
    imagesMissingAlt: 0,
  });

  // about — no_h1 + title ยาวเกิน + missing_meta + missing_alt
  const about = await addPage(projectId, crawlId, '/about', {
    title:
      'About our company and the very long story of how we started reviewing running shoes since 2010',
    metaDescription: null,
    h1: null,
    headings: { h1: [], h2: ['Our team'], h3: [] },
    paragraphs: ['We are a small team based in Bangkok.'],
    wordCount: 500,
    internalLinks: 1,
    imagesTotal: 4,
    imagesMissingAlt: 4,
  });

  // orphan — ไม่มีลิงก์ภายในชี้เข้า + thin_content + ไม่มี keyword
  await addPage(projectId, crawlId, '/forgotten-page', {
    title: 'Forgotten Page',
    metaDescription: 'A lonely page nobody links to.',
    h1: 'Forgotten Page',
    headings: { h1: ['Forgotten Page'], h2: [], h3: [] },
    paragraphs: ['Very little content here.'],
    wordCount: 80,
  });

  // broken — http 404
  const broken = await addPage(projectId, crawlId, '/missing', {
    httpStatus: 404,
    title: 'Not Found',
    wordCount: 0,
  });

  // กราฟลิงก์ภายใน: home → about, home → broken, about → home (ให้ home มี inbound)
  await db.insert(pageLinks).values([
    {
      crawlId,
      fromPageId: home,
      toPageId: about,
      toUrl: base('/about'),
      anchorText: 'About',
      isInternal: true,
    },
    {
      crawlId,
      fromPageId: home,
      toPageId: broken,
      toUrl: base('/missing'),
      anchorText: 'Missing',
      isInternal: true,
    },
    {
      crawlId,
      fromPageId: home,
      toPageId: null,
      toUrl: 'https://external.example.org/',
      anchorText: 'External',
      isInternal: false,
    },
    {
      crawlId,
      fromPageId: about,
      toPageId: home,
      toUrl: base('/running-shoes'),
      anchorText: 'Home',
      isInternal: true,
    },
  ]);

  // keyword + ranking ให้ home (coverage คำนวณได้ + pageTraffic ถ่วง impact)
  const kwId = await insertReturningId(keywords, {
    projectId,
    keyword: 'running shoes',
    country: 'th',
    searchVolume: 12000,
    difficulty: 35,
    cpc: '0.80',
    trafficPotential: 9000,
    intent: 'commercial',
    lastEnrichedAt: new Date(),
  });
  await db.insert(pageKeywords).values({
    pageId: home,
    keywordId: kwId,
    crawlId,
    position: 4,
    traffic: 800,
    trafficValue: '640.00',
  });

  console.log('SEED analysis ✓');
  console.log(`  projectId = ${projectId}`);
  console.log(`  crawlId   = ${crawlId}`);
  console.log(
    'ต่อไป: POST /projects/' + projectId + '/analysis แล้วดู findings',
  );
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
