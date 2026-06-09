import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CrawlerService } from './crawler.service';
import { CrawlerRepo } from './crawler.repo';
import { SitemapService } from './sitemap.service';
import { StorageModule } from '../storage/storage.module';
import { PsiModule } from '../psi/psi.module';

/**
 * โมดูล "bot" อ่านเว็บ — export CrawlerService (อ่าน HTML) + CrawlerRepo (persist ผลลง DB)
 * ให้ worker (CrawlProcessor) ใช้. HttpModule (@nestjs/axios) = ตัวยิง HTTP ออกไปอ่านหน้าเว็บ.
 * StorageModule = เก็บ raw HTML snapshot (gzip ลง disk); PsiModule = ดึง CWV (เอกสาร 01 page_snapshots / 05 §0).
 */
@Module({
  imports: [HttpModule, StorageModule, PsiModule],
  providers: [CrawlerService, CrawlerRepo, SitemapService],
  // re-export StorageModule/PsiModule → CrawlProcessor (ใน WorkerModule) inject HtmlStorageService/
  // PsiService ได้ผ่านการ import CrawlerModule โมดูลเดียว.
  exports: [
    CrawlerService,
    CrawlerRepo,
    SitemapService,
    StorageModule,
    PsiModule,
  ],
})
export class CrawlerModule {}
