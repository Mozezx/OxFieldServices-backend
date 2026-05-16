import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { InspectorService } from './inspector.service';
import { ReviewPhaseDto } from './dto/review-phase.dto';

@ApiTags('Inspector')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inspector')
export class InspectorController {
  constructor(private readonly inspectorService: InspectorService) {}

  @Get('pending-reviews')
  @Roles('inspector', 'admin')
  @ApiOperation({ summary: 'Listar fases aguardando inspeção de qualidade' })
  getPendingReviews() {
    return this.inspectorService.getPendingReviews();
  }

  @Get('active-phases')
  @Roles('inspector', 'admin')
  @ApiOperation({ summary: 'Listar fases atualmente em execução pelos workers' })
  getActivePhases() {
    return this.inspectorService.getActivePhases();
  }

  @Post('phases/:phaseId/review')
  @Roles('inspector', 'admin')
  @ApiOperation({ summary: 'Aprovar ou rejeitar uma fase (inspetor)' })
  reviewPhase(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Req() req: any,
    @Body() dto: ReviewPhaseDto,
  ) {
    return this.inspectorService.reviewPhase(phaseId, req.user.id, dto);
  }
}
