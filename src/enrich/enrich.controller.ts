import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { ProjectAccessGuard } from '../projects/project-access.guard';
import {
  CreateEnrichDto,
  EnrichKeywordsDto,
  TopPagesDto,
  CompetitorsDto,
  SerpOverviewDto,
  KeywordIdeasDto,
  BacklinksDto,
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
// multi-tenant: เฉพาะเจ้าของ projectId เข้าถึงได้ (เอกสาร 05 §4) — guard มาจาก ProjectsModule (@Global)
@UseGuards(ProjectAccessGuard)
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

  @Post('competitors')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว organic-competitors — คู่แข่ง organic ของ domain (เอกสาร 03a §4.3)',
  })
  competitors(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CompetitorsDto,
  ) {
    return this.enrich.enqueueCompetitors(projectId, dto);
  }

  @Post('serp')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว serp-overview ของ 1 keyword (แพง — เฉพาะ keyword สำคัญ, เอกสาร 03a §5)',
  })
  serp(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: SerpOverviewDto,
  ) {
    return this.enrich.enqueueSerp(projectId, dto);
  }

  @Post('keyword-ideas')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว matching/related-terms — keyword ideas/query fan-out (เอกสาร 03a §5)',
  })
  keywordIdeas(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: KeywordIdeasDto,
  ) {
    return this.enrich.enqueueIdeas(projectId, dto);
  }

  @Post('backlinks')
  @ApiEnvelopeResponse(EnrichEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว site-explorer metrics/DR/backlinks ระดับ domain (เอกสาร 03a §6)',
  })
  backlinks(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: BacklinksDto,
  ) {
    return this.enrich.enqueueBacklinks(projectId, dto);
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
