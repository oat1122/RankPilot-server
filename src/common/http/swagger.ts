import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorResponseDto, ApiSuccessBaseDto } from './api-response.schema';

interface EnvelopeOptions {
  status?: number;
  description?: string;
}

/**
 * Document success envelope ที่ `data` เป็น model ที่กำหนด — ประกอบ allOf:
 * [ base { success, meta }, { data: $ref(model) } ] เพื่อให้ OpenAPI/TS client (เอกสาร 04 §6)
 * เห็นรูป { success, data: <Model>, meta } จริง แทน object เปล่า. แทน @ApiOkResponse เดิม.
 */
export function ApiEnvelopeResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: EnvelopeOptions = {},
) {
  return applyDecorators(
    ApiExtraModels(ApiSuccessBaseDto, model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiSuccessBaseDto) },
          {
            required: ['data'],
            properties: { data: { $ref: getSchemaPath(model) } },
          },
        ],
      },
    }),
  );
}

/**
 * Document error envelope มาตรฐานที่ทุก endpoint อาจคืน (เอกสาร 04 §6).
 * วางครั้งเดียวที่ระดับ controller — FE รู้ล่วงหน้าว่า error.code ชุดไหนจะเจอ.
 */
export function ApiStandardErrorResponses() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: 'Validation failed / bad request',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: 401,
      description: 'Unauthorized',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: 404,
      description: 'Not found',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: 500,
      description: 'Internal error',
      type: ApiErrorResponseDto,
    }),
  );
}
