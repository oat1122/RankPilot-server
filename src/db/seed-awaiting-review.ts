import { db } from './client';
import {
  aiRecommendations,
  aiRuns,
  crawls,
  pageSnapshots,
  pages,
  projects,
  users,
} from './schema';
import { urlHash } from '../common/url';

/**
 * Seed สำหรับ verify HITL review flow (เอกสาร 02 Phase 4 / 06 §2.4(b)) แบบ runtime —
 * รัน: `npm run db:seed:hitl` (= tsx --env-file=.env src/db/seed-awaiting-review.ts).
 *
 * สร้าง project + crawl(done) + 1 หน้า + 1 ai_run ที่ status='awaiting_review' พร้อม
 * `reviewPayload` (proposal ค้างรอ approve/reject). ปกติ run แบบนี้เกิดจาก AI pipeline ที่
 * interrupt ที่โหนด awaitReview — ที่นี่ insert ตรงเพื่อทดสอบ FE โดย **ไม่ต้องมี OpenRouter credit**
 * (approve/reject ฝั่ง api แค่ enqueue 'resume-review'; reject ไม่เรียก LLM, approve→persist ก็ไม่เรียก).
 * เสริม ai_recommendations 2 แถวให้แท็บ recommendations ไม่ว่าง.
 *
 * สร้างใหม่ทุกครั้ง (autoinc) → ไม่ชน uq. พิมพ์ projectId/runId/pageId ท้ายสุด
 * (ดูขั้นตอนกดทดสอบใน docs/runbook-hitl-verify.md).
 */

const DOMAIN = 'seed-hitl.example.com';
const url = `https://${DOMAIN}/running-shoes`;

// snapshot role→modelId ที่ "ใช้รอบนั้น" (ค่าโชว์เฉย ๆ — ไม่ถูกเรียกใช้ตอน verify).
const MODELS = {
  reasoner: 'anthropic/claude-opus-4.8',
  worker: 'anthropic/claude-sonnet-4.6',
  cheap: 'anthropic/claude-haiku-4.5',
};

// seed script: table แบบหลวม ๆ เพื่อ reuse helper กับหลายตาราง (ไม่กระทบโค้ด prod — เทียบ seed-analysis.ts).
async function insertReturningId(
  table: any,
  values: Record<string, unknown>,
): Promise<number> {
  const [{ id }] = await db.insert(table).values(values).$returningId();
  return id as number;
}

async function main() {
  const stamp = Date.now();
  const ownerId = await insertReturningId(users, {
    clerkUserId: `seed_hitl_${stamp}`,
    email: `seed_hitl_${stamp}@example.com`,
  });
  const projectId = await insertReturningId(projects, {
    ownerId,
    name: 'SEED — HITL review (Phase 4)',
    domain: DOMAIN,
    country: 'th',
  });
  const crawlId = await insertReturningId(crawls, {
    projectId,
    status: 'done',
    trigger: 'manual',
    pagesDiscovered: 1,
    pagesCrawled: 1,
    startedAt: new Date(),
    finishedAt: new Date(),
  });
  const pageId = await insertReturningId(pages, {
    projectId,
    url,
    urlHash: urlHash(url),
    isIndexable: true,
  });
  await db.insert(pageSnapshots).values({
    crawlId,
    pageId,
    httpStatus: 200,
    title: 'Best Running Shoes 2026',
    metaDescription: null,
    h1: 'Best Running Shoes',
    headings: { h1: ['Best Running Shoes'], h2: [], h3: [] },
    paragraphs: ['Editors review the best running shoes of the year.'],
    wordCount: 900,
    schemaTypes: [],
    internalLinks: 1,
    externalLinks: 0,
    imagesTotal: 3,
    imagesMissingAlt: 1,
    contentHash: urlHash(url).slice(0, 40),
  });

  // proposal ที่ค้างรอรีวิว (= NewRecommendation[] ตอน interrupt) — ตรง ReviewProposalItem ฝั่ง FE
  // (client/src/lib/api/types.ts: { pageId, type, output }). `output` เป็น JSON ก้อนอิสระ.
  const reviewPayload = [
    {
      pageId,
      type: 'diagnosis',
      output: {
        primaryKeyword: 'running shoes',
        reasoning:
          'หน้านี้ตรง intent ซื้อรองเท้าวิ่ง แต่ meta description ว่าง + มีรูปขาด alt',
      },
    },
    {
      pageId,
      type: 'title_draft',
      output: {
        title: 'Best Running Shoes 2026 — Buyer Guide',
        metaDescription:
          'รวมรองเท้าวิ่งที่ดีที่สุดปี 2026 พร้อมวิธีเลือกตามสภาพเท้า',
      },
    },
  ];

  const runId = await insertReturningId(aiRuns, {
    projectId,
    pageId,
    graph: 'page_audit',
    models: MODELS,
    status: 'awaiting_review',
    reviewPayload,
    inputTokens: 2000,
    outputTokens: 1500,
    startedAt: new Date(),
    finishedAt: null,
  });

  // recs ให้แท็บ recommendations ไม่ว่าง (status suggested — ยังไม่ผ่าน approve)
  await db.insert(aiRecommendations).values([
    {
      runId,
      pageId,
      type: 'diagnosis',
      output: { summary: 'meta description ว่าง + 1 รูปขาด alt', severity: 'medium' },
      status: 'suggested',
    },
    {
      runId,
      pageId,
      type: 'title_draft',
      output: { title: 'Best Running Shoes 2026 — Buyer Guide' },
      status: 'suggested',
    },
  ]);

  console.log('SEED hitl ✓');
  console.log(`  projectId = ${projectId}`);
  console.log(`  runId     = ${runId}`);
  console.log(`  pageId    = ${pageId}`);
  console.log(
    `ต่อไป: เปิด /projects/${projectId}/dashboard?tab=recommendations แล้วกด อนุมัติ/ปฏิเสธ ใน ReviewQueue`,
  );
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
