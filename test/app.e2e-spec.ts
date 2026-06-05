import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
// REDIS_URL ถูกตั้งใน test/setup-e2e.ts (setupFiles) ก่อน AppModule โหลด

// mock queue 'crawl' → ไม่สร้าง connection จริง ⇒ e2e ไม่ผูกกับ Redis (เอกสาร 00 §4)
const queueMock = {
  on: () => undefined,
  add: () => undefined,
  getJob: () => undefined,
};

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('crawl'))
      .useValue(queueMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
