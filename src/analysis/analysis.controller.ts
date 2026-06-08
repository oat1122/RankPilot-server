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
import {
  CreateAnalysisDto,
  ListFindingsQueryDto,
  ListScoresQueryDto,
} from './dto/create-analysis.dto';
import {
  AnalysisEnqueuedDto,
  AnalysisFindingsDto,
  AnalysisScoresDto,
  AnalysisStatusDto,
} from './dto/analysis-response.dto';
import { AnalysisService } from './analysis.service';

/**
 * /projects/:projectId/analysis — stage [3] (เอกสาร 04 §7).
 * controller เป็น adapter บาง ๆ: validate (Zod) → enqueue/อ่าน → ตอบผ่าน envelope กลาง.
 * route literal (findings/scores/jobs) แยกชัดจาก param เพื่อกัน path ชนกัน.
 */
@ApiTags('analysis')
@ApiBearerAuth()
@ApiStandardErrorResponses()
// multi-tenant: เฉพาะเจ้าของ projectId เข้าถึงได้ (เอกสาร 05 §4) — guard มาจาก ProjectsModule (@Global)
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post()
  @ApiEnvelopeResponse(AnalysisEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิวให้ worker วิเคราะห์ crawl (api แค่ enqueue — เอกสาร 00 §4). ไม่ระบุ crawlId = crawl ล่าสุด',
  })
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateAnalysisDto,
  ) {
    return this.analysis.enqueue(projectId, dto);
  }

  @Get('findings')
  @ApiEnvelopeResponse(AnalysisFindingsDto, {
    description:
      'รายการ audit_findings เรียงตาม impactScore (สูง→ต่ำ) — Action Dashboard (เอกสาร 04 §7)',
  })
  findings(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListFindingsQueryDto,
  ) {
    return this.analysis.findings(projectId, query);
  }

  @Get('scores')
  @ApiEnvelopeResponse(AnalysisScoresDto, {
    description: 'seo_scores ต่อหน้า ของ crawl ที่เลือก/ล่าสุด',
  })
  scores(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListScoresQueryDto,
  ) {
    return this.analysis.scores(projectId, query);
  }

  @Get('jobs/:jobId')
  @ApiEnvelopeResponse(AnalysisStatusDto, {
    description: 'สถานะ job + สรุปผลวิเคราะห์เมื่อ state=completed',
  })
  status(@Param('jobId') jobId: string) {
    return this.analysis.status(jobId);
  }
}
