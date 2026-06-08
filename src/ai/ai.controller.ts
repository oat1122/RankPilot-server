import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import { ProjectAccessGuard } from '../projects/project-access.guard';
import {
  CreateAiAuditDto,
  ListRecommendationsQueryDto,
  ListRunsQueryDto,
  ReviewRunDto,
} from './dto/create-ai-audit.dto';
import {
  AiEnqueuedDto,
  AiRecommendationsDto,
  AiReviewQueuedDto,
  AiRunsDto,
  AiStatusDto,
} from './dto/ai-response.dto';
import {
  AiSettingsViewDto,
  CreateSkillDto,
  PutAiSettingsDto,
  SkillCreatedDto,
  SkillsListDto,
} from './dto/ai-config.dto';
import { AiService } from './ai.service';
import { AiConfigService } from './ai-config.service';

/**
 * /projects/:projectId/ai — stage [4] AI Advisor (เอกสาร 02).
 * controller บาง ๆ: validate (Zod) → enqueue/อ่าน → ตอบผ่าน envelope กลาง.
 * route literal (jobs/recommendations) แยกชัดจาก param เพื่อกัน path ชนกัน.
 */
@ApiTags('ai')
@ApiBearerAuth()
@ApiStandardErrorResponses()
// multi-tenant: เฉพาะเจ้าของ projectId เข้าถึงได้ (เอกสาร 05 §4) — guard มาจาก ProjectsModule (@Global)
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly config: AiConfigService,
  ) {}

  @Post('audit')
  @ApiEnvelopeResponse(AiEnqueuedDto, {
    status: 201,
    description:
      'ตั้งคิวให้ worker รัน page_audit (api แค่ enqueue — เอกสาร 00 §4). ไม่ระบุ crawlId = crawl ล่าสุด; ไม่ระบุ pageId = ทุกเพจ',
  })
  audit(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateAiAuditDto,
  ) {
    return this.ai.enqueue(projectId, dto);
  }

  @Get('recommendations')
  @ApiEnvelopeResponse(AiRecommendationsDto, {
    description:
      'ai_recommendations (diagnosis/title_draft/meta_draft/priority) — Dashboard (เอกสาร 02)',
  })
  recommendations(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListRecommendationsQueryDto,
  ) {
    return this.ai.recommendations(projectId, query);
  }

  @Get('runs')
  @ApiEnvelopeResponse(AiRunsDto, {
    description:
      'ai_runs ของ project (กรอง ?status=awaiting_review) + proposal ที่รอรีวิว — Dashboard HITL (เอกสาร 02 Phase 4)',
  })
  runs(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ListRunsQueryDto,
  ) {
    return this.ai.listRuns(projectId, query);
  }

  @Post('runs/:runId/review')
  @ApiEnvelopeResponse(AiReviewQueuedDto, {
    status: 201,
    description:
      'อนุมัติ/ปฏิเสธ draft → enqueue resume graph (HITL — เอกสาร 02 Phase 4). run ต้องอยู่ awaiting_review',
  })
  review(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: ReviewRunDto,
  ) {
    return this.ai.review(projectId, runId, dto);
  }

  @Get('jobs/:jobId')
  @ApiEnvelopeResponse(AiStatusDto, {
    description: 'สถานะ job + สรุปผล audit เมื่อ state=completed',
  })
  status(@Param('jobId') jobId: string) {
    return this.ai.status(jobId);
  }

  // ---------- config: model selection ต่อโปรเจค (Phase 5, เอกสาร 02 §3) ----------

  @Get('settings')
  @ApiEnvelopeResponse(AiSettingsViewDto, {
    description:
      'ai_settings ของ project (null = default) + map role→modelId ที่ใช้จริง',
  })
  settings(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.config.getSettings(projectId);
  }

  @Put('settings')
  @ApiEnvelopeResponse(AiSettingsViewDto, {
    description:
      'ตั้ง model ต่อ role ของ project (validate ด้วย AiSettingsSchema) แล้ว upsert',
  })
  putSettings(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: PutAiSettingsDto,
  ) {
    return this.config.putSettings(projectId, dto);
  }

  // ---------- config: skills (Phase 5, เอกสาร 02 §4) ----------

  @Get('skills')
  @ApiEnvelopeResponse(SkillsListDto, {
    description:
      'skill ที่ project เห็น (global + ของ project) พร้อมสถานะ enabled',
  })
  listSkills(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.config.listSkills(projectId);
  }

  @Post('skills')
  @ApiEnvelopeResponse(SkillCreatedDto, {
    status: 201,
    description: 'สร้าง skill (markdown body + appliesTo) ของ project',
  })
  createSkill(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateSkillDto,
  ) {
    return this.config.createSkill(projectId, dto);
  }
}
