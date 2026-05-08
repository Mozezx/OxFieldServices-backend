import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GalleryService } from './gallery.service';

@ApiTags('Gallery (público)')
@Controller('gallery')
@UseGuards(ThrottlerGuard)
export class PublicGalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Ver galeria pública por token (sem autenticação)' })
  getByToken(@Param('token') token: string) {
    return this.galleryService.getPublicByToken(token);
  }
}
