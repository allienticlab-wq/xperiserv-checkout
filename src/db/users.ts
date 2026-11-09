import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string, name?: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        name: name || 'Allientic Administrator',
        role: 'Super Administrator',
        permissions: '["*"]',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user profile with database.', { cause: error });
  }
}

export async function listAllUsers() {
  try {
    return await db.select().from(users);
  } catch (error) {
    console.error('Database query failed in listAllUsers:', error);
    throw new Error('Failed to fetch team members.', { cause: error });
  }
}
