import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CrawlerService } from './crawler.service';

/**
 * โมดูล "bot" อ่านเว็บ — export CrawlerService ให้ worker (CrawlProcessor) ใช้.
 * HttpModule (@nestjs/axios) = ตัวยิง HTTP ออกไปอ่านหน้าเว็บ.
 */
@Module({
  imports: [HttpModule],
  providers: [CrawlerService],
  exports: [CrawlerService],
})
export class CrawlerModule {}
