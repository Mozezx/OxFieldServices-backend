import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  private userKey(req: { user?: { id?: string; authId?: string } }): string {
    return String(req.user?.id ?? req.user?.authId ?? '');
  }

  @Get()
  @Roles('client', 'worker', 'admin')
  @ApiOperation({
    summary:
      'Listar templates da organização (ativos por omissão; manage=true só admin inclui inativos)',
  })
  list(@Req() req: any, @Query('manage') manage?: string) {
    const user = req.user as { role?: string } | undefined;
    const includeInactive =
      manage === 'true' && user?.role === 'admin';
    return this.templates.findAllForUser(this.userKey(req), {
      includeInactive,
    });
  }

  @Get(':id')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Obter template por id' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.templates.findOneForUser(this.userKey(req), id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Criar template (admin)' })
  create(@Req() req: any, @Body() dto: CreateTemplateDto) {
    return this.templates.create(this.userKey(req), dto);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Atualizar template (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(this.userKey(req), id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Desativar template (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.templates.softDelete(this.userKey(req), id);
  }
}
