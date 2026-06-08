import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import {
  CreateAiAuditDto,
  ListRecommendationsQueryDto,
} from './dto/create-ai-audit.dto';
import {
  AiEnqueuedDto,
  AiRecommendationsDto,
  AiStatusDto,
} from './dto/ai-response.dto';
import { AiService } from './ai.service';

/**
 * /projects/:projectId/ai — stage [4] AI Advisor (เอกสาร 02).
 * controller บาง ๆ: validate (Zod) → enqueue/อ่าน → ตอบผ่าน envelope กลาง.
 * route literal (jobs/recommendations) แยกชัดจาก param เพื่อกัน path ชนกัน.
 */
@ApiTags('ai')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('projects/:projectId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

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

  @Get('jobs/:jobId')
  @ApiEnvelopeResponse(AiStatusDto, {
    description: 'สถานะ job + สรุปผล audit เมื่อ state=completed',
  })
  status(@Param('jobId') jobId: string) {
    return this.ai.status(jobId);
  }
}
