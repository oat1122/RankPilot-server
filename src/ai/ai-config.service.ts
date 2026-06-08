import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';
import { AppException, ErrorCode } from '../common/http';
import { AiConfigRepo } from './ai-config.repo';
import type { CreateSkillInput, UpdateSkillInput } from './ai-config.repo';
import type { AiSettings } from './llm/settings';

/** cache รายการ model ของ OpenRouter (เอกสาร 02 §3 — 1 ชั่วโมง). */
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;

interface OpenRouterModelsResponse {
  data?: unknown[];
}

/**
 * AiConfigService (Phase 5, fฝั่ง api) — endpoints config ของ AI Advisor (เอกสาร 02 §3/§4):
 * proxy รายการ model ของ OpenRouter (cache 1h) + CRUD ai_settings/ai_skills ผ่าน AiConfigRepo.
 * ไม่รัน graph (อ่าน/เขียน config เท่านั้น) → อยู่ฝั่ง api ได้ (ไม่ผิดกฎ api ≠ worker).
 */
@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);
  private modelsCache: { data: unknown[]; at: number } | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly repo: AiConfigRepo,
  ) {}

  /* ---------- models proxy ---------- */

  /** รายการ model จาก OpenRouter (cache 1h). FE filter supported_parameters ∋ structured_outputs เอง. */
  async models(): Promise<{ data: unknown[]; cachedAt: string }> {
    const now = Date.now();
    if (this.modelsCache && now - this.modelsCache.at < MODELS_CACHE_TTL_MS)
      return this.cachedView();

    const baseUrl = this.config.get<string>('OPENROUTER_BASE_URL')!;
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;

    let res: AxiosResponse<OpenRouterModelsResponse>;
    try {
      res = await firstValueFrom(
        this.http.get<OpenRouterModelsResponse>(url, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          timeout: this.config.get<number>('OPENROUTER_TIMEOUT_MS') ?? 60000,
          validateStatus: () => true,
        }),
      );
    } catch (err) {
      // network ล้ม → ถ้ามี cache เก่าคืน stale (ดีกว่าพัง), ไม่งั้น 503
      if (this.modelsCache) return this.cachedView();
      const reason = err instanceof Error ? err.message : String(err);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `ดึงรายการ model จาก OpenRouter ไม่สำเร็จ: ${reason}`,
      );
    }
    if (res.status < 200 || res.status >= 300) {
      if (this.modelsCache) return this.cachedView();
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `OpenRouter /models error (HTTP ${res.status})`,
      );
    }
    const data = Array.isArray(res.data?.data) ? res.data.data : [];
    this.modelsCache = { data, at: now };
    return this.cachedView();
  }

  private cachedView(): { data: unknown[]; cachedAt: string } {
    const c = this.modelsCache!;
    return { data: c.data, cachedAt: new Date(c.at).toISOString() };
  }

  /* ---------- settings ---------- */

  /** settings ที่เก็บ (null = default) + map role→modelId ที่ใช้จริง (merge DEFAULTS). */
  async getSettings(projectId: number) {
    const [settings, modelMap] = await Promise.all([
      this.repo.getSettings(projectId),
      this.repo.resolveModelMap(projectId),
    ]);
    return { settings, modelMap };
  }

  async putSettings(projectId: number, dto: AiSettings) {
    await this.repo.upsertSettings(projectId, dto);
    return this.getSettings(projectId);
  }

  /* ---------- skills ---------- */

  async listSkills(projectId: number) {
    return { items: await this.repo.listSkills(projectId) };
  }

  async createSkill(projectId: number, dto: CreateSkillInput) {
    return { id: await this.repo.createSkill(projectId, dto) };
  }

  /** patch skill — throw AI_SKILL_NOT_FOUND ถ้าไม่มี (จาก repo). */
  async updateSkill(skillId: number, dto: UpdateSkillInput) {
    await this.repo.updateSkill(skillId, dto);
    return { id: skillId };
  }

  async toggleSkill(skillId: number, enabled: boolean) {
    await this.repo.toggleSkill(skillId, enabled);
    return { id: skillId };
  }
}
