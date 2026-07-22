import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { BankCardsService } from './bank-cards.service'
import { CreateBankCardDto } from './dto/create-bank-card.dto'
import { UpdateBankCardDto } from './dto/update-bank-card.dto'

@ApiTags('银行卡')
@ApiBearerAuth('user-auth')
@Controller('bank-cards')
export class BankCardsController {
  constructor(private readonly bankCardsService: BankCardsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '绑定银行卡', description: '加密卡号入库，返回脱敏后的卡片信息' })
  @ApiResponse({ status: 201, description: '绑卡成功' })
  @ApiResponse({ status: 400, description: 'KB219 绑卡超过上限 / KB220 卡号格式不正确' })
  @ApiResponse({ status: 409, description: 'KB218 该银行卡已被绑定' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateBankCardDto) {
    return this.bankCardsService.create(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '查询我的银行卡列表', description: '返回当前用户所有有效银行卡（脱敏）' })
  @ApiResponse({ status: 200, description: '返回银行卡列表' })
  findByUser(@CurrentUser() user: CurrentUserType) {
    return this.bankCardsService.findByUser(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('default')
  @ApiOperation({ summary: '查询默认银行卡', description: '返回当前用户的默认卡（脱敏）' })
  @ApiResponse({ status: 200, description: '返回默认卡；未设置时返回 null' })
  async findDefault(@CurrentUser() user: CurrentUserType) {
    const card = await this.bankCardsService.findDefault(user.id)
    return card ?? null
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiOperation({ summary: '更新银行卡资料', description: '可修改持卡人、银行、默认标记等；不允许改卡号' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: 'KB217 银行卡不存在' })
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankCardDto,
  ) {
    return this.bankCardsService.update(user.id, id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiOperation({ summary: '解绑银行卡', description: '软删除：标记为 DELETED，便于审计；若删除默认卡会自动转移默认' })
  @ApiResponse({ status: 200, description: '解绑成功' })
  @ApiResponse({ status: 404, description: 'KB217 银行卡不存在' })
  remove(@CurrentUser() user: CurrentUserType, @Param('id', ParseUUIDPipe) id: string) {
    return this.bankCardsService.remove(user.id, id)
  }
}
