import { Request } from 'express'

export type RawBodyRequest<T = Request> = T & {
  rawBody?: Buffer | string
}

export interface MerchantApp {
  id: string
  merchantId: string
  appId: string
  appSecret: string
  name: string
  callbackUrl: string | null
  status: string
}

export type OpenApiRequest = RawBodyRequest & {
  merchantApp?: MerchantApp
}
