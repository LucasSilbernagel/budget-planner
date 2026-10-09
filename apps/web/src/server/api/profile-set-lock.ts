import type { db } from '@budget-planner/db/client'
import { users } from '@budget-planner/db/schema'
import { eq } from 'drizzle-orm'

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Every transaction depending on the live-profile set locks the users row first: writers NO KEY UPDATE,
// child creates SHARE. FOR UPDATE would conflict with every child insert's FK KEY SHARE.
export async function lockUserProfileSet(
	tx: DbTx,
	userId: string,
	strength: 'no key update' | 'share'
): Promise<void> {
	await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for(strength)
}
