import './load-env';
import compression from 'compression';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';

function isAllowedCorsOrigin(origin: string): boolean {
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  const extras =
    process.env.CORS_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ??
    [];
  if (extras.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname;
    // Painel / portal em produção (HTTPS no mesmo domínio registado)
    if (u.protocol === 'https:' && /\.oxfieldservices\.org$/i.test(h)) {
      return true;
    }
    if (
      h.endsWith('.ngrok-free.app') ||
      h.endsWith('.ngrok-free.dev') ||
      h.endsWith('.ngrok.io') ||
      h.endsWith('.ngrok.app')
    ) {
      return u.protocol === 'https:';
    }
    // Painel no Render (ou outro host em https://*.onrender.com)
    if (h.endsWith('.onrender.com')) {
      return u.protocol === 'https:';
    }
  } catch {
    return false;
  }
  return false;
}

// Supabase Realtime (phoenix.cjs.js) lança TypeError em setTimeout quando o WebSocket
// não está estabelecido no momento do disconnect. Sem este handler, o processo crasharia.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Erro não capturado — processo continua:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Rejeição não tratada — processo continua:', reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.use(compression());

  // Middleware de diagnóstico: loga tamanho e MIME de uploads
  app.use((req: any, _res: any, next: any) => {
    if (req.method === 'POST' && /evidence|document/.test(req.url)) {
      const len = req.headers['content-length'] ?? '?';
      const ct = req.headers['content-type'] ?? '?';
      console.log(`[upload-req] ${req.method} ${req.url} | size=${len}b | ct=${ct.slice(0, 80)}`);
    }
    next();
  });

  app.enableCors({
    // Apps móveis costumam não enviar Origin; Flutter web / LAN usam 192.168.x ou 10.x.
    // Túneis ngrok: browser envia Origin https://*.ngrok-free.app (requer HTTPS).
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      return callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  const config = new DocumentBuilder()
    .setTitle('OX Field Service API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(Number(port), '0.0.0.0');
  console.log(`🚀 OX API rodando em http://localhost:${port}`);
  console.log(`🌐 OX API na rede local: http://192.168.1.18:${port}`);
  console.log(`📄 Docs em http://localhost:${port}/api/docs`);
}
bootstrap();
