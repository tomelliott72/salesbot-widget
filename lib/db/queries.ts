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
  chat,
  message,
  type Chat,
  type Message,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import type { VisibilityType } from '@/components/visibility-selector';
import { ChatSDKError } from '../errors';

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


export async function saveChat({
  id, // This is chat.id (UUID)
  name, // This is chat.name (formerly title)
  flow_id,
  chat_id, // This is Langflow's varchar session ID
  is_public, // This is chat.is_public (boolean)
  user_id,
  description,
}: {
  id: string;
  name: string;
  flow_id: string;
  chat_id: string;
  is_public: boolean;
  user_id?: string | null;
  description?: string | null;
}) {
  try {
    const [savedChat] = await db.insert(chat).values({
      id,
      name,
      flow_id,
      chat_id,
      is_public,
      user_id: user_id ?? undefined, // Ensure null becomes undefined for Drizzle
      description: description ?? undefined,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning();
    return savedChat;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in saveChat:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({ id }: { id: string }) { // id is chat.id (uuid)
  try {
    // Get the langflow_chat_id (varchar) for the given chat.id (uuid)
    const chatToDeleteDetails = await db
      .select({ langflow_chat_id: chat.chat_id })
      .from(chat)
      .where(eq(chat.id, id))
      .limit(1);

    if (chatToDeleteDetails.length > 0 && chatToDeleteDetails[0].langflow_chat_id) {
      const langflowChatId = chatToDeleteDetails[0].langflow_chat_id;
      // Delete messages associated with this langflow_chat_id
      await db.delete(message).where(eq(message.chat_id, langflowChatId));
    }

    // Delete the chat entry itself
    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in deleteChatById:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete chat by id',
    );
  }
}

export async function getChats({
  limit,
  startingAfter,
  endingBefore,
}: {
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(whereCondition)
        .orderBy(desc(chat.created_at))
        .limit(extendedLimit);

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${startingAfter} not found`,
        );
      }

      filteredChats = await query(gt(chat.created_at, selectedChat.created_at));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${endingBefore} not found`,
        );
      }

      filteredChats = await query(lt(chat.created_at, selectedChat.created_at));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching chats:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to get chats');
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    return selectedChat;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching chat by ID:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id');
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<Message>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function getMessagesByChatId({ id }: { id: string }) { // id here is langflow_chat_id (varchar)
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chat_id, id)) // Corrected: message.chat_id
      .orderBy(asc(message.created_at)); // Corrected: message.created_at
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in getMessagesByChatId:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id',
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

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId, // This is chat.id (uuid)
  timestamp,
}: {
  chatId: string; // This is chat.id (uuid)
  timestamp: Date;
}) {
  try {
    // Get the langflow_chat_id (varchar) for the given chat.id (uuid)
    const chatDetails = await db
      .select({ langflow_chat_id: chat.chat_id })
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1);

    if (chatDetails.length > 0 && chatDetails[0].langflow_chat_id) {
      const langflowChatId = chatDetails[0].langflow_chat_id;

      // Delete messages associated with this langflow_chat_id and after the timestamp
      return await db
        .delete(message)
        .where(
          and(
            eq(message.chat_id, langflowChatId),
            gte(message.created_at, timestamp)
          )
        )
        .returning();
    }
    return []; // Return empty array if chat not found or no messages to delete
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in deleteMessagesByChatIdAfterTimestamp:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by chat id after timestamp',
    );
  }
}

export async function updateChatVisiblityById({
  chatId, // This is chat.id (uuid)
  is_public,
}: {
  chatId: string;
  is_public: boolean;
}) {
  try {
    return await db.update(chat).set({ is_public, updated_at: new Date() }).where(eq(chat.id, chatId));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in updateChatVisiblityById:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat visibility by id',
    );
  }
}


