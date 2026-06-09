import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AppException, ErrorCode } from '../common/http';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { EmbeddingService } from './embeddings/embedding.service';
import {
  aiRecommendations,
  aiRuns,
  cannibalizationGroups,
  cannibalizationMembers,
  contentGaps,
  crawls,
  keywords,
  pageKeywords,
  pageSnapshots,
  pages,
  projects,
  seoScores,
  serpResults,
} from '../db/schema';
import { aggregatePageSignals } from '../analysis/analysis.repo';
import type { PageAuditStateType, PageContext } from './page-audit/state';
import { toRecommendationRows } from './page-audit/recommendations';
import { isApproved } from './page-audit/review';

/* ---------- json coercion (driver คืน json column เป็น string บางครั้ง — ดู memory) ---------- */

/** parse JSON ถ้าเป็น string — คืน null ถ้าพัง (เทียบ parseJson ใน analysis.runner.ts). */
function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** บังคับเป็น string[] (กรองตัวที่ไม่ใช่ string) — null ถ้าไม่ใช่ array. */
function toStringArray(v: unknown): string[] | null {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : null;
}

/** coerce headings (object/JSON string) → {h1,h2,h3} — null ถ้าไม่ใช่. */
function toHeadings(v: unknown): PageContext['headings'] {
  const o = parseJson(v);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const h = o as Record<string, unknown>;
  return {
    h1: toStringArray(h.h1) ?? [],
    h2: toStringArray(h.h2) ?? [],
    h3: toStringArray(h.h3) ?? [],
  };
}

/** เก็บ paragraph แค่ N ย่อหน้าแรกเข้า prompt (คุม token). */
const MAX_PARAGRAPHS = 20;
/** จำนวนคู่แข่งใน SERP สูงสุดที่ป้อนเข้า contentGap (top-N ตัดโดเมนเราออก — คุม token). */
const MAX_COMPETITORS = 5;
/** จำนวนเพจพี่น้อง (candidate cannibalization) สูงสุดที่พิจารณาต่อหน้า. */
const MAX_CANNIBAL_CANDIDATES = 10;
/** missing_subtopic varchar(512) — slice กัน overflow ตอน insert content_gaps. */
const MAX_SUBTOPIC_LEN = 512;

/** verdict ของ cannibalization_groups จาก intentMatch (Phase 2 ยังไม่มี cosine → อิง intent). */
function cannibalizationVerdict(
  cannibalizationReal: boolean | null | undefined,
): 'real_issue' | 'benign' | 'needs_review' {
  if (cannibalizationReal === true) return 'real_issue';
  if (cannibalizationReal === false) return 'benign';
  return 'needs_review';
}

type RecType = (typeof aiRecommendations.type.enumValues)[number];
type RecStatus = (typeof aiRecommendations.status.enumValues)[number];
type RunStatus = (typeof aiRuns.status.enumValues)[number];

export interface RecommendationListItem {
  id: number;
  runId: number;
  pageId: number;
  url: string | null;
  type: string;
  output: unknown;
  status: string;
  createdAt: Date;
}

/** 1 ai_run สำหรับ dashboard (Phase 4: list รอรีวิว + proposal ที่ค้าง). */
export interface RunListItem {
  id: number;
  pageId: number | null;
  graph: string;
  status: string;
  reviewPayload: unknown;
  startedAt: Date;
  finishedAt: Date | null;
}

/**
 * AiRepo — รวม Drizzle query ของ stage [4] AI Advisor (อ่าน context จาก crawl/enrich/analysis
 * + เขียน ai_runs / ai_recommendations). มิเรอร์ AnalysisRepo. inject DB ผ่าน token @Global.
 */
@Injectable()
export class AiRepo {
  private readonly logger = new Logger(AiRepo.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly embeddings: EmbeddingService,
  ) {}

  /** มี project นี้จริงไหม (ให้ producer ตอบ NOT_FOUND ก่อน enqueue). */
  async projectExists(projectId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows.length > 0;
  }

