import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import {
  CreateEnrichDto,
  EnrichKeywordsDto,
  TopPagesDto,
} from './dto/create-enrich.dto';
import {
  AhrefsBudgetDto,
  EnrichEnqueuedDto,
  EnrichStatusDto,
} from './dto/enrich-response.dto';
import { EnrichService } from './enrich.service';

/**
 * /projects/:projectId/ahrefs — ตั้งงาน enrich domain ผ่าน Ahrefs + ดูงบ units.
 * controller เป็น adapter บาง ๆ: validate (Zod) → enqueue → ตอบ jobId (เอกสาร 00 §4).
 * งบเป็น per-project ∴ endpoint อยู่ใต้ projectId. response/error ผ่าน envelope กลาง.
 */
@ApiTags('ahrefs')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('projects/:projectId/ahrefs')
export class EnrichController {
  constructor(private readonly enrich: EnrichService) {}

  @Post('enrich')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิวให้ worker ดึง organic-keywords ของ domain (api แค่ enqueue — เอกสาร 00 §4)',
  })
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateEnrichDto,
  ) {
    return this.enrich.enqueue(projectId, dto);
  }

  @Post('keywords')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว keywords-explorer/overview — batch enrich keyword ที่ยังไม่ติด (เอกสาร 03a §4.1)',
  })
  enrichKeywords(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: EnrichKeywordsDto,
  ) {
    return this.enrich.enqueueKeywords(projectId, dto);
  }

  @Post('top-pages')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว site-explorer/top-pages — คัด top 20% by traffic ก่อน enrich (เอกสาร 03a §4.2)',
  })
  topPages(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: TopPagesDto,
  ) {
    return this.enrich.enqueueTopPages(projectId, dto);
  }

  @Get('enrich/:jobId')
  @ApiEnvelopeResponse(EnrichStatusDto, {
    description: 'สถานะ job + สรุปผล enrichment เมื่อ state=completed',
  })
  status(@Param('jobId') jobId: string) {
    return this.enrich.status(jobId);
  }

  @Get('budget')
  @ApiEnvelopeResponse(AhrefsBudgetDto, {
    description: 'งบ units ที่ใช้ไป/เพดาน ของเดือนปัจจุบัน',
  })
  budget(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.enrich.budgetStatus(projectId);
  }
}
