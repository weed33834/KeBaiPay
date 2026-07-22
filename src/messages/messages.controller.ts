import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { MessagesService } from './messages.service'
import { ListMessageDto } from './dto/message.dto'

@ApiTags('消息中心')
@ApiBearerAuth('user-auth')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '我的消息列表（含广播+定向，带已读标记）' })
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListMessageDto) {
    return this.messagesService.listMyMessages(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread/count')
  @ApiOperation({ summary: '我的未读消息数量' })
  unreadCount(@CurrentUser() user: CurrentUserType) {
    return this.messagesService.getUnreadCount(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('read/all')
  @ApiOperation({ summary: '一键全部已读' })
  markAllAsRead(@CurrentUser() user: CurrentUserType) {
    return this.messagesService.markAllAsRead(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':messageNo')
  @ApiOperation({ summary: '消息详情' })
  findByMessageNo(
    @CurrentUser() user: CurrentUserType,
    @Param('messageNo') messageNo: string,
  ) {
    return this.messagesService.findByMessageNo(messageNo, user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':messageNo/read')
  @ApiOperation({ summary: '标记消息已读' })
  markAsRead(
    @CurrentUser() user: CurrentUserType,
    @Param('messageNo') messageNo: string,
  ) {
    return this.messagesService.markAsRead(user.id, messageNo)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':messageNo/delete')
  @ApiOperation({ summary: '删除定向消息（广播不可删）' })
  delete(
    @CurrentUser() user: CurrentUserType,
    @Param('messageNo') messageNo: string,
  ) {
    return this.messagesService.deleteMessage(user.id, messageNo)
  }
}