  /** crawl ล่าสุด "ที่วิเคราะห์ได้" (status∈{done,partial}) — null ถ้ายังไม่มี (เทียบ AnalysisRepo). */
  async latestCrawlId(projectId: number): Promise<number | null> {
    const rows = await this.db
      .select({ id: crawls.id })
      .from(crawls)
      .where(
        and(
          eq(crawls.projectId, projectId),
          inArray(crawls.status, ['done', 'partial']),
        ),
      )
      .orderBy(desc(crawls.createdAt))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /** pageIds (distinct) ที่มี snapshot ใน crawl นี้ — producer ใช้ fan-out enqueue ต่อเพจ. */
  async pageIdsForCrawl(crawlId: number): Promise<number[]> {
    const rows = await this.db
      .select({ pageId: pageSnapshots.pageId })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.crawlId, crawlId));
    return [...new Set(rows.map((r) => r.pageId))];
  }

  /**
   * โหลด context ต่อเพจ (on-page snapshot + ranking signals + seo score) ป้อนเข้า graph.
   * crawlId ระบุ → snapshot ของ crawl นั้น, ไม่ระบุ → snapshot ล่าสุดของเพจ.
   * ranking ใช้ aggregatePageSignals (pure, reuse จาก analysis.repo — มี recency window).
   */
  async loadPageContext(
    pageId: number,
    crawlId?: number,
  ): Promise<PageContext> {
    const snapConds = [eq(pageSnapshots.pageId, pageId)];
    if (crawlId != null) snapConds.push(eq(pageSnapshots.crawlId, crawlId));
    const snapRows = await this.db
      .select({
        snapshotId: pageSnapshots.id,
        crawlId: pageSnapshots.crawlId,
        url: pages.url,
        projectId: pages.projectId,
        projectDomain: projects.domain,
        title: pageSnapshots.title,
        metaDescription: pageSnapshots.metaDescription,
        h1: pageSnapshots.h1,
        headings: pageSnapshots.headings,
        paragraphs: pageSnapshots.paragraphs,
        wordCount: pageSnapshots.wordCount,
        schemaTypes: pageSnapshots.schemaTypes,
      })
      .from(pageSnapshots)
      .innerJoin(pages, eq(pageSnapshots.pageId, pages.id))
      .innerJoin(projects, eq(pages.projectId, projects.id))
      .where(and(...snapConds))
      .orderBy(desc(pageSnapshots.createdAt))
      .limit(1);
    if (snapRows.length === 0)
      throw new AppException(
        ErrorCode.AI_NO_CRAWL,
        `page ${pageId} ไม่มี snapshot ให้วิเคราะห์ (crawl ยังไม่เสร็จ/ผิด pageId)`,
      );
    const snap = snapRows[0];

    // ranking signals + ข้อมูล keyword (trafficPotential/intent) ของหน้านี้
    const rankRows = await this.db
      .select({
        pageId: pageKeywords.pageId,
        keywordId: keywords.id,
        keyword: keywords.keyword,
        position: pageKeywords.position,
        traffic: pageKeywords.traffic,
        capturedAt: pageKeywords.capturedAt,
        trafficPotential: keywords.trafficPotential,
        intent: keywords.intent,
      })
      .from(pageKeywords)
      .innerJoin(keywords, eq(pageKeywords.keywordId, keywords.id))
      .where(eq(pageKeywords.pageId, pageId));

    const signals = aggregatePageSignals(
      rankRows.map((r) => ({
        pageId: r.pageId,
        keyword: r.keyword,
        position: r.position,
        traffic: r.traffic ?? 0,
        capturedAt: r.capturedAt?.getTime() ?? 0,
      })),
    ).get(pageId);
    const primaryKeyword = signals?.primaryKeyword ?? null;
    const primaryRow = primaryKeyword
      ? rankRows.find((r) => r.keyword === primaryKeyword)
      : undefined;

    // seo score ของ snapshot (อาจยังไม่ได้รัน analysis → null)
    const scoreRows = await this.db
      .select({
        keywordCoverage: seoScores.keywordCoverage,
        healthScore: seoScores.healthScore,
        breakdown: seoScores.breakdown,
      })
      .from(seoScores)
      .where(eq(seoScores.snapshotId, snap.snapshotId))
      .limit(1);
    const score = scoreRows[0];

    // Phase 2 (fan-out): คู่แข่ง SERP (→ contentGap) + เพจพี่น้อง rank คีย์เดียวกัน (→ intentMatch).
    // ผูกกับ primary keyword ของหน้า; ถ้าไม่มี primary keyword ก็ปล่อยว่าง (โหนดยังรันได้).
    const primaryKeywordId = primaryRow?.keywordId ?? null;
    const competitors =
      primaryKeywordId != null
        ? await this.loadSerpCompetitors(primaryKeywordId, snap.projectDomain)
        : [];
    const cannibalizationCandidates =
      primaryKeywordId != null
        ? await this.loadCannibalizationCandidates(
            pageId,
            snap.projectId,
            primaryKeywordId,
          )
        : [];

    const headings = toHeadings(snap.headings);
    const paragraphs =
      toStringArray(parseJson(snap.paragraphs))?.slice(0, MAX_PARAGRAPHS) ??
      null;

    // Phase 6 (semantic): embed หน้า (Voyage) + เติม cosine similarity ให้ candidate cannibalization
    // (เอกสาร 01 §4). best-effort: ไม่มี VOYAGE_API_KEY / Voyage ล้ม / DB error → ข้าม (similarity คง
    // เป็น null เหมือน Phase 2 — ไม่ทำให้ audit ล้ม). embed เฉพาะเมื่อมี candidate (คุม Voyage cost).
    if (this.embeddings.isConfigured() && cannibalizationCandidates.length) {
      try {
        const text = this.embeddings.buildText({
          title: snap.title,
          h1: snap.h1,
          headings,
          paragraphs,
        });
        if (text) {
          const targetVec = await this.embeddings.ensureEmbedding({
            projectId: snap.projectId,
            pageId,
            crawlId: crawlId ?? snap.crawlId,
            text,
          });
          const sims = await this.embeddings.cosineForCandidates(
            targetVec,
            cannibalizationCandidates.map((c) => c.pageId),
          );
          for (const c of cannibalizationCandidates)
            c.similarity = sims.get(c.pageId) ?? null;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `embedding/similarity best-effort ล้มเหลว (page ${pageId}): ${msg}`,
        );
      }
    }

    return {
      pageId,
      url: snap.url,
      title: snap.title,
      metaDescription: snap.metaDescription,
      h1: snap.h1,
      headings,
      paragraphs,
      wordCount: snap.wordCount,
      schemaTypes: toStringArray(parseJson(snap.schemaTypes)),
      primaryKeyword,
      primaryKeywordId,
      // ใช้ position ที่ aggregatePageSignals คัดมาแล้ว (windowed min ของ primary keyword) —
      // ไม่ใช่ primaryRow?.position ที่มาจาก .find() แถวแรกตาม DB order (อาจ stale/ไม่ใช่ min)
      position: signals?.position ?? null,
      pageTraffic: signals?.pageTraffic ?? 0,
      trafficPotential: primaryRow?.trafficPotential ?? null,
      keywordIntent: primaryRow?.intent ?? null,
      businessPotential: 1,
      keywordCoverage: score?.keywordCoverage ?? null,
      healthScore: score?.healthScore ?? null,
      scoreBreakdown: parseJson(score?.breakdown),
      competitors,
      cannibalizationCandidates,
    };
  }

  /**
   * คู่แข่ง top-N ใน SERP ของ keyword (เรียง capture ล่าสุด → position ดีสุด), dedup ต่อโดเมน
   * และตัดโดเมนของเราออก. serp_results เป็น append-only (ไม่มี uq) → เอา capture ล่าสุดก่อน.
   */
  private async loadSerpCompetitors(
    keywordId: number,
    ownDomain: string,
  ): Promise<PageContext['competitors']> {
    const rows = await this.db
      .select({
        url: serpResults.url,
        domain: serpResults.domain,
        position: serpResults.position,
      })
      .from(serpResults)
      .where(eq(serpResults.keywordId, keywordId))
      .orderBy(desc(serpResults.capturedAt), asc(serpResults.position))
      .limit(MAX_COMPETITORS * 6); // เผื่อ dedup โดเมน + capture เก่าซ้ำ

    const own = ownDomain.toLowerCase();
    const seen = new Set<string>();
    const out: PageContext['competitors'] = [];
    for (const r of rows) {
      const domain = r.domain.toLowerCase();
      if (domain === own || seen.has(domain)) continue;
      seen.add(domain);
      out.push({ domain: r.domain, url: r.url, position: r.position });
      if (out.length >= MAX_COMPETITORS) break;
    }
    return out;
  }

  /**
   * เพจอื่นในโปรเจคเดียวกันที่ rank คีย์เดียวกัน (candidate cannibalization) — dedup ต่อเพจ
   * เก็บ position ดีสุด. page_keywords เป็น append-only → group เองในโค้ด (ยังไม่ใช้ embeddings).
   */
  private async loadCannibalizationCandidates(
    pageId: number,
    projectId: number,
    keywordId: number,
  ): Promise<PageContext['cannibalizationCandidates']> {
    const rows = await this.db
      .select({
        pageId: pageKeywords.pageId,
        url: pages.url,
        position: pageKeywords.position,
      })
      .from(pageKeywords)
      .innerJoin(pages, eq(pageKeywords.pageId, pages.id))
      .where(
        and(
          eq(pageKeywords.keywordId, keywordId),
          eq(pages.projectId, projectId),
          ne(pageKeywords.pageId, pageId),
        ),
      )
      .orderBy(asc(pageKeywords.position));

    const byPage = new Map<
      number,
      PageContext['cannibalizationCandidates'][number]
    >();
    for (const r of rows) {
      const prev = byPage.get(r.pageId);
      if (
        !prev ||
        (r.position != null &&
          (prev.position == null || r.position < prev.position))
      )
        byPage.set(r.pageId, {
          pageId: r.pageId,
          url: r.url,
          position: r.position,
        });
    }
    return [...byPage.values()].slice(0, MAX_CANNIBAL_CANDIDATES);
  }

  /** สร้าง ai_runs (status running) + snapshot role→modelId ที่ใช้ → คืน runId. */
  async createRun(input: {
    projectId: number;
    userId?: number;
    pageId: number;
    graph: string;
    models: unknown;
  }): Promise<number> {
    const [{ id }] = await this.db
      .insert(aiRuns)
      .values({
        projectId: input.projectId,
        userId: input.userId ?? null,
        pageId: input.pageId,
        graph: input.graph,
        models: input.models,
        status: 'running',
      })
      .$returningId();
    return id;
  }

  /**
   * persist ผลรอบนั้น (เรียกในโหนด persist): ปิด run → done + token + finishedAt + เคลียร์
   * review_payload. Phase 4 (HITL): ถ้า reject (isApproved=false) → ไม่เขียนข้อเสนอใด ๆ (ทิ้ง draft);
   * approve หรือ HITL ปิด → bulk-insert ai_recommendations + ตารางเสริม content_gaps +
   * cannibalization_groups/members (status default 'suggested' จาก schema).
   */
  async persistRun(s: PageAuditStateType): Promise<void> {
    await this.db
      .update(aiRuns)
      .set({
        status: 'done',
        inputTokens: s.tokensIn ?? 0,
        outputTokens: s.tokensOut ?? 0,
        reviewPayload: null,
        finishedAt: new Date(),
      })
      .where(eq(aiRuns.id, s.runId));

    if (!isApproved(s)) return;

    const rows = toRecommendationRows(s);
    if (rows.length)
      await this.db.insert(aiRecommendations).values(
        rows.map((r) => ({
          runId: s.runId,
          pageId: r.pageId,
          type: r.type,
          output: r.output,
        })),
      );

    await this.persistContentGaps(s);
    await this.persistCannibalization(s);
  }

  /**
   * Phase 4 (HITL): graph interrupt ที่ awaitReview → ค้าง run รอ user อนุมัติใน dashboard.
   * เก็บ proposal (= toRecommendationRows ตอน interrupt) ลง review_payload ให้ dashboard โชว์
   * ก่อน approve/reject + token ที่ใช้ถึงตอนนี้ (persist ยังไม่รัน). ยังไม่ตั้ง finishedAt.
   */
  async setAwaitingReview(
    runId: number,
    input: { reviewPayload: unknown; tokensIn: number; tokensOut: number },
  ): Promise<void> {
    await this.db
      .update(aiRuns)
      .set({
        status: 'awaiting_review',
        reviewPayload: input.reviewPayload,
        inputTokens: input.tokensIn,
        outputTokens: input.tokensOut,
      })
      .where(eq(aiRuns.id, runId));
  }

  /** run ที่ approve/reject ได้ (ต้อง awaiting_review + อยู่ในโปรเจคนี้) — null ถ้าไม่พบ/ผิดโปรเจค. */
  async getReviewableRun(
    runId: number,
    projectId: number,
  ): Promise<{ id: number; pageId: number | null; status: string } | null> {
    const rows = await this.db
      .select({ id: aiRuns.id, pageId: aiRuns.pageId, status: aiRuns.status })
      .from(aiRuns)
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** ai_runs ของ project (กรอง status) — dashboard ดึงรายการรอรีวิว (awaiting_review) + proposal. */
  async listRuns(
    projectId: number,
    opts: { status?: string; limit: number; offset: number },
  ): Promise<{ items: RunListItem[]; total: number }> {
    const conds = [eq(aiRuns.projectId, projectId)];
    if (opts.status) conds.push(eq(aiRuns.status, opts.status as RunStatus));
    const where = and(...conds);

    const items = await this.db
      .select({
        id: aiRuns.id,
        pageId: aiRuns.pageId,
        graph: aiRuns.graph,
        status: aiRuns.status,
        reviewPayload: aiRuns.reviewPayload,
        startedAt: aiRuns.startedAt,
        finishedAt: aiRuns.finishedAt,
      })
      .from(aiRuns)
      .where(where)
      .orderBy(desc(aiRuns.startedAt))
      .limit(opts.limit)
      .offset(opts.offset);

    const totalRows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(aiRuns)
      .where(where);

    return { items, total: Number(totalRows[0].n) };
  }

  /**
   * content_gaps จาก contentGap (เอกสาร 02 Phase 2). แถว AI ตั้ง pageId + competitorDomains
   * (จาก SERP) → แยกจาก keyword-idea ของ enrichment (pageId null). ไม่ใช้ embeddings (Phase 6).
   */
  private async persistContentGaps(s: PageAuditStateType): Promise<void> {
    const gaps = s.gaps ?? [];
    if (!gaps.length) return;
    await this.db.insert(contentGaps).values(
      gaps.map((g) => ({
        projectId: s.projectId,
        pageId: s.pageId,
        keywordId: s.context?.primaryKeywordId ?? null,
        missingSubtopic: g.subtopic.slice(0, MAX_SUBTOPIC_LEN),
        competitorDomains: g.competitors,
      })),
    );
  }

  /**
   * cannibalization_groups + members เมื่อมีเพจพี่น้อง rank คีย์เดียวกัน (candidate จาก
   * loadCannibalizationCandidates). verdict อิง intentMatch (เอกสาร 02 Phase 2);
   * members.similarity = null จนกว่า Phase 6 (VECTOR cosine).
   */
  private async persistCannibalization(s: PageAuditStateType): Promise<void> {
    const candidates = s.context?.cannibalizationCandidates ?? [];
    const keywordId = s.context?.primaryKeywordId ?? null;
    if (!candidates.length || keywordId == null) return;

    const [{ id: groupId }] = await this.db
      .insert(cannibalizationGroups)
      .values({
        projectId: s.projectId,
        keywordId,
        verdict: cannibalizationVerdict(s.intent?.cannibalizationReal),
        intentNote: s.intent?.note ?? null,
      })
      .$returningId();

    await this.db.insert(cannibalizationMembers).values([
      // หน้านี้ = anchor ของกลุ่ม (similarity = null); candidate ถือ cosine กับ anchor (Phase 6)
      { groupId, pageId: s.pageId, position: s.context?.position ?? null },
      ...candidates.map((c) => ({
        groupId,
        pageId: c.pageId,
        position: c.position ?? null,
        // decimal(5,4) — Drizzle รับ string; null เมื่อยังไม่มี embedding/ปิด Voyage
        similarity: c.similarity != null ? c.similarity.toFixed(4) : null,
      })),
    ]);
  }

  /** mark run failed (เรียกเมื่อ graph โยน) — best-effort. */
  async failRun(runId: number): Promise<void> {
    await this.db
      .update(aiRuns)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(aiRuns.id, runId));
  }

  /** ai_recommendations ของ project (join ai_runs เพื่อ scope projectId + pages เอา url). */
  async listRecommendations(
    projectId: number,
    opts: {
      pageId?: number;
      type?: string;
      status?: string;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: RecommendationListItem[]; total: number }> {
    const conds = [eq(aiRuns.projectId, projectId)];
    if (opts.pageId) conds.push(eq(aiRecommendations.pageId, opts.pageId));
    if (opts.type) conds.push(eq(aiRecommendations.type, opts.type as RecType));
    if (opts.status)
      conds.push(eq(aiRecommendations.status, opts.status as RecStatus));
    const where = and(...conds);

    const items = await this.db
      .select({
        id: aiRecommendations.id,
        runId: aiRecommendations.runId,
        pageId: aiRecommendations.pageId,
        url: pages.url,
        type: aiRecommendations.type,
        output: aiRecommendations.output,
        status: aiRecommendations.status,
        createdAt: aiRecommendations.createdAt,
      })
      .from(aiRecommendations)
      .innerJoin(aiRuns, eq(aiRecommendations.runId, aiRuns.id))
      .leftJoin(pages, eq(aiRecommendations.pageId, pages.id))
      .where(where)
      .orderBy(desc(aiRecommendations.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);

    const totalRows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(aiRecommendations)
      .innerJoin(aiRuns, eq(aiRecommendations.runId, aiRuns.id))
      .where(where);

    return { items, total: Number(totalRows[0].n) };
  }
}
