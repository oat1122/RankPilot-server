import { DEFAULTS, resolveModelCfg } from './resolve';

describe('resolveModelCfg', () => {
  it('คืน DEFAULT slug ตาม role (ยืนยันจาก /api/v1/models)', () => {
    expect(resolveModelCfg('reasoner').modelId).toBe(
      'anthropic/claude-opus-4.8',
    );
    expect(resolveModelCfg('worker').modelId).toBe(
      'anthropic/claude-sonnet-4.6',
    );
    expect(resolveModelCfg('cheap').modelId).toBe('anthropic/claude-haiku-4.5');
  });

  it('Phase 1 ไม่อ่าน ai_settings — คืน DEFAULTS ตรง ๆ', () => {
    expect(resolveModelCfg('worker')).toEqual(DEFAULTS.worker);
  });
});
