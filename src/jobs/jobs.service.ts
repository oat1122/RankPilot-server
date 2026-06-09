import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { projects } from '../db/schema';
import type { JobQueueName, JobView } from './dto/jobs.dto';
import type { ListJobsQueryDto } from './dto/jobs.dto';

/** throttle log queue 'error' — ioredis retry ถี่ตอน Redis ล่ม ไม่งั้น log ท่วม (เหมือน service อื่น). */
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;

/** เพดานต่อคิวต่อสถานะ — กัน Redis โหลด/ payload บวมตอนคิวยาว. */
const LIVE_LIMIT = 100; // active + waiting + delayed
const HISTORY_LIMIT = 30; // completed + failed (ประวัติล่าสุด)

/** field ที่อ่านจาก job.data (payload ต่างกันต่อคิว แต่ทุกตัวมี projectId ยกเว้น crawl-url เดี่ยว). */
type JobData = {
  projectId?: number;
  pageId?: number;
  crawlId?: number;
  mode?: string;
};

/** map queue+job.name → ประเภท+label ไทย (label คงที่ฝั่ง server เพื่อ i18n ง่าย). */
function classify(
  queue: JobQueueName,
  name: string,
): { type: JobView['type']; label: string } {
  switch (queue) {
    case 'crawl':
      return name === 'site-crawl'
        ? { type: 'site_crawl', label: 'Crawl เว็บ' }
        : { type: 'page_crawl', label: 'Crawl หน้า' };
    case 'ahrefs':
      return { type: 'enrich', label: 'ดึง Ahrefs' };
    case 'analysis':
      return { type: 'analysis', label: 'วิเคราะห์ SEO' };
    case 'ai':
      return { type: 'ai_audit', label: 'AI แนะนำ' };
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** ลำดับการแสดง: active(0) → queued(1) → ประวัติ(2). */
function stateRank(state: JobView['state']): number {
  if (state === 'active') return 0;
  if (state === 'queued') return 1;
  return 2;
}

/**
 * JobsService (api side, producer) — รวมสถานะงานทุกคิวของ user ปัจจุบัน โดยสแกน BullMQ สด
 * (api ≠ worker: แค่อ่านคิว ไม่ประมวลผล). scope ด้วยเจ้าของโปรเจค (projects.ownerId) เพื่อ multi-tenant.
 */
@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private lastQueueErrorLogAt = 0;
  private readonly queues: Record<JobQueueName, Queue>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue('crawl') crawl: Queue,
    @InjectQueue('ahrefs') ahrefs: Queue,
    @InjectQueue('analysis') analysis: Queue,
    @InjectQueue('ai') ai: Queue,
  ) {
    this.queues = { crawl, ahrefs, analysis, ai };
  }

  onModuleInit() {
    // ต้องมี listener 'error' ต่อคิว มิฉะนั้น Redis ล่ม → unhandled 'error' ล้มทั้ง process
    // (เหตุผลเดียวกับ CrawlService/AiService) + throttle กัน log ท่วมตอน retry ถี่.
    for (const [name, queue] of Object.entries(this.queues)) {
      queue.on('error', (err: Error) => {
        const now = Date.now();
        if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS)
          return;
        this.lastQueueErrorLogAt = now;
        const code = (err as { code?: string }).code;
        const detail = [err.name, code, err.message].filter(Boolean).join(' ');
        this.logger.warn(
          `jobs '${name}' queue error: ${detail || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
        );
      });
    }
  }

  /**
   * งานเบื้องหลังของ user (ทุกโปรเจคที่เป็นเจ้าของ) — active/queued + ประวัติล่าสุด.
   * filter.projectId/pageId = กรองเพิ่ม (dashboard/page-detail). ไม่มีโปรเจค → คืนว่าง.
   */
  async list(
    userId: number,
    filter: ListJobsQueryDto,
  ): Promise<{ items: JobView[] }> {
    const ownedIds = await this.ownedProjectIds(userId);
    if (ownedIds.size === 0) return { items: [] };

    const scanned = await Promise.all(
      (Object.keys(this.queues) as JobQueueName[]).map((name) =>
        this.scanQueue(name),
      ),
    );

    // scope: เก็บเฉพาะงานของโปรเจคที่ user เป็นเจ้าของ (crawl-url เดี่ยวไม่มี projectId → ตกขอบ)
    const seen = new Set<string>();
    const items: JobView[] = [];
    for (const view of scanned.flat()) {
      if (view.projectId == null || !ownedIds.has(view.projectId)) continue;
      if (filter.projectId != null && view.projectId !== filter.projectId)
        continue;
      if (filter.pageId != null && view.pageId !== filter.pageId) continue;
      // dedupe กัน job ที่ race ข้ามสถานะระหว่าง snapshot (เก็บตัวแรก = สถานะ live สุด เพราะ scan active ก่อน)
      const key = `${view.queue}:${view.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(view);
    }

    items.sort((a, b) => {
      const r = stateRank(a.state) - stateRank(b.state);
      if (r !== 0) return r;
      const at = a.finishedAt ?? a.startedAt ?? a.enqueuedAt ?? 0;
      const bt = b.finishedAt ?? b.startedAt ?? b.enqueuedAt ?? 0;
      return bt - at; // ใหม่ก่อน
    });

    return { items };
  }

  /** id โปรเจคที่ user เป็นเจ้าของ (scope multi-tenant แบบเดียวกับ ProjectAccessGuard). */
  private async ownedProjectIds(userId: number): Promise<Set<number>> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, userId));
    return new Set(rows.map((r) => r.id));
  }

  /** สแกน 1 คิว ทุกสถานะ (จำกัด top-N) → JobView[]. Redis ล่ม/คิวพัง → คืนว่าง (ไม่ล้มทั้ง endpoint). */
  private async scanQueue(name: JobQueueName): Promise<JobView[]> {
    const queue = this.queues[name];
    try {
      const [active, waiting, delayed, completed, failed] = await Promise.all([
        queue.getActive(0, LIVE_LIMIT),
        queue.getWaiting(0, LIVE_LIMIT),
        queue.getDelayed(0, LIVE_LIMIT),
        queue.getCompleted(0, HISTORY_LIMIT),
        queue.getFailed(0, HISTORY_LIMIT),
      ]);
      return [
        ...active.map((j) => this.toView(name, j, 'active')),
        ...waiting.map((j) => this.toView(name, j, 'queued')),
        ...delayed.map((j) => this.toView(name, j, 'queued')),
        ...completed.map((j) => this.toView(name, j, 'completed')),
        ...failed.map((j) => this.toView(name, j, 'failed')),
      ];
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`scan queue '${name}' failed: ${reason}`);
      return [];
    }
  }

  private toView(
    queue: JobQueueName,
    job: Job,
    state: JobView['state'],
  ): JobView {
    const data = (job.data ?? {}) as JobData;
    const { type, label } = classify(queue, job.name);
    return {
      id: String(job.id),
      queue,
      type,
      label,
      projectId: numOrNull(data.projectId),
      pageId: numOrNull(data.pageId),
      crawlId: numOrNull(data.crawlId),
      state,
      enqueuedAt: numOrNull(job.timestamp),
      startedAt: numOrNull(job.processedOn),
      finishedAt: numOrNull(job.finishedOn),
      failedReason: state === 'failed' ? (job.failedReason ?? null) : null,
    };
  }
}
