import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CrewsService } from './crews.service';
import { AddCrewMemberDto } from './dto/add-crew-member.dto';
import { AssignCrewToProjectDto } from './dto/assign-crew-to-project.dto';
import { CreateCrewDto } from './dto/create-crew.dto';
import { UpdateCrewDto } from './dto/update-crew.dto';

@ApiTags('Crews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CrewsController {
  constructor(private readonly crewsService: CrewsService) {}

  private userKey(req: { user?: { id?: string; authId?: string } }): string {
    const id = req.user?.id ?? req.user?.authId;
    if (!id || typeof id !== 'string') {
      throw new UnauthorizedException('Sessão inválida');
    }
    return id;
  }

  @Post('crews')
  @Roles('admin')
  @ApiOperation({ summary: 'Criar equipe (crew)' })
  create(@Req() req: any, @Body() dto: CreateCrewDto) {
    return this.crewsService.create(this.userKey(req), dto);
  }

  @Get('crews')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar equipes da organização' })
  list(@Req() req: any) {
    return this.crewsService.list(this.userKey(req));
  }

  @Patch('crews/:crewId')
  @Roles('admin')
  @ApiOperation({ summary: 'Atualizar nome/descrição da equipe' })
  update(
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Req() req: any,
    @Body() dto: UpdateCrewDto,
  ) {
    return this.crewsService.update(this.userKey(req), crewId, dto);
  }

  @Delete('crews/:crewId')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar equipe' })
  remove(@Param('crewId', ParseUUIDPipe) crewId: string, @Req() req: any) {
    return this.crewsService.remove(this.userKey(req), crewId);
  }

  @Post('crews/:crewId/members')
  @Roles('admin')
  @ApiOperation({ summary: 'Adicionar worker à equipe' })
  addMember(
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Req() req: any,
    @Body() dto: AddCrewMemberDto,
  ) {
    return this.crewsService.addMember(this.userKey(req), crewId, dto);
  }

  @Delete('crews/:crewId/members/:workerId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remover worker da equipe' })
  removeMember(
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Req() req: any,
  ) {
    return this.crewsService.removeMember(this.userKey(req), crewId, workerId);
  }

  @Post('projects/:projectId/assign-crew')
  @Roles('admin')
  @ApiOperation({
    summary: 'Atribuir todos os membros da equipe ao projeto',
  })
  assignCrewToProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
    @Body() dto: AssignCrewToProjectDto,
  ) {
    return this.crewsService.assignCrewToProject(
      this.userKey(req),
      projectId,
      dto,
    );
  }
}
