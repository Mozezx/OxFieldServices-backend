import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GalleryService } from './gallery.service';
import { CreateGalleryLinkDto } from './dto/create-gallery-link.dto';

@ApiTags('Gallery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class GalleryProjectsController {
  constructor(private readonly galleryService: GalleryService) {}

  private userKey(req: { user?: { id?: string; authId?: string } }): string {
    return String(req.user?.id ?? req.user?.authId ?? '');
  }

  @Get(':id/gallery-links')
  @Roles('admin', 'client')
  @ApiOperation({ summary: 'Listar links de galeria do projeto' })
  listGalleryLinks(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    return this.galleryService.listLinks(id, this.userKey(req));
  }

  @Post(':id/gallery-links')
  @Roles('admin', 'client')
  @ApiOperation({
    summary: 'Criar link público de galeria (admin ou cliente com projeto encerrado)',
  })
  createGalleryLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: CreateGalleryLinkDto,
  ) {
    return this.galleryService.createLink(id, this.userKey(req), dto);
  }
}
