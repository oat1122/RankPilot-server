import { mkModel } from './openrouter';
import type { OpenRouterConn } from './openrouter';
import { DEFAULTS } from './resolve';
import { AppException, ErrorCode } from '../../common/http';

const baseConn: OpenRouterConn = {
  baseURL: 'https://openrouter.ai/api/v1',
  siteUrl: 'https://app.rankpilot',
  appTitle: 'RankPilot',
};

describe('mkModel', () => {
  it('โยน AI_NOT_CONFIGURED เมื่อไม่มี apiKey', () => {
    expect(() => mkModel(DEFAULTS.worker, baseConn)).toThrow(AppException);
    try {
      mkModel(DEFAULTS.worker, baseConn);
    } catch (e) {
      expect((e as AppException).code).toBe(ErrorCode.AI_NOT_CONFIGURED);
    }
  });

  it('สร้าง ChatOpenAI ได้เมื่อมี apiKey (ไม่ยิง network)', () => {
    const m = mkModel(DEFAULTS.cheap, { ...baseConn, apiKey: 'sk-test' });
    expect(m).toBeDefined();
  });
});
