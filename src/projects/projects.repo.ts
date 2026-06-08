import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  ahrefsUsage,
  aiRecommendations,
  aiRuns,
  aiSettings,
  aiSkills,
  alerts,
  auditFindings,
  backlinkSnapshots,
  cannibalizationGroups,
  cannibalizationMembers,
  competitors,
  contentGaps,
  crawls,
  internalLinkOpportunities,
  keywordRankDaily,
  keywords,
  pageEmbeddings,
  pageImages,
  pageKeywords,
  pageLinks,
  pageSnapshots,
  pages,
  projects,
  seoScores,
  serpResults,
} from '../db/schema';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

/** projection ของ project ที่ส่งออก API (ตรงกับ projectSchema). */
const projectCols = {
  id: projects.id,
  name: projects.name,
  domain: projects.domain,
  country: projects.country,
  monthlyUnitBudget: projects.monthlyUnitBudget,
  createdAt: projects.createdAt,
};

/**
 * ProjectsRepo — read/write projects (เอกสาร 01 §2). inject DB token (@Global). ทุก query
 * scope ด้วย ownerId เพื่อ multi-tenant (เอกสาร 05 §4) — ไม่มี endpoint ไหนอ่าน project ข้าม owner.
 */
@Injectable()
export class ProjectsRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** projects ของ owner เรียงล่าสุดก่อน (ใช้ ix_projects_owner). */
  listByOwner(ownerId: number) {
    return this.db
      .select(projectCols)
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .orderBy(desc(projects.createdAt));
  }

  /** 1 project ที่ owner เป็นเจ้าของ — null ถ้าไม่มี/ไม่ใช่เจ้าของ. */
  async findOwned(projectId: number, ownerId: number) {
    const rows = await this.db
      .select(projectCols)
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** สร้าง project ใหม่ของ owner → คืน row ที่สร้าง (country มี default จาก DTO/schema). */
  async create(ownerId: number, dto: CreateProjectDto) {
    const [{ id }] = await this.db
      .insert(projects)
      .values({
        ownerId,
        name: dto.name,
        domain: dto.domain,
        country: dto.country,
      })
      .$returningId();
    const created = await this.findOwned(id, ownerId);
    return created;
  }

  /**
   * แก้ project ที่ owner เป็นเจ้าของ — set เฉพาะ field ที่ส่งมา (PATCH, undefined ไม่แตะ).
   * scope ด้วย ownerId → ไม่ใช่เจ้าของ = 0 row affected → findOwned คืน null (service เป็นคน 404).
   */
  async update(projectId: number, ownerId: number, dto: UpdateProjectDto) {
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.domain !== undefined) patch.domain = dto.domain;
    if (dto.country !== undefined) patch.country = dto.country;
    if (Object.keys(patch).length > 0) {
      await this.db
        .update(projects)
        .set(patch)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
    }
    return this.findOwned(projectId, ownerId);
  }

  /**
   * ลบ project + ลูกทั้งหมดใน transaction. ∵ schema ใช้ index ธรรมดา (ไม่มี hard FK/onDelete
   * cascade — ดู schema.ts หัวไฟล์) → ต้อง cascade เองชั้น service/repo มิฉะนั้นเหลือ orphan.
   * รวบรวม id ของ entity ลูก (page/crawl/keyword/run/group) ก่อน แล้วลบจากลูกสุด → ขึ้นบน → project.
   * NB: ahrefs_cache เป็น cache ระดับ global (key endpoint+paramsHash) ไม่ผูก project → ไม่ลบ.
   *     ai_checkpoints/ai_checkpoint_writes ผูกด้วย threadId (page:..:run:..) blob ของ LangGraph
   *     → ปล่อยเป็น orphan ที่ไม่ถูกอ่าน (ไม่กระทบ correctness).
   * caller (service) ตรวจ ownership ก่อนเรียกแล้ว; การลบ projects ตรงนี้ก็ scope ด้วย ownerId ซ้ำกันพลาด.
   */
  async remove(projectId: number, ownerId: number) {
    await this.db.transaction(async (tx) => {
      const pageIds = (
        await tx
          .select({ id: pages.id })
          .from(pages)
          .where(eq(pages.projectId, projectId))
      ).map((r) => r.id);
      const crawlIds = (
        await tx
          .select({ id: crawls.id })
          .from(crawls)
          .where(eq(crawls.projectId, projectId))
      ).map((r) => r.id);
      const keywordIds = (
        await tx
          .select({ id: keywords.id })
          .from(keywords)
          .where(eq(keywords.projectId, projectId))
      ).map((r) => r.id);
      const runIds = (
        await tx
          .select({ id: aiRuns.id })
          .from(aiRuns)
          .where(eq(aiRuns.projectId, projectId))
      ).map((r) => r.id);
      const groupIds = (
        await tx
          .select({ id: cannibalizationGroups.id })
          .from(cannibalizationGroups)
          .where(eq(cannibalizationGroups.projectId, projectId))
      ).map((r) => r.id);

      // snapshots ผูกด้วย crawlId หรือ pageId (ไม่มี projectId ตรง)
      const snapWhere: SQL[] = [];
      if (crawlIds.length)
        snapWhere.push(inArray(pageSnapshots.crawlId, crawlIds));
      if (pageIds.length)
        snapWhere.push(inArray(pageSnapshots.pageId, pageIds));
      const snapshotIds = snapWhere.length
        ? (
            await tx
              .select({ id: pageSnapshots.id })
              .from(pageSnapshots)
              .where(snapWhere.length === 1 ? snapWhere[0] : or(...snapWhere))
          ).map((r) => r.id)
        : [];

      // ลูกสุด → ขึ้นบน
      if (snapshotIds.length) {
        await tx
          .delete(pageImages)
          .where(inArray(pageImages.snapshotId, snapshotIds));
        await tx
          .delete(seoScores)
          .where(inArray(seoScores.snapshotId, snapshotIds));
      }
      if (runIds.length)
        await tx
          .delete(aiRecommendations)
          .where(inArray(aiRecommendations.runId, runIds));
      if (groupIds.length)
        await tx
          .delete(cannibalizationMembers)
          .where(inArray(cannibalizationMembers.groupId, groupIds));
      if (keywordIds.length) {
        await tx
          .delete(serpResults)
          .where(inArray(serpResults.keywordId, keywordIds));
        await tx
          .delete(keywordRankDaily)
          .where(inArray(keywordRankDaily.keywordId, keywordIds));
      }
      if (pageIds.length)
        await tx
          .delete(pageKeywords)
          .where(inArray(pageKeywords.pageId, pageIds));
      if (crawlIds.length)
        await tx.delete(pageLinks).where(inArray(pageLinks.crawlId, crawlIds));
      if (snapshotIds.length)
        await tx
          .delete(pageSnapshots)
          .where(inArray(pageSnapshots.id, snapshotIds));

      // ตารางที่ผูก projectId ตรง ๆ
      await tx
        .delete(pageEmbeddings)
        .where(eq(pageEmbeddings.projectId, projectId));
      await tx
        .delete(backlinkSnapshots)
        .where(eq(backlinkSnapshots.projectId, projectId));
      await tx.delete(competitors).where(eq(competitors.projectId, projectId));
      await tx
        .delete(auditFindings)
        .where(eq(auditFindings.projectId, projectId));
      await tx.delete(contentGaps).where(eq(contentGaps.projectId, projectId));
      await tx
        .delete(internalLinkOpportunities)
        .where(eq(internalLinkOpportunities.projectId, projectId));
      await tx
        .delete(cannibalizationGroups)
        .where(eq(cannibalizationGroups.projectId, projectId));
      await tx.delete(aiRuns).where(eq(aiRuns.projectId, projectId));
      await tx.delete(aiSettings).where(eq(aiSettings.projectId, projectId));
      await tx.delete(aiSkills).where(eq(aiSkills.projectId, projectId));
      await tx.delete(alerts).where(eq(alerts.projectId, projectId));
      await tx.delete(ahrefsUsage).where(eq(ahrefsUsage.projectId, projectId));
      await tx.delete(keywords).where(eq(keywords.projectId, projectId));
      await tx.delete(pages).where(eq(pages.projectId, projectId));
      await tx.delete(crawls).where(eq(crawls.projectId, projectId));

      // project เอง (สุดท้าย) — scope ownerId ซ้ำกันพลาด
      await tx
        .delete(projects)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
    });
  }
}
