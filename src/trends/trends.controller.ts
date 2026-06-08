import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { ProjectAccessGuard } from '../projects/project-access.guard';
import { TrendsQueryDto } from './dto/trends-query.dto';
import { CrawlActivityDto, ScoreTrendDto } from './dto/trends-response.dto';
import { TrendsService } from './trends.service';

/**
 * /projects/:projectId/trends — time-series ให้ FE plot (line/area + date-range + before/after,
 * เอกสาร 06 P3). อ่านจากข้อมูลที่มีจริงตอนนี้: crawls + seo_scores (ranking/backlink history รอ
 * Ahrefs live). read-only + ProjectAccessGuard (multi-tenant). ไม่มีข้อมูล = points:[] (ไม่ error).
 */
@ApiTags('trends')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/trends')
export class TrendsController {
  constructor(private readonly trends: TrendsService) {}

  @Get('scores')
  @ApiEnvelopeResponse(ScoreTrendDto, {
    description:
      'avg health/keyword score ต่อ crawl ตามเวลา (before/after = จุดแรก vs สุดท้าย)',
  })
  scores(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: TrendsQueryDto,
  ) {
    return this.trends.scoreTrend(projectId, query);
  }

  @Get('crawls')
  @ApiEnvelopeResponse(CrawlActivityDto, {
    description: 'จำนวน crawl + pages ที่ crawl ต่อวัน',
  })
  crawls(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: TrendsQueryDto,
  ) {
    return this.trends.crawlActivity(projectId, query);
  }
}
