import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { pinoHttp } from 'pino-http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // request logging (Pino) — เอกสาร 00 §1
  app.use(pinoHttp());

  // CORS — FE↔API ข้ามโดเมนด้วย Bearer (ไม่ใช้ cookie) เอกสาร 05 §3
  app.enableCors({
    origin: [config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000'],
    credentials: false,
  });

  // Swagger — ใช้ generate TS client ให้ web ภายหลัง (เอกสาร 00/04 §6)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('RankPilot API')
    .setDescription('RankPilot REST API')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document));

  const port = Number(config.get('PORT')) || 3001;
  await app.listen(port);
}

void bootstrap();
