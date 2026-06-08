import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AiSettingsSchema } from '../llm/settings';

/**
 * DTOs ของ AI config endpoints (Phase 5, เอกสาร 02 §3/§4) — model selection + skills.
 * reuse AiSettingsSchema (Zod เดียว) สำหรับ PUT settings (validate ก่อน upsert json).
 */

/* ---------- settings ---------- */

/** PUT /projects/:id/ai/settings — body = AiSettingsSchema (เลือก model ต่อ role). */
export class PutAiSettingsDto extends createZodDto(AiSettingsSchema) {}

/** GET/PUT settings response — settings ที่เก็บ (null = default) + map role→modelId ที่ใช้จริง. */
export const aiSettingsViewSchema = z.object({
  settings: AiSettingsSchema.nullable(),
  modelMap: z.object({
    reasoner: z.string(),
    worker: z.string(),
    cheap: z.string(),
  }),
});
export class AiSettingsViewDto extends createZodDto(aiSettingsViewSchema) {}

/* ---------- models proxy ---------- */

/** GET /ai/models — proxy รายการ model ของ OpenRouter (FE filter structured_outputs เอง). */
export const aiModelsSchema = z.object({
  data: z.array(z.unknown()),
  cachedAt: z.coerce.string(),
});
export class AiModelsDto extends createZodDto(aiModelsSchema) {}

/* ---------- skills ---------- */

const appliesToSchema = z
  .array(z.string().min(1).max(64))
  .min(1, 'ต้องระบุอย่างน้อย 1 โหนด (หรือ ["*"])');

/** POST /projects/:id/ai/skills — สร้าง skill ใหม่. */
export const createSkillSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(96)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug = a-z 0-9 และ - เท่านั้น'),
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(512),
  body: z.string().min(1),
  appliesTo: appliesToSchema,
  enabled: z.boolean().optional(),
  priority: z.coerce.number().int().min(-128).max(127).optional(),
});
export class CreateSkillDto extends createZodDto(createSkillSchema) {}

/** PATCH /ai/skills/:id — แก้ body/appliesTo/priority/ชื่อ (ทุกฟิลด์ optional). */
export const updateSkillSchema = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(512),
    body: z.string().min(1),
    appliesTo: appliesToSchema,
    priority: z.coerce.number().int().min(-128).max(127),
  })
  .partial();
export class UpdateSkillDto extends createZodDto(updateSkillSchema) {}

/** PATCH /ai/skills/:id/toggle — เปิด/ปิด. */
export const toggleSkillSchema = z.object({ enabled: z.boolean() });
export class ToggleSkillDto extends createZodDto(toggleSkillSchema) {}

/** 1 skill (global + ของ project) สำหรับ list. */
export const skillViewSchema = z.object({
  id: z.number(),
  projectId: z.number().nullable(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  body: z.string(),
  appliesTo: z.array(z.string()),
  enabled: z.boolean(),
  priority: z.number(),
});

/** GET skills — list. */
export const skillsListSchema = z.object({ items: z.array(skillViewSchema) });
export class SkillsListDto extends createZodDto(skillsListSchema) {}

/** POST skills — id ที่สร้าง. */
export const skillCreatedSchema = z.object({ id: z.number() });
export class SkillCreatedDto extends createZodDto(skillCreatedSchema) {}
