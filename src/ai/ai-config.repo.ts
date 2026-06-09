import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { AppException, ErrorCode } from '../common/http';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { aiRuns, aiSettings, aiSkills, projects, users } from '../db/schema';
import {
  AiSettingsSchema,
  mergeModelCfg,
  resolveModelMap as resolveMapPure,
} from './llm/settings';
import type { AiSettings } from './llm/settings';
import type { Role } from './llm/resolve';
import type { ModelCfg } from './llm/openrouter';
import { appliesToNode } from './skills/render';
import type { Skill } from './skills/render';

/** parse JSON ถ้าเป็น string (driver คืน json column เป็น string — ดู memory). */
function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function toStringArray(v: unknown): string[] {
  const o = parseJson(v);
  return Array.isArray(o)
    ? o.filter((x): x is string => typeof x === 'string')
    : [];
}

export interface CreateSkillInput {
  slug: string;
  name: string;
  description: string;
  body: string;
  appliesTo: string[];
  enabled?: boolean;
  priority?: number;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  body?: string;
  appliesTo?: string[];
  priority?: number;
}

export interface SkillListItem extends Skill {
  id: number;
  projectId: number | null;
  enabled: boolean;
}

/** filter ของ admin AI usage report (ทุกฟิลด์ optional → ไม่ใส่ = ทั้งหมด). */
export interface AiUsageFilter {
  periodFrom?: string; // 'YYYY-MM'
  periodTo?: string; // 'YYYY-MM'
  userId?: number; // effective user (user_id หรือ project owner)
  projectId?: number;
  model?: string; // reasoner model id
}

/** 1 แถวสรุป usage: user × model(หลัก=reasoner) × เดือน — token รวมต่อ run (แยกราย role ไม่ได้). */
export interface AiUsageRow {
  userId: number | null;
  email: string | null;
  period: string; // 'YYYY-MM'
  model: string; // reasoner model id ของ run ('unknown' ถ้าไม่มี snapshot)
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  runs: number;
  ownerAttributedRuns: number; // run ที่ user_id เป็น null → attribute ผ่าน project owner
}

/**
 * AiConfigRepo — ai_settings (เลือก model ต่อโปรเจค §3) + ai_skills (ฉีดความรู้รายโหนด §4),
 * Phase 5. แยกจาก AiRepo (runs/recommendations/context) ตามโดเมน. ใช้โดย graph prep (resolve
 * model+skills ต่อ node), runner (snapshot models), และ AiConfigService (CRUD endpoints).
 * อ่าน DB ต่อ node ไม่ cache (perf optimization เลื่อน — เอกสาร 02 §3 caching อยู่ที่ /ai/models).
 */
