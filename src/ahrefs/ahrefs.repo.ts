import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  ahrefsCache,
  ahrefsUsage,
  keywords,
  pageKeywords,
  pages,
  projects,
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

  /** upsert keyword (uq = project+keyword+country) แล้วคืน id; ไม่แตะ intent (AI ตั้งเอง). */
  async upsertKeyword(input: UpsertKeywordInput): Promise<number> {
    const metrics = {
      searchVolume: input.searchVolume ?? null,
      difficulty: input.difficulty ?? null,
      cpc: input.cpc != null ? String(input.cpc) : null, // decimal → string (drizzle)
      trafficPotential: input.trafficPotential ?? null,
      parentTopic: input.parentTopic ?? null,
      lastEnrichedAt: new Date(),
    };
    await this.db
      .insert(keywords)
      .values({
        projectId: input.projectId,
        keyword: input.keyword,
        country: input.country,
        ...metrics,
      })
      .onDuplicateKeyUpdate({ set: metrics });

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
}
