import { AiSettingsSchema, mergeModelCfg, resolveModelMap } from './settings';
import { DEFAULTS } from './resolve';

describe('AiSettingsSchema', () => {
  it('ผ่านเมื่อตั้งบาง role + modelId อย่างเดียว', () => {
    const r = AiSettingsSchema.safeParse({
      models: { reasoner: { modelId: 'openai/gpt-5' } },
    });
    expect(r.success).toBe(true);
  });

  it('fail เมื่อ modelId ว่าง', () => {
    const r = AiSettingsSchema.safeParse({
      models: { worker: { modelId: '' } },
    });
    expect(r.success).toBe(false);
  });

  it('fail เมื่อ temperature เกินช่วง 0-2', () => {
    const r = AiSettingsSchema.safeParse({
      models: { cheap: { modelId: 'x', temperature: 3 } },
    });
    expect(r.success).toBe(false);
  });
});

describe('mergeModelCfg', () => {
  it('settings null → DEFAULTS ตรง ๆ', () => {
    expect(mergeModelCfg('reasoner', null)).toEqual(DEFAULTS.reasoner);
  });

  it('override modelId อย่างเดียว → เก็บ maxTokens จาก DEFAULTS', () => {
    const cfg = mergeModelCfg('worker', {
      models: { worker: { modelId: 'google/gemini-2.5-pro' } },
    });
    expect(cfg.modelId).toBe('google/gemini-2.5-pro');
    expect(cfg.maxTokens).toBe(DEFAULTS.worker.maxTokens);
  });

  it('override temperature/maxTokens ทับรายฟิลด์', () => {
    const cfg = mergeModelCfg('cheap', {
      models: { cheap: { modelId: 'x', temperature: 0.9, maxTokens: 512 } },
    });
    expect(cfg).toEqual({ modelId: 'x', temperature: 0.9, maxTokens: 512 });
  });

  it('role ที่ไม่ได้ตั้งใน settings → DEFAULTS', () => {
    const cfg = mergeModelCfg('reasoner', {
      models: { worker: { modelId: 'x' } },
    });
    expect(cfg).toEqual(DEFAULTS.reasoner);
  });
});

describe('resolveModelMap', () => {
  it('null → DEFAULTS ทั้งสาม role', () => {
    expect(resolveModelMap(null)).toEqual({
      reasoner: DEFAULTS.reasoner.modelId,
      worker: DEFAULTS.worker.modelId,
      cheap: DEFAULTS.cheap.modelId,
    });
  });

  it('override บาง role → สะท้อนใน map', () => {
    const map = resolveModelMap({
      models: { reasoner: { modelId: 'opus-x' } },
    });
    expect(map.reasoner).toBe('opus-x');
    expect(map.worker).toBe(DEFAULTS.worker.modelId);
  });
});
