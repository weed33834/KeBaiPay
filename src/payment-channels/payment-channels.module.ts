import { Global, Module } from '@nestjs/common'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { RefundService } from './refund.service'
import { ChannelHealthService } from './channel-health.service'
import { MockChannel } from './channels/mock.channel'
import { WechatPayChannel } from './channels/wechat-pay.channel'
import { AlipayChannel } from './channels/alipay.channel'
import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../redis/redis.module'

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    PaymentChannelRegistry,
    RefundService,
    ChannelHealthService,
    MockChannel,
    WechatPayChannel,
    AlipayChannel,
  ],
  exports: [
    PaymentChannelRegistry,
    RefundService,
    ChannelHealthService,
  ],
})
export class PaymentChannelsModule {}
