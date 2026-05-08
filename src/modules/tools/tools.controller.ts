import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ToolsService } from './tools.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateToolDto } from './dto/create-tool.dto';
import { UpdateToolDto } from './dto/update-tool.dto';
import { RequestToolDto } from './dto/request-tool.dto';

const TOOL_IMAGE_LIMIT = 5 * 1024 * 1024;

@ApiTags('tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  // ─── Categories (antes de rotas :id) ───────────────────

  @Get('categories')
  @Roles('admin', 'worker')
  @ApiOperation({ summary: 'Listar categorias de ferramentas' })
  listCategories() {
    return this.toolsService.findCategories();
  }

  @Post('categories')
  @Roles('admin')
  @ApiOperation({ summary: 'Criar categoria' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.toolsService.createCategory(dto);
  }

  @Patch('categories/:catId')
  @Roles('admin')
  @ApiOperation({ summary: 'Atualizar categoria' })
  updateCategory(
    @Param('catId', ParseUUIDPipe) catId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.toolsService.updateCategory(catId, dto);
  }

  @Delete('categories/:catId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remover categoria (sem ferramentas)' })
  removeCategory(@Param('catId', ParseUUIDPipe) catId: string) {
    return this.toolsService.removeCategory(catId);
  }

  // ─── Checkouts list / admin force-return ────────────────

  @Get('checkouts')
  @Roles('admin', 'worker')
  @ApiOperation({
    summary: 'Checkouts ativos (admin: todos; worker: apenas os meus)',
  })
  listActiveCheckouts(@Req() req: { user: { id: string; role: string } }) {
    return this.toolsService.listActiveCheckoutsForRole(
      req.user.id,
      req.user.role,
    );
  }

  @Patch('checkouts/:checkoutId/confirm-return')
  @Roles('admin')
  @ApiOperation({
    summary: 'Confirmar receção da ferramenta (admin, após pedido do worker)',
  })
  confirmReturn(@Param('checkoutId', ParseUUIDPipe) checkoutId: string) {
    return this.toolsService.confirmReturnCheckout(checkoutId);
  }

  @Patch('checkouts/:checkoutId/force-return')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Devolução forçada (admin): encerra checkout em CHECKED_OUT ou RETURN_PENDING',
  })
  forceReturn(@Param('checkoutId', ParseUUIDPipe) checkoutId: string) {
    return this.toolsService.forceReturnCheckout(checkoutId);
  }

  // ─── Tools CRUD ─────────────────────────────────────────

  @Get()
  @Roles('admin', 'worker')
  @ApiOperation({ summary: 'Listar ferramentas' })
  findAll(@Query('categoryId') categoryId?: string) {
    return this.toolsService.findTools(categoryId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Criar ferramenta (imagem opcional)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'categoryId'],
      properties: {
        name: { type: 'string' },
        categoryId: { type: 'string', format: 'uuid' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: TOOL_IMAGE_LIMIT } }),
  )
  create(
    @Body() dto: CreateToolDto,
    @UploadedFile() image: Express.Multer.File | undefined,
  ) {
    return this.toolsService.createTool(dto, image);
  }

  @Get(':id/checkouts')
  @Roles('admin')
  @ApiOperation({ summary: 'Histórico de checkouts de uma ferramenta' })
  checkoutHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.toolsService.checkoutHistoryForTool(id);
  }

  @Get(':id')
  @Roles('admin', 'worker')
  @ApiOperation({ summary: 'Detalhe da ferramenta' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.toolsService.findOneTool(id);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Atualizar ferramenta (campos e/ou imagem)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        categoryId: { type: 'string', format: 'uuid' },
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: TOOL_IMAGE_LIMIT } }),
  )
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateToolDto,
    @UploadedFile() image: Express.Multer.File | undefined,
  ) {
    return this.toolsService.updateTool(id, dto, image);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Excluir ferramenta' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.toolsService.removeTool(id);
  }

  @Post(':id/checkout')
  @Roles('worker')
  @ApiOperation({ summary: 'Solicitar ferramenta (checkout)' })
  checkout(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
    @Body() _body: RequestToolDto,
  ) {
    return this.toolsService.checkoutTool(id, req.user.id);
  }

  @Post(':id/return')
  @Roles('worker')
  @ApiOperation({
    summary:
      'Pedir devolução da ferramenta (pendente até o administrador confirmar a receção)',
  })
  returnTool(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.toolsService.returnTool(id, req.user.id);
  }
}
