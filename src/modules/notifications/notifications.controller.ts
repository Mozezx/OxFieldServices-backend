import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { SendNotificationDto } from './dto/send-notification.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Enviar notificação manual (admin)' })
  @ApiBody({ type: SendNotificationDto })
  sendManual(@Body() dto: SendNotificationDto) {
    return this.notificationsService.sendManual({
      type: dto.type,
      title: dto.title,
      body: dto.body,
      userEmail: dto.userEmail,
      role: dto.role,
      entityType: dto.entityType,
      entityId: dto.entityId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Listar notificações (paginado por cursor)' })
  async list(@Req() req: any, @Query() query: NotificationsQueryDto) {
    return this.notificationsService.listForUser({
      userId: req.user.id,
      cursor: query.cursor,
      limit: query.limit ?? 20,
      since: query.since,
    });
  }

  @Get('feed-context')
  @ApiOperation({ summary: 'Contexto do feed (organizationId + userId para Realtime)' })
  feedContext(@Req() req: any) {
    return this.notificationsService.getFeedContext(req.user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Contagem de notificações não lidas' })
  unreadCount(@Req() req: any) {
    return this.notificationsService.unreadCount(req.user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas como lidas' })
  markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar uma notificação como lida' })
  markRead(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markRead(req.user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover uma notificação' })
  remove(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.deleteOne(req.user.id, id);
  }
}