@Injectable()
export class AiConfigRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ---------- settings ---------- */

  /**
   * ai_settings ที่ใช้ได้ผล: เลือก row ของ project นี้ก่อน, ไม่มี → global (projectId null),
   * ไม่มีอีก → null (DEFAULTS ทั้งชุด). validate ด้วย AiSettingsSchema (json col คืน string).
   */
  async getSettings(projectId: number): Promise<AiSettings | null> {
    const rows = await this.db
      .select({ models: aiSettings.models, provider: aiSettings.provider })
      .from(aiSettings)
      .where(
        or(eq(aiSettings.projectId, projectId), isNull(aiSettings.projectId)),
      )
      // project-specific (project_id IS NULL = 0) มาก่อน global (= 1)
      .orderBy(sql`${aiSettings.projectId} is null`)
      .limit(1);
    if (!rows.length) return null;
    const parsed = AiSettingsSchema.safeParse({
      models: parseJson(rows[0].models) ?? {},
      provider: parseJson(rows[0].provider) ?? undefined,
    });
    return parsed.success ? parsed.data : null;
  }

  /** upsert settings ของ project (uq บน project_id) — validate ก่อนเรียก (DTO). */
  async upsertSettings(projectId: number, data: AiSettings): Promise<void> {
    await this.db
      .insert(aiSettings)
      .values({
        projectId,
        models: data.models,
        provider: data.provider ?? null,
      })
      .onDuplicateKeyUpdate({
        set: { models: data.models, provider: data.provider ?? null },
      });
  }

  /** map role→modelId ที่ใช้จริงของ project (runner snapshot ลง ai_runs.models). */
  async resolveModelMap(projectId: number): Promise<Record<Role, string>> {
    return resolveMapPure(await this.getSettings(projectId));
  }

  /** cfg ของ (project, role) — settings override DEFAULTS (graph prep). */
  async resolveModelCfg(projectId: number, role: Role): Promise<ModelCfg> {
    return mergeModelCfg(role, await this.getSettings(projectId));
  }

  /** global default settings (projectId IS NULL) — null = ยังไม่ตั้ง (ใช้ DEFAULTS). /ai/settings. */
  async getGlobalSettings(): Promise<AiSettings | null> {
    const rows = await this.db
      .select({ models: aiSettings.models, provider: aiSettings.provider })
      .from(aiSettings)
      .where(isNull(aiSettings.projectId))
      .limit(1);
    if (!rows.length) return null;
    const parsed = AiSettingsSchema.safeParse({
      models: parseJson(rows[0].models) ?? {},
      provider: parseJson(rows[0].provider) ?? undefined,
    });
    return parsed.success ? parsed.data : null;
  }

  /**
   * upsert global default (projectId NULL). uniqueIndex บน project_id ไม่ dedupe NULL ใน MariaDB
   * (หลาย NULL = หลาย row) → onDuplicateKeyUpdate ใช้ไม่ได้ ต้อง manual: มี row → update, ไม่มี → insert.
   */
  async upsertGlobalSettings(data: AiSettings): Promise<void> {
    const existing = await this.db
      .select({ id: aiSettings.id })
      .from(aiSettings)
      .where(isNull(aiSettings.projectId))
      .limit(1);
    if (existing.length) {
      await this.db
        .update(aiSettings)
        .set({ models: data.models, provider: data.provider ?? null })
        .where(eq(aiSettings.id, existing[0].id));
    } else {
      await this.db.insert(aiSettings).values({
        projectId: null,
        models: data.models,
        provider: data.provider ?? null,
      });
    }
  }

  /** map role→modelId ของ global default (merge DEFAULTS) — view สำหรับ /ai/settings. */
  async resolveGlobalModelMap(): Promise<Record<Role, string>> {
    return resolveMapPure(await this.getGlobalSettings());
  }

  /* ---------- skills ---------- */

  /** skill ที่ enabled + (project นี้ หรือ global) + apply กับ node นี้ เรียง priority desc (graph prep). */
  async resolveSkillsForNode(
    projectId: number,
    node: string,
  ): Promise<Skill[]> {
    const rows = await this.db
      .select()
      .from(aiSkills)
      .where(
        and(
          eq(aiSkills.enabled, true),
          or(eq(aiSkills.projectId, projectId), isNull(aiSkills.projectId)),
        ),
      )
      .orderBy(desc(aiSkills.priority));
    return rows
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        description: r.description,
        body: r.body,
        appliesTo: toStringArray(r.appliesTo),
        priority: r.priority,
      }))
      .filter((s) => appliesToNode(s.appliesTo, node));
  }

  /** skill ทั้งหมดที่เห็นได้ใน project (global + ของ project) พร้อมสถานะ enabled — dashboard. */
  async listSkills(projectId: number): Promise<SkillListItem[]> {
    const rows = await this.db
      .select()
      .from(aiSkills)
      .where(or(eq(aiSkills.projectId, projectId), isNull(aiSkills.projectId)))
      .orderBy(desc(aiSkills.priority));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId ?? null,
      slug: r.slug,
      name: r.name,
      description: r.description,
      body: r.body,
      appliesTo: toStringArray(r.appliesTo),
      enabled: r.enabled,
      priority: r.priority,
    }));
  }

  /** skill ของ global library เท่านั้น (projectId IS NULL) รวมที่ปิดอยู่ — /ai/skills (admin UI). */
  async listGlobalSkills(): Promise<SkillListItem[]> {
    const rows = await this.db
      .select()
      .from(aiSkills)
      .where(isNull(aiSkills.projectId))
      .orderBy(desc(aiSkills.priority));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId ?? null,
      slug: r.slug,
      name: r.name,
      description: r.description,
      body: r.body,
      appliesTo: toStringArray(r.appliesTo),
      enabled: r.enabled,
      priority: r.priority,
    }));
  }

  /** สร้าง skill — projectId number = ของ project, null = global library. */
  async createSkill(
    projectId: number | null,
    input: CreateSkillInput,
  ): Promise<number> {
    const [{ id }] = await this.db
      .insert(aiSkills)
      .values({
        projectId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        body: input.body,
        appliesTo: input.appliesTo,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
      })
      .$returningId();
    return id;
  }

  /** patch skill (body/appliesTo/priority/...) — throw AI_SKILL_NOT_FOUND ถ้าไม่มี. */
  async updateSkill(skillId: number, patch: UpdateSkillInput): Promise<void> {
    await this.assertSkillExists(skillId);
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.body !== undefined) set.body = patch.body;
    if (patch.appliesTo !== undefined) set.appliesTo = patch.appliesTo;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (Object.keys(set).length === 0) return;
    await this.db.update(aiSkills).set(set).where(eq(aiSkills.id, skillId));
  }

  /** เปิด/ปิด skill — throw AI_SKILL_NOT_FOUND ถ้าไม่มี. */
  async toggleSkill(skillId: number, enabled: boolean): Promise<void> {
    await this.assertSkillExists(skillId);
    await this.db
      .update(aiSkills)
      .set({ enabled })
      .where(eq(aiSkills.id, skillId));
  }

  /* ---------- usage analytics (admin — Phase 6 AI Settings) ---------- */

  /**
   * สรุป token usage ต่อ user × model(หลัก) × เดือน จาก ai_runs (admin only).
   * - "model" = reasoner ของ run (models snapshot) — token เป็นยอดรวมต่อ run แยกราย role ไม่ได้
   *   ∴ attribute ทั้ง run ให้ reasoner (model หลัก) ไม่ปั้นตัวเลขแยก worker/cheap.
   * - effective user = COALESCE(user_id, project.owner_id): run เก่าที่ยังไม่มี user_id → owner
   *   (นับใน ownerAttributedRuns เพื่อให้ FE ติดป้าย "via project owner").
   */
  async aiUsage(filter: AiUsageFilter): Promise<AiUsageRow[]> {
    const effUser = sql<number>`coalesce(${aiRuns.userId}, ${projects.ownerId})`;
    const period = sql<string>`date_format(${aiRuns.startedAt}, '%Y-%m')`;
    const model = sql<string>`coalesce(json_unquote(json_extract(${aiRuns.models}, '$.reasoner')), 'unknown')`;
    const totalTokens = sql<number>`sum(coalesce(${aiRuns.inputTokens}, 0) + coalesce(${aiRuns.outputTokens}, 0))`;

    const conds: SQL[] = [];
    if (filter.projectId != null)
      conds.push(eq(aiRuns.projectId, filter.projectId));
    if (filter.userId != null) conds.push(sql`${effUser} = ${filter.userId}`);
    if (filter.model) conds.push(sql`${model} = ${filter.model}`);
    if (filter.periodFrom) conds.push(sql`${period} >= ${filter.periodFrom}`);
    if (filter.periodTo) conds.push(sql`${period} <= ${filter.periodTo}`);

    const rows = await this.db
      .select({
        userId: effUser,
        email: users.email,
        period,
        model,
        inputTokens: sql<number>`sum(coalesce(${aiRuns.inputTokens}, 0))`,
        outputTokens: sql<number>`sum(coalesce(${aiRuns.outputTokens}, 0))`,
        totalTokens,
        runs: sql<number>`count(*)`,
        ownerAttributedRuns: sql<number>`sum(case when ${aiRuns.userId} is null then 1 else 0 end)`,
      })
      .from(aiRuns)
      .innerJoin(projects, eq(projects.id, aiRuns.projectId))
      .leftJoin(users, eq(users.id, effUser))
      .where(conds.length ? and(...conds) : undefined)
      .groupBy(effUser, users.email, period, model)
      .orderBy(desc(totalTokens));

    return rows.map((r) => ({
      userId: r.userId == null ? null : Number(r.userId),
      email: r.email ?? null,
      period: r.period,
      model: r.model,
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      totalTokens: Number(r.totalTokens),
      runs: Number(r.runs),
      ownerAttributedRuns: Number(r.ownerAttributedRuns),
    }));
  }

  private async assertSkillExists(skillId: number): Promise<void> {
    const rows = await this.db
      .select({ id: aiSkills.id })
      .from(aiSkills)
      .where(eq(aiSkills.id, skillId))
      .limit(1);
    if (!rows.length)
      throw new AppException(
        ErrorCode.AI_SKILL_NOT_FOUND,
        `ai skill ${skillId} not found`,
      );
  }
}
