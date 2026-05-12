import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PhasesModule } from './modules/phases/phases.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { WorkersModule } from './modules/workers/workers.module';
import { MatchingModule } from './modules/matching/matching.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';
import { SkillsModule } from './modules/skills/skills.module';
import { InvitesModule } from './modules/invites/invites.module';
import { AdminModule } from './modules/admin/admin.module';
import { ToolsModule } from './modules/tools/tools.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { AiModule } from './modules/ai/ai.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { CrewsModule } from './modules/crews/crews.module';
import { CaptureModule } from './modules/capture/capture.module';
import { CacheModule } from './cache/cache.module';
import { HubspotModule } from './modules/hubspot/hubspot.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    CacheModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (!redisUrl) {
          throw new Error('REDIS_URL é obrigatório para filas Bull.');
        }
        const parsed = new URL(redisUrl);
        const dbFromPath = Number(parsed.pathname.replace('/', ''));
        return {
          redis: {
            host: parsed.hostname,
            port: Number(parsed.port || 6379),
            username: parsed.username || undefined,
            password: parsed.password || undefined,
            db: Number.isFinite(dbFromPath) ? dbFromPath : 0,
            enableReadyCheck: false,
            maxRetriesPerRequest: null,
            ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
          },
        };
      },
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    ReportsModule,
    PhasesModule,
    PaymentsModule,
    ContractsModule,
    WorkersModule,
    MatchingModule,
    NotificationsModule,
    UsersModule,
    SkillsModule,
    InvitesModule,
    AdminModule,
    ToolsModule,
    GalleryModule,
    TemplatesModule,
    AiModule,
    SignaturesModule,
    WebhooksModule,
    DocumentsModule,
    AssignmentsModule,
    CrewsModule,
    CaptureModule,
    HubspotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
