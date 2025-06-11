import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  message,
  type Message,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import type { VisibilityType } from '@/components/visibility-selector';
import { ChatSDKError } from '../errors';
import type { InferInsertModel } from 'drizzle-orm';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
// eslint-disable-next-line no-console
console.log('DEBUG: Available relevant env keys:', Object.keys(process.env).filter(k => k.startsWith('LANGFLOW_') || k === 'POSTGRES_URL' || k === 'NODE_ENV'));
// eslint-disable-next-line no-console
console.log('DEBUG: POSTGRES_URL value:', process.env.POSTGRES_URL);
// eslint-disable-next-line no-console
console.log('DEBUG: LANGFLOW_BASE_URL value:', process.env.LANGFLOW_BASE_URL);
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);


// Functions saveChat, deleteChatById, getChats, getChatById were removed as the 'chat' table does not exist.

export async function saveMessages({
  messages,
}: {
  messages: Array<InferInsertModel<typeof message>>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function getMessagesBySessionId({ sessionId }: { sessionId: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.session_id, sessionId))
      .orderBy(asc(message.timestamp));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in getMessagesBySessionId:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by session id',
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message by id',
    );
  }
}

export async function deleteMessagesBySessionIdAfterTimestamp({
  sessionId,
  timestampValue,
}: {
  sessionId: string;
  timestampValue: Date;
}) {
  try {
    // Delete messages associated with this sessionId and after the timestampValue
    return await db
      .delete(message)
      .where(
        and(
          eq(message.session_id, sessionId),
          gte(message.timestamp, timestampValue)
        )
      )
      .returning();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in deleteMessagesBySessionIdAfterTimestamp:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by session id after timestamp',
    );
  }
}

// Function updateChatVisiblityById was removed as the 'chat' table does not exist.


