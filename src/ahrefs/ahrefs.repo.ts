import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  ahrefsCache,
  ahrefsUsage,
  backlinkSnapshots,
  competitors,
  contentGaps,
  keywords,
  pageKeywords,
  pages,
  projects,
  serpResults,
} from '../db/schema';

/** input ของ upsertKeyword — ค่า metric เป็น nullable ∵ Ahrefs อาจไม่ส่งครบทุก field. */
export interface UpsertKeywordInput {
  projectId: number;
  keyword: string;
  country: string;
  searchVolume?: number | null;
  difficulty?: number | null;
  cpc?: number | null;
  trafficPotential?: number | null;
  parentTopic?: string | null;
}

export interface InsertPageKeywordInput {
  pageId: number;
  keywordId: number;
  crawlId?: number | null;
  position?: number | null;
  traffic?: number | null;
  trafficValue?: number | null;
}

/** 1 แถว SERP (serp-overview → serp_results — เอกสาร 03a §5). */
export interface InsertSerpResultInput {
  keywordId: number;
  position: number;
  url: string;
  domain: string;
}

/** seed idea จาก matching/related-terms → content_gaps (เอกสาร 03a §5). */
export interface InsertContentGapInput {
  projectId: number;
  missingSubtopic: string;
  keywordId?: number | null;
  competitorDomains?: unknown;
}

/** snapshot DR/UR/refdomains/backlinks (domain-rating + backlinks-stats → backlink_snapshots — เอกสาร 03a §6). */
export interface InsertBacklinkSnapshotInput {
  projectId: number;
  pageId?: number | null;
  referringDomains?: number | null;
  backlinks?: number | null; // BL = total live backlinks (backlinks-stats → metrics.live)
  urlRating?: number | null;
  domainRating?: number | null;
}

/** 1 keyword ที่เว็บ rank (organic-keywords → keywords×page_keywords) — ตาราง keyword ในรายงานเต็ม. */
export interface TopKeywordRow {
  keyword: string;
  position: number | null;
  volume: number | null;
  difficulty: number | null;
  traffic: number | null;
}

export interface UpsertCacheInput {
  endpoint: string;
  paramsHash: string;
  response: unknown;
  unitsSpent: number;
  rows: number;
  ttlSec: number;
}

/** แถว project ที่ Ahrefs flow ใช้ (domain เป็นเป้า, budget เป็นเพดานต่อโปรเจค). */
export interface ProjectRow {
  id: number;
  domain: string;
  country: string;
  monthlyUnitBudget: number;
}

/**
 * AhrefsRepo — รวม Drizzle query ของ flow Ahrefs ไว้ที่เดียว (เอกสาร 03 §2/§6).
 * service ชั้นบน (AhrefsClient/EnrichmentService) ไม่ต้องรู้ SQL → อ่าน/ทดสอบง่าย.
 */
