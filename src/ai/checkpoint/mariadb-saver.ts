import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
} from '@langchain/langgraph-checkpoint';
import type {
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../../db/db.module';
import { aiCheckpoints, aiCheckpointWrites } from '../../db/schema';

/**
 * MariaDbSaver — persistent LangGraph checkpointer บน MariaDB (Drizzle) แทน MemorySaver
 * (เอกสาร 02 Phase 4). จำเป็นต่อ HITL: graph interrupt ที่ awaitReview แล้ว resume "คนละ
 * process/หลัง restart" ได้ ∵ checkpoint อยู่ใน DB ไม่ใช่ memory ของ worker.
 *
 * semantics มิเรอร์ MemorySaver (node_modules/@langchain/langgraph-checkpoint/dist/memory.js):
 *   - serde เป็น default (JsonPlusSerializer) → dumpsTyped/loadsTyped ใช้ type 'json' เสมอ
 *   - checkpoint ล่าสุด = checkpoint_id (uuid6, time-ordered) มากสุด → ORDER BY ... DESC
 *   - writes key = (thread, ns, checkpoint_id, task_id, idx) โดย idx = WRITES_IDX_MAP[channel] ?? ลำดับ
 * blob เก็บเป็น longblob (Uint8Array↔Buffer). ไฟล์นี้ผูก langgraph (ESM) → ไม่มี spec import
 * (เหมือน graph.ts) — ตรวจ contract ผ่าน tsc (build), runtime verify ตอนรัน graph จริง.
 */
export class MariaDbSaver extends BaseCheckpointSaver {
  constructor(private readonly db: Db) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? '') as string;
    const wantId = config.configurable?.checkpoint_id as string | undefined;
    if (threadId === undefined) return undefined;

    const base = and(
      eq(aiCheckpoints.threadId, threadId),
      eq(aiCheckpoints.checkpointNs, checkpointNs),
    );
    const rows = wantId
      ? await this.db
          .select()
          .from(aiCheckpoints)
          .where(and(base, eq(aiCheckpoints.checkpointId, wantId)))
          .limit(1)
      : await this.db
          .select()
          .from(aiCheckpoints)
          .where(base)
          .orderBy(desc(aiCheckpoints.checkpointId))
          .limit(1);
    const row = rows[0];
    if (!row) return undefined;

    const pendingWrites = await this.loadWrites(
      threadId,
      checkpointNs,
      row.checkpointId,
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpointId,
        },
      },
      checkpoint: (await this.serde.loadsTyped(
        'json',
        row.checkpoint,
      )) as Checkpoint,
      metadata: (await this.serde.loadsTyped(
        'json',
        row.metadata,
      )) as CheckpointMetadata,
      pendingWrites,
    };
    if (row.parentCheckpointId)
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.parentCheckpointId,
        },
      };
    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = config.configurable?.checkpoint_ns as
      | string
      | undefined;
    const beforeId = options?.before?.configurable?.checkpoint_id as
      | string
      | undefined;

    const conds: SQL[] = [];
    if (threadId !== undefined)
      conds.push(eq(aiCheckpoints.threadId, threadId));
    if (checkpointNs !== undefined)
      conds.push(eq(aiCheckpoints.checkpointNs, checkpointNs));
    if (beforeId) conds.push(lt(aiCheckpoints.checkpointId, beforeId));

    const q = this.db
      .select()
      .from(aiCheckpoints)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(aiCheckpoints.checkpointId));
    const rows = options?.limit ? await q.limit(options.limit) : await q;

    for (const row of rows) {
      const pendingWrites = await this.loadWrites(
        row.threadId,
        row.checkpointNs,
        row.checkpointId,
      );
      const tuple: CheckpointTuple = {
        config: {
          configurable: {
            thread_id: row.threadId,
            checkpoint_ns: row.checkpointNs,
            checkpoint_id: row.checkpointId,
          },
        },
        checkpoint: (await this.serde.loadsTyped(
          'json',
          row.checkpoint,
        )) as Checkpoint,
        metadata: (await this.serde.loadsTyped(
          'json',
          row.metadata,
        )) as CheckpointMetadata,
        pendingWrites,
      };
      if (row.parentCheckpointId)
        tuple.parentConfig = {
          configurable: {
            thread_id: row.threadId,
            checkpoint_ns: row.checkpointNs,
            checkpoint_id: row.parentCheckpointId,
          },
        };
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? '') as string;
    if (threadId === undefined)
      throw new Error('MariaDbSaver.put: missing thread_id in configurable');
    const parentId =
      (config.configurable?.checkpoint_id as string | undefined) ?? null;

    const [[, cpBytes], [, metaBytes]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    const checkpointBuf = Buffer.from(cpBytes);
    const metadataBuf = Buffer.from(metaBytes);

    await this.db
      .insert(aiCheckpoints)
      .values({
        threadId,
        checkpointNs,
        checkpointId: checkpoint.id,
        parentCheckpointId: parentId,
        checkpoint: checkpointBuf,
        metadata: metadataBuf,
      })
      .onDuplicateKeyUpdate({
        set: {
          parentCheckpointId: parentId,
          checkpoint: checkpointBuf,
          metadata: metadataBuf,
        },
      });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? '') as string;
    const checkpointId = config.configurable?.checkpoint_id as
      | string
      | undefined;
    if (threadId === undefined || checkpointId === undefined)
      throw new Error(
        'MariaDbSaver.putWrites: missing thread_id/checkpoint_id in configurable',
      );

    const rows = await Promise.all(
      writes.map(async ([channel, value], i) => {
        const [, bytes] = await this.serde.dumpsTyped(value);
        return {
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          idx: WRITES_IDX_MAP[channel] ?? i,
          channel,
          blob: Buffer.from(bytes),
        };
      }),
    );
    if (!rows.length) return;

    // upsert: special writes (idx<0 จาก WRITES_IDX_MAP) เขียนทับได้ — ตรงกับ official DB saver
    await this.db
      .insert(aiCheckpointWrites)
      .values(rows)
      .onDuplicateKeyUpdate({
        set: { channel: sql`values(channel)`, blob: sql`values(blob)` },
      });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db
      .delete(aiCheckpoints)
      .where(eq(aiCheckpoints.threadId, threadId));
    await this.db
      .delete(aiCheckpointWrites)
      .where(eq(aiCheckpointWrites.threadId, threadId));
  }

  /** pending writes ของ checkpoint หนึ่ง → [taskId, channel, value] (deserialize). */
  private async loadWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<CheckpointTuple['pendingWrites']> {
    const writeRows = await this.db
      .select()
      .from(aiCheckpointWrites)
      .where(
        and(
          eq(aiCheckpointWrites.threadId, threadId),
          eq(aiCheckpointWrites.checkpointNs, checkpointNs),
          eq(aiCheckpointWrites.checkpointId, checkpointId),
        ),
      )
      .orderBy(asc(aiCheckpointWrites.idx));
    return Promise.all(
      writeRows.map(
        async (w) =>
          [
            w.taskId,
            w.channel,
            await this.serde.loadsTyped('json', w.blob),
          ] as [string, string, unknown],
      ),
    );
  }
}
