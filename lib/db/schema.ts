import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  uuid,
  text,
  boolean,
  jsonb,
  doublePrecision,
  integer,
} from 'drizzle-orm/pg-core';

// Schema for Langflow's 'chat' table
export const chat = pgTable('chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(), // Corresponds to Langflow's chat.id (PK)
  user_id: uuid('user_id'), // Nullable, as app might not manage Langflow users directly
  flow_id: uuid('flow_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(), // This is the chat title
  description: varchar('description', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  chat_id: varchar('chat_id', { length: 255 }).notNull().unique(), // Langflow's session identifier, crucial for linking
  is_public: boolean('is_public').default(false).notNull(),
});

export type Chat = InferSelectModel<typeof chat>;

// Schema for Langflow's 'message' table
export const message = pgTable('message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(), // Corresponds to Langflow's message.id (PK)
  chat_id: varchar('chat_id', { length: 255 }).notNull(), // Links to chat.chat_id (varchar)
  // .references(() => chat.chat_id), // Drizzle FK might be tricky if chat_id in chat table isn't explicitly unique/PK in Drizzle's eyes, but it is unique in DB.
  text: text('text'), // Main message content
  sender_type: varchar('sender_type', { length: 255 }), // e.g., 'user', 'bot'
  sender_name: varchar('sender_name', { length: 255 }),
  files: jsonb('files'), // Assuming files are stored as JSON
  intermediate_steps: text('intermediate_steps'),
  timestamp: doublePrecision('timestamp'), // Langflow uses float8, maps to doublePrecision
  session_id: varchar('session_id', { length: 255 }), // Might be redundant with chat_id
  is_bot: boolean('is_bot').default(false).notNull(),
  flow_id: uuid('flow_id').notNull(),
  version: varchar('version', { length: 255 }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  order: integer('order').default(1).notNull(),
  artifacts: jsonb('artifacts'),
});

export type Message = InferSelectModel<typeof message>;

// The old 'Message' (messageDeprecated) and 'Message_v2' schemas are no longer needed
// as we are aligning with Langflow's 'message' table.

// You might have other tables like 'document', 'suggestion', 'stream', 'vote'.
// These would also need to be reviewed and potentially updated or removed
// if Langflow's schema handles their equivalent functionality.

// Example for 'document' if you still need it and it's separate from Langflow:
// export const document = pgTable('document', {
//   id: uuid('id').primaryKey().notNull().defaultRandom(),
//   chatId: uuid('chatId')
//     .notNull()
//     .references(() => chat.id), // This would now reference the new chat.id (uuid)
//   name: text('name').notNull(),
//   url: text('url').notNull(),
//   metadata: jsonb('metadata'),
//   createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
// });
// export type Document = InferSelectModel<typeof document>;

// Similarly for 'suggestion', 'stream', 'vote' - review their necessity and structure.
