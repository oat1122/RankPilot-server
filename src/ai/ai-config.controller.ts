import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '../common/http';
import {
  AiModelsDto,
  SkillCreatedDto,
  ToggleSkillDto,
  UpdateSkillDto,
} from './dto/ai-config.dto';
import { AiConfigService } from './ai-config.service';

/**
 * /ai/* — AI config ที่ไม่ผูก project (Phase 5, เอกสาร 02 §3/§4): proxy รายการ model +
 * แก้/เปิดปิด skill รายตัว (skillId เป็น global identifier). ส่วนที่ผูก project (settings + list/
 * create skills) อยู่ใน AiController (/projects/:id/ai/*). controller บาง ๆ → ตอบผ่าน envelope กลาง.
 */
@ApiTags('ai-config')
@ApiBearerAuth()
@ApiStandardErrorResponses()
@Controller('ai')
export class AiConfigController {
  constructor(private readonly config: AiConfigService) {}

  @Get('models')
  @ApiEnvelopeResponse(AiModelsDto, {
    description:
      'รายการ model ของ OpenRouter (cache 1h) — FE filter supported_parameters ∋ structured_outputs เอง (เอกสาร 02 §3)',
  })
  models() {
    return this.config.models();
  }

  @Patch('skills/:skillId')
  @ApiEnvelopeResponse(SkillCreatedDto, {
    description: 'แก้ skill (body/appliesTo/priority/ชื่อ) — เอกสาร 02 §4',
  })
  updateSkill(
    @Param('skillId', ParseIntPipe) skillId: number,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.config.updateSkill(skillId, dto);
  }

  @Patch('skills/:skillId/toggle')
  @ApiEnvelopeResponse(SkillCreatedDto, {
    description: 'เปิด/ปิด skill (enabled) — เอกสาร 02 §4',
  })
  toggleSkill(
    @Param('skillId', ParseIntPipe) skillId: number,
    @Body() dto: ToggleSkillDto,
  ) {
    return this.config.toggleSkill(skillId, dto.enabled);
  }
}
