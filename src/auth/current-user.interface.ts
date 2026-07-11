import { User } from '@prisma/client'

export type CurrentUser = Omit<User, 'loginPassword'>
