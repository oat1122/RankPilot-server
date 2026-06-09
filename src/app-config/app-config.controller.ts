import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../common/http';
import { Public } from '../auth/public.decorator';
import { AppConfigDto } from './dto/app-config.dto';

/**
 * GET /config — public config ที่ FE ใช้ build UI (เพดาน site crawl ฯลฯ). แยกจาก
 * src/config/ (env loader) ตรงที่นี่คือ HTTP endpoint เปิดเผย "เฉพาะ" ค่าที่ FE ต้องใช้
 * (ไม่ใช่ทั้ง env). @Public เพราะ FE โหลดได้ตั้งแต่ก่อน sign-in (เหมือน /health) + ค่าไม่ลับ.
 * อ่านค่าผ่าน ConfigService ตาม convention (ห้าม process.env ตรง ๆ).
 */
@ApiTags('config')
@Controller('config')
export class AppConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Public()
  // ตอบผ่าน envelope กลาง: { success:true, data:{ crawlSiteMaxPages }, meta } (เอกสาร 04 §6)
  @ApiEnvelopeResponse(AppConfigDto, {
    description: 'public config ที่ FE ใช้ (เพดาน site crawl ฯลฯ)',
  })
  appConfig(): { crawlSiteMaxPages: number } {
    return {
      crawlSiteMaxPages:
        this.config.get<number>('CRAWLER_SITE_MAX_PAGES') ?? 200,
    };
  }
}
