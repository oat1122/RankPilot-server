import { of } from 'rxjs';
import { SitemapService } from './sitemap.service';

/**
 * SitemapService.discover — mock HttpService (axios) ตอบ robots/sitemap. ยืนยัน parse urlset,
 * recurse sitemapindex, กรอง same-host, และ seed หน้าแรกเสมอ.
 */
function make(responses: Record<string, { status?: number; data: string }>) {
  const http = {
    get: jest.fn((url: string) =>
      of({
        status: responses[url]?.status ?? (responses[url] ? 200 : 404),
        data: responses[url]?.data ?? '',
        headers: {},
      }),
    ),
  };
  const config = {
    get: jest.fn((k: string) =>
      k === 'CRAWLER_SITEMAP_MAX_URLS' ? 2000 : undefined,
    ),
  };
  const svc = new SitemapService(
    http as unknown as ConstructorParameters<typeof SitemapService>[0],
    config as unknown as ConstructorParameters<typeof SitemapService>[1],
  );
  return { svc, http };
}

describe('SitemapService.discover', () => {
  it('robots Sitemap: → urlset → กรอง same-host + seed หน้าแรก', async () => {
    const { svc } = make({
      'https://example.com/robots.txt': {
        data: 'User-agent: *\nSitemap: https://example.com/sitemap.xml\n',
      },
      'https://example.com/sitemap.xml': {
        data: `<?xml version="1.0"?><urlset>
          <url><loc>https://example.com/a</loc></url>
          <url><loc>https://example.com/b</loc></url>
          <url><loc>https://other.com/x</loc></url>
        </urlset>`,
      },
    });

    const urls = await svc.discover('example.com');

    expect(urls).toContain('https://example.com/'); // seed หน้าแรกเสมอ
    expect(urls).toContain('https://example.com/a');
    expect(urls).toContain('https://example.com/b');
    expect(urls).not.toContain('https://other.com/x'); // ต่าง host → ตัด
  });

  it('sitemapindex → recurse ไป sitemap ลูก', async () => {
    const { svc } = make({
      'https://example.com/robots.txt': { status: 404, data: '' },
      'https://example.com/sitemap.xml': {
        data: `<?xml version="1.0"?><sitemapindex>
          <sitemap><loc>https://example.com/sm-1.xml</loc></sitemap>
        </sitemapindex>`,
      },
      'https://example.com/sm-1.xml': {
        data: `<?xml version="1.0"?><urlset>
          <url><loc>https://example.com/deep</loc></url>
        </urlset>`,
      },
    });

    const urls = await svc.discover('example.com');

    expect(urls).toContain('https://example.com/deep');
  });

  it('ไม่มี sitemap (อ่านไม่ได้) → คืนแค่หน้าแรก', async () => {
    const { svc } = make({}); // ทุก request 404
    const urls = await svc.discover('example.com');
    expect(urls).toEqual(['https://example.com/']);
  });
});
