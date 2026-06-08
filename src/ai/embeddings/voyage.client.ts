import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';
import { AppException, ErrorCode } from '../../common/http';

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * VoyageClient (เอกสาร 02 Phase 6) — Voyage AI embeddings (voyage-3.5, 1024-dim) สำหรับ VECTOR
 * cannibalization. ยิงจาก worker (loadPageContext) ผ่าน EmbeddingService. key optional แบบเดียวกับ
 * OpenRouter/Ahrefs: ไม่มี key → isConfigured()=false → EmbeddingService ข้าม embedding (best-effort).
 * ไม่อ่าน process.env ตรง (เอกสาร 00 §1) — อ่าน VOYAGE_* ผ่าน ConfigService.
 */
@Injectable()
export class VoyageClient {
  private readonly logger = new Logger(VoyageClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** มี VOYAGE_API_KEY ไหม — EmbeddingService ใช้ gate (ไม่มี → ข้าม embedding, similarity=null). */
  isConfigured(): boolean {
    return !!this.config.get<string>('VOYAGE_API_KEY');
  }

  /**
   * embed หลายข้อความ → number[][] (เรียงตาม index). input_type 'document' = เก็บเข้า index,
   * 'query' = ใช้ค้นหา (voyage แนะนำให้ระบุเพื่อคุณภาพ). โยน EMBEDDING_NOT_CONFIGURED ถ้าไม่มี key.
   */
  async embed(
    texts: string[],
    inputType: 'document' | 'query' = 'document',
  ): Promise<number[][]> {
    const apiKey = this.config.get<string>('VOYAGE_API_KEY');
    if (!apiKey)
      throw new AppException(
        ErrorCode.EMBEDDING_NOT_CONFIGURED,
        'VOYAGE_API_KEY ไม่ได้ตั้งค่า — ตั้งใน server/.env ก่อนใช้ embeddings (เอกสาร 02 Phase 6)',
      );
    if (!texts.length) return [];

    const baseUrl = this.config.get<string>('VOYAGE_BASE_URL')!;
    const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`;
    const res: AxiosResponse<VoyageEmbeddingResponse> = await firstValueFrom(
      this.http.post<VoyageEmbeddingResponse>(
        url,
        {
          input: texts,
          model: this.config.get<string>('VOYAGE_MODEL'),
          input_type: inputType,
          output_dimension: this.config.get<number>('VOYAGE_DIM'),
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.config.get<number>('VOYAGE_TIMEOUT_MS'),
          validateStatus: () => true,
        },
      ),
    );
    if (res.status < 200 || res.status >= 300)
      throw new Error(`Voyage API error (HTTP ${res.status})`);

    return [...res.data.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
