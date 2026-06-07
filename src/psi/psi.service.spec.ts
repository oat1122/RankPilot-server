import { of } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { AxiosResponse } from 'axios';
import { PsiService } from './psi.service';

function makeResponse(data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse['config'],
  } as AxiosResponse;
}

function makeService(
  response: AxiosResponse,
  overrides: Record<string, unknown> = {},
) {
  const httpGet = jest.fn().mockReturnValue(of(response));
  const http = { get: httpGet } as unknown as HttpService;
  const defaults: Record<string, unknown> = {
    PSI_ENABLED: true,
    PSI_BASE_URL: 'https://psi.test/runPagespeed',
    PSI_STRATEGY: 'mobile',
    PSI_API_KEY: undefined,
    PSI_TIMEOUT_MS: 30000,
    ...overrides,
  };
  const config = {
    get: (k: string) => defaults[k],
  } as unknown as ConfigService;
  return { service: new PsiService(http, config), httpGet };
}

describe('PsiService.cwv', () => {
  it('field (CrUX) ก่อน: lcp/inp = percentile (ms), cls = percentile×10 (=CLS×1000)', async () => {
    const data = {
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2500 },
          INTERACTION_TO_NEXT_PAINT: { percentile: 200 },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 15 }, // CLS 0.15
        },
      },
    };
    const { service } = makeService(makeResponse(data));
    await expect(service.cwv('https://x.com')).resolves.toEqual({
      lcpMs: 2500,
      inpMs: 200,
      clsX1000: 150,
    });
  });

  it('ไม่มี field → fallback lab (Lighthouse): ปัด ms + cls×1000', async () => {
    const data = {
      lighthouseResult: {
        audits: {
          'largest-contentful-paint': { numericValue: 2499.6 },
          'interaction-to-next-paint': { numericValue: 180.4 },
          'cumulative-layout-shift': { numericValue: 0.053 },
        },
      },
    };
    const { service } = makeService(makeResponse(data));
    await expect(service.cwv('https://x.com')).resolves.toEqual({
      lcpMs: 2500,
      inpMs: 180,
      clsX1000: 53,
    });
  });

  it('non-2xx → null ทุกตัว (best-effort, ไม่ throw)', async () => {
    const { service } = makeService(makeResponse({}, 429));
    await expect(service.cwv('https://x.com')).resolves.toEqual({
      lcpMs: null,
      clsX1000: null,
      inpMs: null,
    });
  });

  it('PSI_ENABLED=false → null ทุกตัว และไม่ยิง HTTP', async () => {
    const { service, httpGet } = makeService(makeResponse({}), {
      PSI_ENABLED: false,
    });
    await expect(service.cwv('https://x.com')).resolves.toEqual({
      lcpMs: null,
      clsX1000: null,
      inpMs: null,
    });
    expect(httpGet).not.toHaveBeenCalled();
  });
});
