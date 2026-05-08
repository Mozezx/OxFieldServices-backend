import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PublicProjectsController } from './public-projects.controller';
import { ProjectEvidenceController } from './project-evidence.controller';
import { ProjectsService } from './projects.service';
import { ProjectEvidenceService } from './project-evidence.service';
import { InvitesModule } from '../invites/invites.module';
import { TemplatesModule } from '../templates/templates.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [InvitesModule, TemplatesModule, PaymentsModule],
  controllers: [PublicProjectsController, ProjectsController, ProjectEvidenceController],
  providers: [ProjectsService, ProjectEvidenceService],
  exports: [ProjectsService, ProjectEvidenceService],
})
export class ProjectsModule {}
