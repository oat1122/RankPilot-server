import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateCrawlDto } from './dto/create-crawl.dto';
import { CrawlService } from './crawl.service';

/**
 * /crawls — ตั้งงานให้ bot อ่านเว็บผ่าน URL.
 * controller เป็น adapter บาง ๆ: validate (Zod) → enqueue → ตอบ jobId (เอกสาร 00 §4).
 */
@ApiTags('crawl')
@ApiBearerAuth()
@Controller('crawls')
export class CrawlController {
  constructor(private readonly crawl: CrawlService) {}

  @Post()
  @ApiCreatedResponse({
    description:
      'URL ถูกตั้งคิวให้ worker crawl (api แค่ enqueue — เอกสาร 00 §4)',
  })
  create(@Body() dto: CreateCrawlDto) {
    return this.crawl.enqueue(dto);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'สถานะ job + ผล on-page เมื่อ state=completed',
  })
  status(@Param('id') id: string) {
    return this.crawl.status(id);
  }
}
