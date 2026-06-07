import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PsiService } from './psi.service';

/**
 * PsiModule — PageSpeed Insights client (CWV). HttpModule = ตัวยิง HTTP ไป PSI API v5.
 * CrawlerModule import ฝั่ง worker; ConfigService (@Global) ให้ env มาเอง.
 */
@Module({
  imports: [HttpModule],
  providers: [PsiService],
  exports: [PsiService],
})
export class PsiModule {}
