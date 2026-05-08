import { Controller, Delete, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GalleryService } from './gallery.service';

@ApiTags('Gallery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gallery-links')
export class GalleryLinksController {
  constructor(private readonly galleryService: GalleryService) {}

  private userKey(req: { user?: { id?: string; authId?: string } }): string {
    return String(req.user?.id ?? req.user?.authId ?? '');
  }

  @Delete(':id')
  @Roles('admin', 'client')
  @ApiOperation({
    summary: 'Revogar link de galeria (admin ou cliente dono do projeto encerrado)',
  })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.galleryService.revokeLink(id, this.userKey(req));
  }
}
