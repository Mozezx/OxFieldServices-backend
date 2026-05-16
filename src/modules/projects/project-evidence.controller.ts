import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProjectEvidenceService, ProjectChecklistItem } from './project-evidence.service';

class CreateCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string;
}

class UpsertChecklistDto {
  @ApiProperty()
  items: ProjectChecklistItem[];
}

class RegisterProjectEvidenceDto {
  @ApiProperty()
  @IsString()
  storagePath: string;

  @ApiProperty()
  @IsString()
  mimeType: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(300 * 1024 * 1024)
  size: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gpsAccuracy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

@ApiTags('Project Evidence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId')
export class ProjectEvidenceController {
  constructor(private readonly service: ProjectEvidenceService) {}

  @Post('evidences')
  @Roles('worker', 'admin')
  @ApiOperation({ summary: 'Upload de evidência diretamente no projeto (sem fase)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        gpsAccuracy: { type: 'number' },
        capturedAt: { type: 'string', format: 'date-time' },
        note: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 300 * 1024 * 1024 } }))
  upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.service.upload(projectId, file, req.user.id, req, body);
  }

  @Post('evidences/register')
  @Roles('worker', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar evidência já enviada ao Storage diretamente (worker)' })
  @ApiBody({ type: RegisterProjectEvidenceDto })
  registerEvidence(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
    @Body() dto: RegisterProjectEvidenceDto,
  ) {
    const idempotencyKey = req.headers?.['x-idempotency-key'] as string | undefined;
    return this.service.register(projectId, req.user.id, dto, idempotencyKey);
  }

  @Get('evidences')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar evidências diretas do projeto' })
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
  ) {
    return this.service.list(projectId, req.user.id);
  }

  @Delete('evidences/:evidenceId')
  @Roles('worker', 'admin')
  @ApiOperation({ summary: 'Remover evidência direta do projeto' })
  remove(
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Req() req: any,
  ) {
    return this.service.remove(evidenceId, req.user.id);
  }

  @Post('evidences/:evidenceId/comments')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Comentar em evidência direta do projeto' })
  createComment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Req() req: any,
    @Body() dto: CreateCommentDto,
  ) {
    return this.service.createComment(evidenceId, req.user.id, dto.content);
  }

  @Get('evidences/:evidenceId/comments')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar comentários de evidência direta do projeto' })
  listComments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Req() req: any,
  ) {
    void projectId;
    return this.service.listComments(evidenceId, req.user.id);
  }

  @Delete('evidences/comments/:commentId')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Remover comentário de evidência direta' })
  deleteComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() req: any,
  ) {
    return this.service.deleteComment(commentId, req.user.id);
  }

  @Get('checklist')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Obter checklist do projeto (nível projeto, sem fase)' })
  getChecklist(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
  ) {
    return this.service.getChecklist(projectId, req.user.id);
  }

  @Patch('checklist')
  @Roles('worker', 'admin')
  @ApiOperation({ summary: 'Atualizar checklist do projeto' })
  upsertChecklist(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: any,
    @Body() dto: UpsertChecklistDto,
  ) {
    return this.service.upsertChecklist(projectId, req.user.id, dto.items);
  }
}
