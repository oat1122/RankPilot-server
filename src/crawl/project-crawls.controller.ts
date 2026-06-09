import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { ProjectAccessGuard } from '../projects/project-access.guard';
import { ListCrawlsQueryDto } from './dto/list-crawls.dto';
import { CrawlListDto } from './dto/crawl-list.dto';
import { CreateSiteCrawlDto } from './dto/create-site-crawl.dto';
import { CrawlEnqueuedDto } from './dto/crawl-response.dto';
import { CrawlsReadRepo } from './crawls-read.repo';
import { CrawlService } from './crawl.service';

/**
 * /projects/:projectId/crawls — list ประวัติ crawl ของ project (เอกสาร 01 §2). read-only:
 * write (createCrawl/persistPage) ทำที่ worker. ProjectAccessGuard เช็คเจ้าของ (multi-tenant,
 * เอกสาร 05 §4). ไม่ชนกับ GET /crawls/:id (job status by BullMQ jobId) เพราะ nested ใต้ projects/.
 */
@ApiTags('crawl')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/crawls')
export class ProjectCrawlsController {
  constructor(
    private readonly repo: CrawlsReadRepo,
    private readonly crawl: CrawlService,
  ) {}

  @Get()
  @ApiEnvelopeResponse(CrawlListDto, {
    description:
      'ประวัติ crawl ของ project เรียงล่าสุดก่อน + total (KPI จำนวน Crawl)',
  })
  list(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListCrawlsQueryDto,
  ) {
    return this.repo.listByProject(projectId, {
      limit: query.limit,
      offset: query.offset,
      status: query.status,
    });
  }

  @Post()
  @ApiEnvelopeResponse(CrawlEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิว site crawl ทั้งเว็บ (sitemap + เดิน internal link, เพดาน maxPages) — api แค่ enqueue',
  })
  crawlSite(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateSiteCrawlDto,
  ) {
    return this.crawl.enqueueSite(projectId, dto.maxPages);
  }
}
