import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CrawlerService } from './crawler.service';
import { CrawlerRepo } from './crawler.repo';

/**
 * โมดูล "bot" อ่านเว็บ — export CrawlerService (อ่าน HTML) + CrawlerRepo (persist ผลลง DB)
 * ให้ worker (CrawlProcessor) ใช้. HttpModule (@nestjs/axios) = ตัวยิง HTTP ออกไปอ่านหน้าเว็บ.
 */
@Module({
  imports: [HttpModule],
  providers: [CrawlerService, CrawlerRepo],
  exports: [CrawlerService, CrawlerRepo],
})
export class CrawlerModule {}
