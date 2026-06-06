import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { AxiosResponse } from 'axios';
import { AhrefsClient } from './ahrefs.client';
import type { AhrefsFetchOptions } from './ahrefs.client';
import { ErrorCode } from '../common/http';
import type { BudgetGuard } from './budget.guard';
import type { CacheLayer } from './cache.layer';
import type { AhrefsRepo } from './ahrefs.repo';

function makeResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): AxiosResponse {
  return {
    data,
    status,
    statusText: 'OK',
    headers,
    config: {} as AxiosResponse['config'],
    request: {},
  } as AxiosResponse;
}

const OPTS: AhrefsFetchOptions = {
  projectId: 1,
  endpoint: 'site-explorer/organic-keywords',
  params: { target: 'example.com' },
  fields: ['keyword', 'volume'], // estimate = 50 + (1+1)*2 = 54
  expectedRows: 2,
  ttlSec: 100,
  cap: 100_000,
};
const ESTIMATE = 54;

function makeClient(
  over: {
    cacheGet?: unknown;
    response?: AxiosResponse;
    httpThrows?: Error;
    apiKey?: string | undefined;
  } = {},
) {
  const cache = {
    get: jest.fn().mockResolvedValue(over.cacheGet ?? null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const budget = {
    reserve: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(undefined),
  };
  const repo = { bumpUsage: jest.fn().mockResolvedValue(undefined) };
  const apiKey = 'apiKey' in over ? over.apiKey : 'test-key';
  const config = {
    get: (k: string) =>
      ({
        AHREFS_API_KEY: apiKey,
        AHREFS_API_BASE_URL: 'https://api.ahrefs.com/v3',
      })[k],
  } as unknown as ConfigService;
  const http = {
    get: jest
      .fn()
      .mockReturnValue(
        over.httpThrows
          ? throwError(() => over.httpThrows)
          : of(over.response ?? makeResponse({ keywords: [] })),
      ),
  };

  const client = new AhrefsClient(
    http as unknown as HttpService,
    config,
    budget as unknown as BudgetGuard,
    cache as unknown as CacheLayer,
    repo as unknown as AhrefsRepo,
  );
  return { client, cache, budget, repo, http };
}

describe('AhrefsClient.fetch (facade — เอกสาร 03 §6)', () => {
  it('cache hit → คืนเลย ไม่แตะ budget/http', async () => {
    const cached = { keywords: [{ keyword: 'seo' }] };
    const { client, budget, http } = makeClient({ cacheGet: cached });

    const res = await client.fetch(OPTS);

    expect(res).toEqual({
      data: cached,
      unitsSpent: 0,
      rows: 1,
      cached: true,
    });
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('cache miss happy path → reserve→http→settle(actual)→cache→bumpUsage', async () => {
    const data = { keywords: [{ keyword: 'a' }, { keyword: 'b' }] };
    const { client, cache, budget, repo, http } = makeClient({
      response: makeResponse(data, 200, { 'x-units-cost': '70' }),
    });

    const res = await client.fetch(OPTS);

    expect(budget.reserve).toHaveBeenCalledWith(
      1,
      expect.any(String),
      ESTIMATE,
      100_000,
    );
    // select แคบ + url ประกอบจาก base + endpoint
    const [calledUrl, calledCfg] = http.get.mock.calls[0] as [
      string,
      { params: Record<string, unknown> },
    ];
    expect(calledUrl).toBe(
      'https://api.ahrefs.com/v3/site-explorer/organic-keywords',
    );
    expect(calledCfg.params.select).toBe('keyword,volume');
    // settle ด้วย units จริงจาก header (70 ≠ estimate 54)
    expect(budget.settle).toHaveBeenCalledWith(
      1,
      expect.any(String),
      ESTIMATE,
      70,
    );
    expect(cache.set).toHaveBeenCalled();
    expect(repo.bumpUsage).toHaveBeenCalledWith(1, expect.any(String), 70);
    expect(res).toMatchObject({ unitsSpent: 70, rows: 2, cached: false });
  });

  it('fallback ใช้ estimate เมื่อไม่มี header x-units-cost', async () => {
    const { client, budget, repo } = makeClient({
      response: makeResponse({ keywords: [{ keyword: 'a' }] }, 200),
    });
    const res = await client.fetch(OPTS);
    expect(res.unitsSpent).toBe(ESTIMATE);
    expect(repo.bumpUsage).toHaveBeenCalledWith(
      1,
      expect.any(String),
      ESTIMATE,
    );
    expect(budget.settle).toHaveBeenCalledWith(
      1,
      expect.any(String),
      ESTIMATE,
      ESTIMATE,
    );
  });

  it('ไม่มี AHREFS_API_KEY (cache miss) → throw AHREFS_UNAUTHORIZED ก่อน reserve', async () => {
    const { client, budget } = makeClient({ apiKey: undefined });
    await expect(client.fetch(OPTS)).rejects.toMatchObject({
      code: ErrorCode.AHREFS_UNAUTHORIZED,
    });
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it('HTTP 401 → AHREFS_UNAUTHORIZED + คืนงบ (settle actual=0)', async () => {
    const { client, budget } = makeClient({
      response: makeResponse({ error: 'unauthorized' }, 401),
    });
    await expect(client.fetch(OPTS)).rejects.toMatchObject({
      code: ErrorCode.AHREFS_UNAUTHORIZED,
    });
    expect(budget.settle).toHaveBeenCalledWith(
      1,
      expect.any(String),
      ESTIMATE,
      0,
    );
  });

  it('HTTP 429 → AHREFS_RATE_LIMITED', async () => {
    const { client } = makeClient({
      response: makeResponse({ error: 'rate limited' }, 429),
    });
    await expect(client.fetch(OPTS)).rejects.toMatchObject({
      code: ErrorCode.AHREFS_RATE_LIMITED,
    });
  });

  it('network error → AHREFS_API_ERROR + คืนงบ', async () => {
    const { client, budget } = makeClient({
      httpThrows: new Error('ECONNREFUSED'),
    });
    await expect(client.fetch(OPTS)).rejects.toMatchObject({
      code: ErrorCode.AHREFS_API_ERROR,
    });
    expect(budget.settle).toHaveBeenCalledWith(
      1,
      expect.any(String),
      ESTIMATE,
      0,
    );
  });

  it('refund (settle) ที่ reject ตอน network error ต้องไม่กลบ AHREFS_API_ERROR', async () => {
    const { client, budget } = makeClient({
      httpThrows: new Error('ECONNREFUSED'),
    });
    // Redis ล่มพอดีตอนคืนงบ — error เดิม (typed) ต้องไม่ถูกแทนด้วย error ดิบของ Redis
    budget.settle.mockRejectedValue(new Error('redis down'));
    await expect(client.fetch(OPTS)).rejects.toMatchObject({
      code: ErrorCode.AHREFS_API_ERROR,
    });
  });

  it('refund (settle) ที่ reject ตอน HTTP 401 ต้องไม่กลบ AHREFS_UNAUTHORIZED', async () => {
    const { client, budget } = makeClient({
      response: makeResponse({ error: 'unauthorized' }, 401),
    });
    budget.settle.mockRejectedValue(new Error('redis down'));
    await expect(client.fetch(OPTS)).rejects.toMatchObject({
      code: ErrorCode.AHREFS_UNAUTHORIZED,
    });
  });
});
