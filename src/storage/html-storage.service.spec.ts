import type { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HtmlStorageService } from './html-storage.service';

function makeConfig(dir: string) {
  return {
    get: (k: string) => (k === 'HTML_STORAGE_DIR' ? dir : undefined),
  } as unknown as ConfigService;
}

const INPUT = {
  projectId: 1,
  crawlId: 2,
  urlHash: 'abc',
  html: '<html></html>',
};

describe('HtmlStorageService.putHtml', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rp-html-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('html null → ไม่เขียนไฟล์, คืน null', async () => {
    const svc = new HtmlStorageService(makeConfig(dir));
    await expect(svc.putHtml({ ...INPUT, html: null })).resolves.toBeNull();
  });

  it('สำเร็จ → คืน key .html.gz + ไฟล์ gunzip กลับเป็น html เดิม', async () => {
    const svc = new HtmlStorageService(makeConfig(dir));
    const key = await svc.putHtml(INPUT);
    expect(key).toBe('projects/1/crawls/2/abc.html.gz');
    const buf = await readFile(join(dir, key!));
    expect(gunzipSync(buf).toString('utf8')).toBe(INPUT.html);
  });

  it('เขียน disk ล้ม (baseDir เป็นไฟล์ไม่ใช่โฟลเดอร์) → คืน null (best-effort, ไม่ throw)', async () => {
    const filePath = join(dir, 'not-a-dir');
    await writeFile(filePath, 'x');
    const svc = new HtmlStorageService(makeConfig(filePath));
    await expect(svc.putHtml(INPUT)).resolves.toBeNull();
  });
});
