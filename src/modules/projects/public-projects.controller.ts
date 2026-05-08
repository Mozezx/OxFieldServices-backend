import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PublicIdentifyDto } from './dto/public-identify.dto';
import { PublicPhaseCommentDto } from './dto/public-phase-comment.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects Public')
@Controller('projects')
export class PublicProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Public()
  @Get('public/:token')
  @ApiOperation({ summary: 'Dados do projeto para o portal do cliente (sem autenticação)' })
  getPublic(@Param('token') token: string) {
    return this.projectsService.getPublicProjectView(decodeURIComponent(token));
  }

  @Public()
  @Post('public/:token/identify')
  @ApiOperation({
    summary: 'Identificação opcional no portal (email/nome para contacto futuro, sem conta)',
  })
  identify(@Param('token') token: string, @Body() dto: PublicIdentifyDto) {
    return this.projectsService.identifyPublicPortalViewer(decodeURIComponent(token), dto);
  }

  @Public()
  @Post('public/:token/phases/:phaseId/comments')
  @ApiOperation({ summary: 'Comentário do cliente numa fase (sem autenticação)' })
  postPhaseComment(
    @Param('token') token: string,
    @Param('phaseId') phaseId: string,
    @Body() dto: PublicPhaseCommentDto,
  ) {
    return this.projectsService.addPublicPhaseComment(
      decodeURIComponent(token),
      phaseId,
      dto,
    );
  }
}
