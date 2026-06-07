import { Module } from '@nestjs/common';
import { HtmlStorageService } from './html-storage.service';

/**
 * StorageModule — provide HtmlStorageService (เก็บ raw HTML snapshot เป็น .html.gz บน disk).
 * โมดูลธรรมดา (ไม่ @Global) — CrawlerModule import ตรง ๆ ฝั่ง worker ที่ใช้จริง (api ไม่ persist).
 * อ่าน HTML_STORAGE_DIR ผ่าน ConfigService (ConfigModule เป็น global) — ไม่ต้อง import เพิ่ม.
 */
@Module({
  providers: [HtmlStorageService],
  exports: [HtmlStorageService],
})
export class StorageModule {}
