import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../common/http';
import { Public } from '../auth/public.decorator';
import { HealthStatusDto } from './dto/health-status.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  // public: ไม่ต้อง Bearer — ใช้ probe/uptime ได้ (secure-by-default ที่เหลือบังคับ auth, เอกสาร 05 §4)
  @Public()
  // ตอบผ่าน envelope กลาง: { success:true, data:{status:'ok'}, meta } (เอกสาร 04 §6)
  @ApiEnvelopeResponse(HealthStatusDto, { description: 'Service is up' })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
