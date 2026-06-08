import type { ModelCfg } from './openrouter';

/**
 * role → model resolution (เอกสาร 02 §3). โหนดอ้าง model ด้วย "role" ไม่ผูก vendor.
 * Phase 1: คืน DEFAULTS ฮาร์ดโค้ด (ยังไม่อ่าน ai_settings ต่อโปรเจค — เลื่อนไป Phase 5).
 */
export type Role = 'reasoner' | 'worker' | 'cheap';

/**
 * Default mapping → Claude ผ่าน OpenRouter. slug ยืนยันแล้วจาก GET /api/v1/models
 * (2026-06-08): ทั้งสามตัวมี supported_parameters ∋ structured_outputs + response_format.
 * เรียง role ตามความยาก (reasoner→worker→cheap) เพื่อคุมต้นทุน (เอกสาร 02 §8).
 */
export const DEFAULTS: Record<Role, ModelCfg> = {
  reasoner: { modelId: 'anthropic/claude-opus-4.8', maxTokens: 3072 },
  worker: { modelId: 'anthropic/claude-sonnet-4.6', maxTokens: 2048 },
  cheap: { modelId: 'anthropic/claude-haiku-4.5', maxTokens: 1024 },
};

/**
 * resolve cfg ของ role. Phase 1 คืน DEFAULTS ตรง ๆ. Phase 5 จะเพิ่มพารามิเตอร์ projectId
 * แล้ว override ด้วย ai_settings ต่อโปรเจค (เอกสาร 02 §3) — เก็บเป็น async ตอนนั้น.
 */
export function resolveModelCfg(role: Role): ModelCfg {
  return DEFAULTS[role];
}
