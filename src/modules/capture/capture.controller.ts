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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CaptureService } from './capture.service';
import { ProcessCaptureDto } from './dto/process-capture.dto';

@ApiTags('Capture')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('capture')
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  private userKey(req: { user?: { id?: string; authId?: string } }): string {
    const id = req.user?.id ?? req.user?.authId;
    if (!id || typeof id !== 'string') {
      throw new UnauthorizedException('Sessão inválida');
    }
    return id;
  }

  @Post('process')
  @Roles('admin')
  @ApiOperation({ summary: 'Processar texto livre com IA e guardar itens' })
  process(@Req() req: any, @Body() dto: ProcessCaptureDto) {
    return this.captureService.process(this.userKey(req), dto);
  }

  @Get('recent')
  @Roles('admin')
  @ApiOperation({ summary: 'Listar os 20 itens de captura mais recentes' })
  recent(@Req() req: any) {
    return this.captureService.recent(this.userKey(req));
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar um item de captura' })
  remove(@Req() req: any, @Param('id') id: string) {
    return this.captureService.remove(this.userKey(req), id);
  }
}
