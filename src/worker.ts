import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';

/**
 * Entrypoint ของ worker process — `node dist/worker` (เอกสาร 05 §2).
 * ใช้ application context (ไม่มี HTTP server) ∵ worker แค่กิน BullMQ jobs.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('Worker').log(
    'RankPilot worker started — consuming BullMQ "crawl" (เอกสาร 00 §4)',
  );
}

void bootstrap();
