import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

/** ค่า default ของ HTML_STORAGE_DIR — ตรงกับ env.ts (fallback ตอน config ไม่ถูก validate เช่น unit test). */
const DEFAULT_DIR = 'storage/html';

/** throttle log error — กัน log ท่วมถ้า disk เต็ม/เขียนไม่ได้ถี่ ๆ (เหมือน pattern ของ crawl.service / r2 เดิม). */
const ERROR_LOG_THROTTLE_MS = 10_000;

export interface PutHtmlInput {
  projectId: number;
  crawlId: number;
  urlHash: string; // sha1(normalizeUrl) — ตรงกับ pages.url_hash
  html: string | null;
}

/**
 * HtmlStorageService — เก็บ raw HTML snapshot เป็นไฟล์ `.html.gz` บน local disk (เอกสาร 05 §0/§4).
 * เลือก disk แทน object store (R2/S3): ไม่มีค่า egress, ไม่ต้องพึ่ง external service/creds, gzip ลด ~85%.
 * best-effort: html ว่าง / เขียน disk ล้ม → คืน null ไม่ throw (storage ล่มต้องไม่ทำให้ persist crawl ล้ม —
 * เทียบ refund best-effort ของ ahrefs.client). คืน object key (relative) → เก็บใน page_snapshots.html_storage_key.
 * key = `projects/<projectId>/crawls/<crawlId>/<urlHash>.html.gz` (อ่านกลับ = join(HTML_STORAGE_DIR, key)).
 */
@Injectable()
export class HtmlStorageService {
  private readonly logger = new Logger(HtmlStorageService.name);
  private lastErrorLogAt = 0;
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir = config.get<string>('HTML_STORAGE_DIR') ?? DEFAULT_DIR;
  }

  async putHtml(input: PutHtmlInput): Promise<string | null> {
    if (!input.html) return null;
    const key = `projects/${input.projectId}/crawls/${input.crawlId}/${input.urlHash}.html.gz`;
    const path = join(this.baseDir, key);
    try {
      const gz = await gzipAsync(input.html);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, gz);
      return key;
    } catch (err) {
      this.warnThrottled(err);
      return null;
    }
  }

  private warnThrottled(err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < ERROR_LOG_THROTTLE_MS) return;
    this.lastErrorLogAt = now;
    const reason =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    this.logger.warn(
      `HTML snapshot เขียน disk ล้ม (best-effort, ข้าม): ${reason}`,
    );
  }
}
