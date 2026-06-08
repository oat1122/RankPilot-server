import { CacheLayer } from './cache.layer';
import type { RedisClient } from '../../redis/redis.module';
import type { AhrefsRepo } from '../ahrefs.repo';

function make(opts: {
  hot?: string | null;
  durable?: { response: unknown } | null;
}) {
  const redis = {
    get: jest.fn().mockResolvedValue(opts.hot ?? null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
  const repo = {
    findFreshCache: jest.fn().mockResolvedValue(opts.durable ?? null),
  };
  const layer = new CacheLayer(
    redis as unknown as RedisClient,
    repo as unknown as AhrefsRepo,
  );
  return { layer, redis, repo };
}

describe('CacheLayer.get (เอกสาร 03 §6 — สองชั้น hot→durable)', () => {
  it('hot hit → JSON.parse(hot) ไม่แตะ durable', async () => {
    const obj = { keywords: [{ keyword: 'seo' }] };
    const { layer, repo } = make({ hot: JSON.stringify(obj) });
    expect(await layer.get('ep', 'h')).toEqual(obj);
    expect(repo.findFreshCache).not.toHaveBeenCalled();
  });

  // regression: ahrefs_cache.response เป็น json() column → driver คืนเป็น string;
  // ก่อนแก้ get() คืน string ตรง ๆ → extractRowArray = [] (rows=0 เงียบ) + setex double-encode
  it('durable hit ที่ response เป็น JSON string → parse คืน object + hot ไม่ double-encode', async () => {
    const obj = { keywords: [{ keyword: 'a' }, { keyword: 'b' }] };
    const { layer, redis } = make({
      hot: null,
      durable: { response: JSON.stringify(obj) },
    });

    const out = await layer.get('ep', 'h');

    expect(out).toEqual(obj); // คืน object จริง ไม่ใช่ string
    expect(typeof out).toBe('object');
    // hot ที่เติมกลับต้อง parse กลับเป็น object เดิม (ไม่ใช่ "\"{...}\"" double-encoded)
    const calls = redis.setex.mock.calls as [string, number, string][];
    expect(JSON.parse(calls[0][2])).toEqual(obj);
  });

  it('durable hit ที่ response เป็น object อยู่แล้ว → คืนตรง ๆ', async () => {
    const obj = { x: 1 };
    const { layer } = make({ hot: null, durable: { response: obj } });
    expect(await layer.get('ep', 'h')).toEqual(obj);
  });

  it('miss ทั้งสองชั้น → null', async () => {
    const { layer } = make({ hot: null, durable: null });
    expect(await layer.get('ep', 'h')).toBeNull();
  });
});
