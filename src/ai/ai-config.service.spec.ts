import { AiConfigService } from './ai-config.service';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { AiConfigRepo, AiUsageRow } from './ai-config.repo';

/** สร้าง service โดย mock เฉพาะ repo (http/config ไม่ถูกใช้ในเทสนี้). */
function makeService(repo: Partial<AiConfigRepo>) {
  return new AiConfigService(
    {} as unknown as HttpService,
    {} as unknown as ConfigService,
    repo as unknown as AiConfigRepo,
  );
}

const row = (over: Partial<AiUsageRow>): AiUsageRow => ({
  userId: 1,
  email: 'a@x.com',
  period: '2026-06',
  model: 'm1',
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  runs: 0,
  ownerAttributedRuns: 0,
  ...over,
});

describe('AiConfigService.aiUsage (totals + distinct users)', () => {
  it('รวม token/runs และนับ distinct user (รวม row หลาย model ของคนเดียว = 1 คน)', async () => {
    const aiUsage = jest.fn().mockResolvedValue([
      row({
        userId: 1,
        model: 'm1',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        runs: 2,
      }),
      row({
        userId: 1,
        model: 'm2',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        runs: 1,
      }),
      row({
        userId: null,
        email: 'b@x.com',
        period: '2026-05',
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        runs: 3,
        ownerAttributedRuns: 3,
      }),
    ]);
    const service = makeService({ aiUsage });

    const res = await service.aiUsage({ periodFrom: '2026-05' });

    expect(aiUsage).toHaveBeenCalledWith({ periodFrom: '2026-05' });
    expect(res.items).toHaveLength(3);
    expect(res.totals).toEqual({
      totalTokens: 465,
      inputTokens: 310,
      outputTokens: 155,
      runs: 6,
      users: 2, // user 1 (สอง row model) + user ที่ attribute ผ่าน owner (email b@x.com)
    });
  });

  it('ไม่มี run → totals เป็นศูนย์ทั้งหมด', async () => {
    const service = makeService({ aiUsage: jest.fn().mockResolvedValue([]) });
    const res = await service.aiUsage({});
    expect(res.items).toEqual([]);
    expect(res.totals).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      runs: 0,
      users: 0,
    });
  });
});

describe('AiConfigService.createGlobalSkill', () => {
  it('delegate createSkill ด้วย projectId = null (global library)', async () => {
    const createSkill = jest.fn().mockResolvedValue(42);
    const service = makeService({ createSkill });

    const res = await service.createGlobalSkill({
      slug: 's',
      name: 'n',
      description: 'd',
      body: 'b',
      appliesTo: ['*'],
    });

    expect(createSkill).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ slug: 's' }),
    );
    expect(res).toEqual({ id: 42 });
  });
});
