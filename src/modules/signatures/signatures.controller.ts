import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SignatureTarget } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { SignaturesService } from './signatures.service';

@ApiTags('signatures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Post()
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Registar assinatura digital (PNG no storage)' })
  create(@Req() req: Request, @Body() dto: CreateSignatureDto) {
    const user = req.user as { id?: string; _unsynced?: boolean; authId?: string };
    const userKey = user?.id ?? user?.authId ?? '';
    if (!user?.id || user._unsynced) {
      throw new ForbiddenException(
        'Perfil não sincronizado. Use POST /auth/sync antes de assinar.',
      );
    }
    return this.signaturesService.create(userKey, dto, req);
  }

  @Get(':entityType/:entityId')
  @Roles('client', 'worker', 'admin')
  @ApiOperation({ summary: 'Listar assinaturas de uma entidade' })
  list(
    @Req() req: Request,
    @Param('entityType', new ParseEnumPipe(SignatureTarget)) entityType: SignatureTarget,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    const user = req.user as { id?: string; _unsynced?: boolean; authId?: string };
    const userKey = user?.id ?? user?.authId ?? '';
    if (!user?.id || user._unsynced) {
      throw new ForbiddenException(
        'Perfil não sincronizado. Use POST /auth/sync antes de continuar.',
      );
    }
    return this.signaturesService.listForEntity(userKey, entityType, entityId);
  }
}
