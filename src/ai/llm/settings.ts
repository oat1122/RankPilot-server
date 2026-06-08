import { z } from 'zod';
import { DEFAULTS } from './resolve';
import type { Role } from './resolve';
import type { ModelCfg } from './openrouter';

/**
 * ai_settings — เลือก model ต่อโปรเจค (เอกสาร 02 §3 / Phase 5). Zod ตัวเดียวใช้ทั้ง DTO (PUT) +
 * validate ก่อนเก็บ json. role → cfg; ฟิลด์ที่ไม่ตั้งจะถูก merge เติมจาก DEFAULTS (mergeModelCfg).
 */

export const ModelCfgSchema = z.object({
  modelId: z.string().min(1), // openrouter id เช่น 'anthropic/claude-sonnet-4.6'
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const AiSettingsSchema = z.object({
  // ตั้งเฉพาะ role ที่อยาก override ได้ (ที่เหลือ fallback DEFAULTS)
  models: z.object({
    reasoner: ModelCfgSchema.optional(),
    worker: ModelCfgSchema.optional(),
    cheap: ModelCfgSchema.optional(),
  }),
  provider: z
    .object({
      require_parameters: z.boolean().optional(),
      sort: z.enum(['price', 'throughput', 'latency']).optional(),
    })
    .optional(),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/**
 * merge cfg ของ role: override จาก settings ทับ DEFAULTS รายฟิลด์ (modelId/temperature/maxTokens).
 * settings null หรือ role ไม่ได้ตั้ง → คืน DEFAULTS[role] ตรง ๆ. pure → unit test ได้.
 */
export function mergeModelCfg(
  role: Role,
  settings: AiSettings | null | undefined,
): ModelCfg {
  const base = DEFAULTS[role];
  const override = settings?.models?.[role];
  if (!override) return base;
  return {
    modelId: override.modelId || base.modelId,
    temperature: override.temperature ?? base.temperature,
    maxTokens: override.maxTokens ?? base.maxTokens,
  };
}

/** map role→modelId ที่ใช้จริง (snapshot ลง ai_runs.models — เอกสาร 02 §6). */
export function resolveModelMap(
  settings: AiSettings | null | undefined,
): Record<Role, string> {
  return {
    reasoner: mergeModelCfg('reasoner', settings).modelId,
    worker: mergeModelCfg('worker', settings).modelId,
    cheap: mergeModelCfg('cheap', settings).modelId,
  };
}
