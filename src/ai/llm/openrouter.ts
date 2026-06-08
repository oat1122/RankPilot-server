import { ChatOpenAI } from '@langchain/openai';
import { AppException, ErrorCode } from '../../common/http';

/**
 * OpenRouter LLM plumbing (เอกสาร 02 §2) — provider เดียวแบบ OpenAI-compatible.
 * ใช้ ChatOpenAI ของ @langchain/openai แล้ว override baseURL ชี้ OpenRouter (ไม่ใช้
 * @langchain/anthropic — อยากได้ Claude ก็เลือก model id 'anthropic/*' ผ่าน OpenRouter).
 *
 * ไม่อ่าน process.env ตรง (เอกสาร 00 §1): caller (AiRunner) อ่าน OPENROUTER_* ผ่าน
 * ConfigService แล้วส่ง conn เข้ามา → ทดสอบ/มॉคได้ และไม่ผูก global state.
 */

/** config ต่อ model (role → cfg ใน resolve.ts). */
export interface ModelCfg {
  modelId: string; // openrouter id เช่น 'anthropic/claude-sonnet-4.6'
  temperature?: number;
  maxTokens?: number;
}

/** connection-level config (มาจาก env, ส่งโดย AiRunner). */
export interface OpenRouterConn {
  apiKey?: string;
  baseURL: string;
  siteUrl: string;
  appTitle: string;
  timeoutMs?: number;
}

/**
 * สร้าง ChatOpenAI ที่ชี้ไป OpenRouter (drop-in ของ OpenAI SDK).
 * - attribution headers (HTTP-Referer / X-Title) → โผล่ใน OpenRouter rankings (เอกสาร 02 §2).
 * - modelKwargs.provider.require_parameters=true → route เฉพาะ provider ที่รองรับ
 *   structured output จริง (คู่กับ withStructuredOutput json_schema, กัน model ที่คืน free text).
 * โยน AI_NOT_CONFIGURED ถ้าไม่มี apiKey (setup phase key เป็น optional — เอกสาร 02 §9).
 */
export function mkModel(cfg: ModelCfg, conn: OpenRouterConn): ChatOpenAI {
  if (!conn.apiKey)
    throw new AppException(
      ErrorCode.AI_NOT_CONFIGURED,
      'OPENROUTER_API_KEY ไม่ได้ตั้งค่า — ตั้งใน server/.env ก่อนรัน AI Advisor (เอกสาร 02 §9)',
    );
  return new ChatOpenAI({
    model: cfg.modelId,
    temperature: cfg.temperature ?? 0.2,
    maxTokens: cfg.maxTokens ?? 2048,
    apiKey: conn.apiKey,
    timeout: conn.timeoutMs,
    configuration: {
      baseURL: conn.baseURL,
      defaultHeaders: {
        'HTTP-Referer': conn.siteUrl,
        'X-Title': conn.appTitle,
      },
    },
    // route เฉพาะ provider ที่รองรับ structured output ของ model นั้น (เอกสาร 02 §2)
    modelKwargs: { provider: { require_parameters: true } },
  });
}
