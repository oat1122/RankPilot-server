import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { AppException, ErrorCode } from '../common/http';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { aiSettings, aiSkills } from '../db/schema';
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

  async createSkill(
    projectId: number,
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
