import { IsNotEmpty, IsString } from 'class-validator'

export class RejectIdentityDto {
  @IsString()
  @IsNotEmpty()
  reason!: string
}
