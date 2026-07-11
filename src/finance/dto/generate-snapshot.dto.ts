import { Matches } from 'class-validator'

export class GenerateSnapshotDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string
}
