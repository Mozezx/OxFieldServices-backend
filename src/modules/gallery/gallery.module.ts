import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { GalleryService } from './gallery.service';
import { GalleryProjectsController } from './gallery-projects.controller';
import { GalleryLinksController } from './gallery-links.controller';
import { PublicGalleryController } from './public-gallery.controller';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [GalleryProjectsController, GalleryLinksController, PublicGalleryController],
  providers: [GalleryService],
})
export class GalleryModule {}