@Injectable()
export class AhrefsRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** โหลด project (domain/country/budget) — null ถ้าไม่มี (soft-FK เอกสาร 01). */
  async getProject(projectId: number): Promise<ProjectRow | null> {
    const rows = await this.db
      .select({
        id: projects.id,
        domain: projects.domain,
        country: projects.country,
        monthlyUnitBudget: projects.monthlyUnitBudget,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** cache ที่ยังไม่หมดอายุ (expiresAt > now) ของ endpoint+paramsHash. */
  async findFreshCache(endpoint: string, paramsHash: string) {
    const rows = await this.db
      .select()
      .from(ahrefsCache)
      .where(
        and(
          eq(ahrefsCache.endpoint, endpoint),
          eq(ahrefsCache.paramsHash, paramsHash),
          gt(ahrefsCache.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** บันทึก/อัปเดต cache ดิบ + units จริง (durable archive — เอกสาร 03 §2). */
  async upsertCache(input: UpsertCacheInput): Promise<void> {
    const expiresAt = new Date(Date.now() + input.ttlSec * 1000);
    await this.db
      .insert(ahrefsCache)
      .values({
        endpoint: input.endpoint,
        paramsHash: input.paramsHash,
        response: input.response,
        unitsSpent: input.unitsSpent,
        rows: input.rows,
        expiresAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          response: input.response,
          unitsSpent: input.unitsSpent,
          rows: input.rows,
          fetchedAt: new Date(),
          expiresAt,
        },
      });
  }

  /** เพิ่มยอด units/requests ของเดือน (ground truth durable — เอกสาร 03 §5). */
  async bumpUsage(
    projectId: number,
    period: string,
    units: number,
  ): Promise<void> {
    await this.db
      .insert(ahrefsUsage)
      .values({ projectId, period, unitsSpent: units, requests: 1 })
      .onDuplicateKeyUpdate({
        set: {
          unitsSpent: sql`${ahrefsUsage.unitsSpent} + ${units}`,
          requests: sql`${ahrefsUsage.requests} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * upsert keyword (uq = project+keyword+country) แล้วคืน id; ไม่แตะ intent (AI ตั้งเอง).
   * แยก undefined ("flow นี้ไม่ได้ดึง field นี้ → อย่าทับ") ออกจาก null ("ดึงแล้วแต่ไม่มีค่า →
   * ล้างเป็น null") ตอน update: organic-keywords ไม่คืน traffic_potential/parent_topic จึงไม่
   * ควรลบค่าที่ keywords-explorer/overview เคย enrich ไว้. INSERT ใส่ null ให้ field ที่ไม่ส่ง.
   */
  async upsertKeyword(input: UpsertKeywordInput): Promise<number> {
    const cpc = input.cpc != null ? String(input.cpc) : null; // decimal → string (drizzle)
    const set: Record<string, unknown> = { lastEnrichedAt: new Date() };
    if (input.searchVolume !== undefined) set.searchVolume = input.searchVolume;
    if (input.difficulty !== undefined) set.difficulty = input.difficulty;
    if (input.cpc !== undefined) set.cpc = cpc;
    if (input.trafficPotential !== undefined)
      set.trafficPotential = input.trafficPotential;
    if (input.parentTopic !== undefined) set.parentTopic = input.parentTopic;

    await this.db
      .insert(keywords)
      .values({
        projectId: input.projectId,
        keyword: input.keyword,
        country: input.country,
        searchVolume: input.searchVolume ?? null,
        difficulty: input.difficulty ?? null,
        cpc,
        trafficPotential: input.trafficPotential ?? null,
        parentTopic: input.parentTopic ?? null,
        lastEnrichedAt: new Date(),
      })
      .onDuplicateKeyUpdate({ set });

    const rows = await this.db
      .select({ id: keywords.id })
      .from(keywords)
      .where(
        and(
          eq(keywords.projectId, input.projectId),
          eq(keywords.keyword, input.keyword),
          eq(keywords.country, input.country),
        ),
      )
      .limit(1);
    return rows[0].id;
  }

  /** url ของหน้า (scope projectId) — null ถ้าไม่พบ/ข้าม tenant (producer ใช้ตั้ง target ราย URL). */
  async getPage(
    projectId: number,
    pageId: number,
  ): Promise<{ id: number; url: string } | null> {
    const rows = await this.db
      .select({ id: pages.id, url: pages.url })
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** keyword ที่หน้านี้ติดอันดับและทราฟฟิกมากสุด (primary) — null ถ้ายังไม่มี ranking. */
  async getPrimaryKeyword(pageId: number): Promise<string | null> {
    const rows = await this.db
      .select({ keyword: keywords.keyword })
      .from(pageKeywords)
      .innerJoin(keywords, eq(keywords.id, pageKeywords.keywordId))
      .where(eq(pageKeywords.pageId, pageId))
      .orderBy(desc(pageKeywords.traffic))
      .limit(1);
    return rows[0]?.keyword ?? null;
  }

  /** DR/UR/refdomains/backlinks ระดับโดเมนล่าสุด (backlink_snapshots ที่ pageId IS NULL) — null ถ้ายังไม่ enrich. */
  async getDomainBacklinks(projectId: number): Promise<{
    domainRating: number | null;
    urlRating: number | null;
    referringDomains: number | null;
    backlinks: number | null;
    capturedAt: Date;
  } | null> {
    const rows = await this.db
      .select({
        domainRating: backlinkSnapshots.domainRating,
        urlRating: backlinkSnapshots.urlRating,
        referringDomains: backlinkSnapshots.referringDomains,
        backlinks: backlinkSnapshots.backlinks,
        capturedAt: backlinkSnapshots.capturedAt,
      })
      .from(backlinkSnapshots)
      .where(
        and(
          eq(backlinkSnapshots.projectId, projectId),
          isNull(backlinkSnapshots.pageId),
        ),
      )
      .orderBy(desc(backlinkSnapshots.capturedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * organic ระดับเว็บ — รวม traffic/value + นับ keyword จาก "row ล่าสุดต่อ (page,keyword)" ของ
   * page_keywords (กันนับซ้ำข้าม capture) ทุกหน้าใน project.
   */
  async getSiteOrganic(
    projectId: number,
  ): Promise<{ traffic: number; value: number; keywords: number }> {
    const latest = this.db
      .select({ id: sql<number>`max(${pageKeywords.id})` })
      .from(pageKeywords)
      .innerJoin(pages, eq(pages.id, pageKeywords.pageId))
      .where(eq(pages.projectId, projectId))
      .groupBy(pageKeywords.pageId, pageKeywords.keywordId);
    const agg = await this.db
      .select({
        traffic: sql<string>`coalesce(sum(${pageKeywords.traffic}), 0)`,
        value: sql<string>`coalesce(sum(${pageKeywords.trafficValue}), 0)`,
        keywords: sql<number>`count(distinct ${pageKeywords.keywordId})`,
      })
      .from(pageKeywords)
      .where(inArray(pageKeywords.id, latest));
    const row = agg[0];
    return {
      traffic: Number(row?.traffic ?? 0),
      value: Number(row?.value ?? 0),
      keywords: Number(row?.keywords ?? 0),
    };
  }

  /** คู่แข่ง organic ของ project — รายชื่อโดเมน (limit) + จำนวนทั้งหมด. */
  async getSiteCompetitors(
    projectId: number,
    limit: number,
  ): Promise<{ domains: string[]; total: number }> {
    const rows = await this.db
      .select({ domain: competitors.domain })
      .from(competitors)
      .where(eq(competitors.projectId, projectId))
      .limit(limit);
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(competitors)
      .where(eq(competitors.projectId, projectId));
    return { domains: rows.map((r) => r.domain), total: value };
  }

  /** หา pageId จาก urlHash (best-effort match กับหน้าที่ crawl มา) — null ถ้าไม่เจอ. */
  async findPageByUrlHash(
    projectId: number,
    urlHash: string,
  ): Promise<number | null> {
    const rows = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.urlHash, urlHash)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /** insert snapshot ranking ต่อหน้า (time-series — page_keywords ไม่มี uq, เก็บตาม capturedAt). */
  async insertPageKeyword(input: InsertPageKeywordInput): Promise<void> {
    await this.db.insert(pageKeywords).values({
      pageId: input.pageId,
      keywordId: input.keywordId,
      crawlId: input.crawlId ?? null,
      position: input.position ?? null,
      traffic: input.traffic ?? null,
      trafficValue:
        input.trafficValue != null ? String(input.trafficValue) : null,
    });
  }

  /** upsert คู่แข่ง 1 โดเมน (uq_comp = project+domain → ซ้ำ = no-op). เอกสาร 03a §4.3. */
  async upsertCompetitor(projectId: number, domain: string): Promise<void> {
    await this.db
      .insert(competitors)
      .values({ projectId, domain })
      .onDuplicateKeyUpdate({ set: { domain } });
  }

  /** insert SERP snapshot หลายแถวในครั้งเดียว (time-series — serp_results ไม่มี uq). */
  async insertSerpResults(rows: InsertSerpResultInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(serpResults).values(
      rows.map((r) => ({
        keywordId: r.keywordId,
        position: r.position,
        url: r.url,
        domain: r.domain,
      })),
    );
  }

  /** insert seed keyword idea (content_gaps ไม่มี uq → append; dedup ทำชั้นบนถ้าต้องการ). */
  async insertContentGap(input: InsertContentGapInput): Promise<void> {
    await this.db.insert(contentGaps).values({
      projectId: input.projectId,
      missingSubtopic: input.missingSubtopic,
      keywordId: input.keywordId ?? null,
      competitorDomains: input.competitorDomains ?? null,
    });
  }

  /** insert snapshot DR/UR/refdomains (time-series — backlink_snapshots เก็บตาม capturedAt). */
  async insertBacklinkSnapshot(
    input: InsertBacklinkSnapshotInput,
  ): Promise<void> {
    await this.db.insert(backlinkSnapshots).values({
      projectId: input.projectId,
      pageId: input.pageId ?? null,
      referringDomains: input.referringDomains ?? null,
      backlinks: input.backlinks ?? null,
      urlRating: input.urlRating ?? null,
      domainRating: input.domainRating ?? null,
    });
  }

  /**
   * top keyword ที่เว็บ rank อยู่ (ตาราง keyword ในรายงานเต็ม) — row ล่าสุดต่อ (page,keyword)
   * ของ page_keywords (กันนับซ้ำข้าม capture) join keywords (volume/KD) ทุกหน้าใน project,
   * เรียง traffic มากก่อน. limit คุมจำนวนแถวที่ส่งให้การ์ด.
   */
  async getTopKeywords(
    projectId: number,
    limit: number,
  ): Promise<TopKeywordRow[]> {
    const latest = this.db
      .select({ id: sql<number>`max(${pageKeywords.id})` })
      .from(pageKeywords)
      .innerJoin(pages, eq(pages.id, pageKeywords.pageId))
      .where(eq(pages.projectId, projectId))
      .groupBy(pageKeywords.pageId, pageKeywords.keywordId);
    const rows = await this.db
      .select({
        keyword: keywords.keyword,
        position: pageKeywords.position,
        volume: keywords.searchVolume,
        difficulty: keywords.difficulty,
        traffic: pageKeywords.traffic,
      })
      .from(pageKeywords)
      .innerJoin(keywords, eq(keywords.id, pageKeywords.keywordId))
      .where(inArray(pageKeywords.id, latest))
      .orderBy(desc(pageKeywords.traffic))
      .limit(limit);
    return rows;
  }
}
