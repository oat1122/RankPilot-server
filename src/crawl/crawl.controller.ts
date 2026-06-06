import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateCrawlDto } from './dto/create-crawl.dto';
import { CrawlEnqueuedDto, CrawlStatusDto } from './dto/crawl-response.dto';
import { CrawlService } from './crawl.service';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';

/**
 * /crawls — ตั้งงานให้ bot อ่านเว็บผ่าน URL.
 * controller เป็น adapter บาง ๆ: validate (Zod) → enqueue → ตอบ jobId (เอกสาร 00 §4).
 * response/error ผ่าน envelope กลาง (interceptor + filter) — ดู common/http (เอกสาร 04 §6).
 */
@ApiTags('crawl')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('crawls')
export class CrawlController {
  constructor(private readonly crawl: CrawlService) {}

  @Post()
  @ApiEnvelopeResponse(CrawlEnqueuedDto, {
    status: 201,
    description:
      'URL ถูกตั้งคิวให้ worker crawl (api แค่ enqueue — เอกสาร 00 §4)',
  })
  create(@Body() dto: CreateCrawlDto) {
    return this.crawl.enqueue(dto);
  }

  @Get(':id')
  @ApiEnvelopeResponse(CrawlStatusDto, {
    description: 'สถานะ job + ผล on-page เมื่อ state=completed',
  })
  status(@Param('id') id: string) {
    return this.crawl.status(id);
  }
}
