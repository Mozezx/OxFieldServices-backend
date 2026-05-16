import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import { UploadProjectDocumentDto } from './dto/upload-project-document.dto';
import { RegisterDocumentDto } from './dto/register-document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  private userKey(req: Request): string {
    const user = req.user as { id?: string; _unsynced?: boolean; authId?: string };
    if (!user?.id || user._unsynced) {
      throw new ForbiddenException(
        'Perfil não sincronizado. Use POST /auth/sync antes de continuar.',
      );
    }
    return user.id;
  }

  @Post(':id/documents')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Upload de documento do projeto' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type', 'fileName'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: [
            'CONTRACT',
            'RECEIPT',
            'BLUEPRINT',
            'WORK_ORDER',
            'INSPECTION',
            'OTHER',
          ],
        },
        fileName: { type: 'string' },
        phaseId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 40 * 1024 * 1024 } }))
  upload(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadProjectDocumentDto,
  ) {
    return this.documentsService.upload(
      projectId,
      this.userKey(req),
      file,
      body.type,
      body.fileName,
      body.phaseId,
    );
  }

  @Post(':id/documents/register')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Registrar documento já enviado ao Storage diretamente' })
  @ApiBody({ type: RegisterDocumentDto })
  register(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Req() req: Request,
    @Body() dto: RegisterDocumentDto,
  ) {
    return this.documentsService.register(projectId, this.userKey(req), dto);
  }

  @Get(':id/documents')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar documentos do projeto' })
  @ApiQuery({ name: 'phaseId', required: false })
  list(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Req() req: Request,
    @Query('phaseId') phaseId?: string,
  ) {
    const phase =
      phaseId && /^[0-9a-f-]{36}$/i.test(phaseId) ? phaseId : undefined;
    if (phaseId && !phase) {
      throw new BadRequestException('phaseId inválido.');
    }
    return this.documentsService.list(projectId, this.userKey(req), phase);
  }

  @Delete(':id/documents/:docId')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Apagar documento (autor ou admin da org)' })
  remove(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: Request,
  ) {
    return this.documentsService.remove(projectId, docId, this.userKey(req));
  }
}
