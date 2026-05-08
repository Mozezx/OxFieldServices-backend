import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  private userKey(req: Request): string {
    const user = req.user as { id?: string; _unsynced?: boolean; authId?: string };
    if (!user?.id || user._unsynced) {
      throw new ForbiddenException(
        'Perfil não sincronizado. Use POST /auth/sync antes de continuar.',
      );
    }
    return user.id;
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Criar endpoint de webhook (organização do admin)' })
  create(@Req() req: Request, @Body() dto: CreateWebhookEndpointDto) {
    return this.webhooksService.createEndpoint(this.userKey(req), dto);
  }

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Listar webhooks ativos da organização' })
  list(@Req() req: Request) {
    return this.webhooksService.listEndpoints(this.userKey(req));
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Desativar webhook' })
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.deactivateEndpoint(this.userKey(req), id);
  }

  @Post(':id/test')
  @Roles('admin')
  @ApiOperation({ summary: 'Enviar evento de teste ping' })
  test(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.sendTest(this.userKey(req), id);
  }
}
