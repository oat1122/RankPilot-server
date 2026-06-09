import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { aiRuns, pageSnapshots, pages, siteReports } from '../db/schema';
import type { SiteAnalysis } from './site-analysis';

/** ค่าที่ runner เขียนลง site_reports (upsert ต่อ project). */
export interface UpsertSiteReportInput {
  projectId: number;
  registrar: string | null;
  domainCreatedAt: Date | null;
  metaDescription: string | null;
  refdomainsNew: number | null;
  refdomainsLost: number | null;
  spamScore: number | null;
  aiMentions: number | null;
  analysis: SiteAnalysis | null;
}

/** row site_reports (read) — generatedAt บอกความสดของรายงาน. */
export interface SiteReportRow {
  registrar: string | null;
  domainCreatedAt: Date | null;
  metaDescription: string | null;
  refdomainsNew: number | null;
  refdomainsLost: number | null;
  spamScore: number | null;
  aiMentions: number | null;
  analysis: SiteAnalysis | null;
  generatedAt: Date;
}

/** analysis เก็บเป็น json — mysql2 คืน object แล้ว แต่กันเคส string (best-effort parse). */
function parseAnalysis(v: unknown): SiteAnalysis | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as SiteAnalysis;
    } catch {
      return null;
    }
  }
  return v as SiteAnalysis;
}

/**
 * SiteReportRepo — Drizzle query ของรายงานเว็บเต็ม: อ่าน meta หน้าแรก + upsert/read site_reports +
 * บันทึก ai_runs (token usage). field core (DR/BL/organic/keyword/competitors) อ่านผ่าน AhrefsRepo เดิม.
 */
@Injectable()
export class SiteReportRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * meta description + title หน้าแรกของ project (homepage = page ที่ url สั้นสุด) จาก snapshot
   * ล่าสุด. ใช้เป็น Description ของรายงาน. null = ยังไม่ crawl/ไม่มี snapshot.
   */
  async getHomepageMeta(
    projectId: number,
  ): Promise<{ metaDescription: string | null; title: string | null } | null> {
    const pageRows = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.projectId, projectId))
      .orderBy(sql`char_length(${pages.url})`)
      .limit(1);
    const pageId = pageRows[0]?.id;
    if (!pageId) return null;
    const snap = await this.db
      .select({
        metaDescription: pageSnapshots.metaDescription,
        title: pageSnapshots.title,
      })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.pageId, pageId))
      .orderBy(desc(pageSnapshots.createdAt))
      .limit(1);
    return snap[0] ?? null;
  }

  /** upsert site_reports (uq project_id) — รายงานล่าสุดเสมอ. */
  async upsert(input: UpsertSiteReportInput): Promise<void> {
    const set = {
      registrar: input.registrar,
      domainCreatedAt: input.domainCreatedAt,
      metaDescription: input.metaDescription,
      refdomainsNew: input.refdomainsNew,
      refdomainsLost: input.refdomainsLost,
      spamScore: input.spamScore,
      aiMentions: input.aiMentions,
      analysis: input.analysis,
      generatedAt: new Date(),
    };
    await this.db
      .insert(siteReports)
      .values({ projectId: input.projectId, ...set })
      .onDuplicateKeyUpdate({ set });
  }

  /** อ่านรายงานล่าสุด (null = ยังไม่เคย generate). */
  async get(projectId: number): Promise<SiteReportRow | null> {
    const rows = await this.db
      .select({
        registrar: siteReports.registrar,
        domainCreatedAt: siteReports.domainCreatedAt,
        metaDescription: siteReports.metaDescription,
        refdomainsNew: siteReports.refdomainsNew,
        refdomainsLost: siteReports.refdomainsLost,
        spamScore: siteReports.spamScore,
        aiMentions: siteReports.aiMentions,
        analysis: siteReports.analysis,
        generatedAt: siteReports.generatedAt,
      })
      .from(siteReports)
      .where(eq(siteReports.projectId, projectId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return { ...r, analysis: parseAnalysis(r.analysis) };
  }

  /**
   * บันทึก 1 ai_run (graph='site_report', status=done) → token/credit usage analytics (/ai/usage).
   * pageId null ∵ site-level (ไม่ผูกหน้า). best-effort: error ไม่ทำให้รายงานพัง (caller จับ).
   */
  async recordAiRun(input: {
    projectId: number;
    userId?: number | null;
    models: unknown;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    await this.db.insert(aiRuns).values({
      projectId: input.projectId,
      userId: input.userId ?? null,
      pageId: null,
      graph: 'site_report',
      models: input.models,
      status: 'done',
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      finishedAt: new Date(),
    });
  }
}
