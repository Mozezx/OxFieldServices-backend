import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AssignmentsService } from './assignments.service';
import { AssignWorkerDto } from './dto/assign-worker.dto';

@ApiTags('Assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  private adminId(req: { user?: { id?: string; authId?: string } }): string {
    const id = req.user?.id;
    if (!id || typeof id !== 'string') {
      throw new UnauthorizedException('Sessão inválida');
    }
    return id;
  }

  @Post('projects/:projectId/assignments')
  @Roles('admin')
  @ApiOperation({ summary: 'Atribuir worker ao projeto' })
  assign(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
    @Body() dto: AssignWorkerDto,
  ) {
    return this.assignmentsService.assign(projectId, dto, this.adminId(req));
  }

  @Delete('projects/:projectId/assignments/:workerId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remover atribuição do worker ao projeto' })
  unassign(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Req() req: any,
  ) {
    return this.assignmentsService.unassign(
      projectId,
      workerId,
      this.adminId(req),
    );
  }

  @Get('projects/:projectId/assignments')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar atribuições ativas do projeto' })
  listByProject(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.assignmentsService.listByProject(projectId);
  }

  @Get('workers/:workerId/assignments')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar projetos atribuídos ao worker' })
  listByWorker(@Param('workerId', ParseUUIDPipe) workerId: string) {
    return this.assignmentsService.listByWorker(workerId);
  }
}
