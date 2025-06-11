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

// The 'chat' table definition has been removed as it does not exist in the Supabase database.

// Schema for the 'message' table, aligned with Supabase structure
export const message = pgTable('message', {
  // From Supabase CSV: id,uuid,NO,null
  id: uuid('id').primaryKey().notNull(),

  // From Supabase CSV: timestamp,timestamp without time zone,NO,null
  timestamp: timestamp('timestamp', { withTimezone: false, mode: 'date' }).notNull(),

  // From Supabase CSV: sender,character varying,NO,null
  // Assuming a reasonable default length for varchar if not specified, or omit length.
  sender: varchar('sender').notNull(),

  // From Supabase CSV: sender_name,character varying,NO,null
  sender_name: varchar('sender_name').notNull(),

  // From Supabase CSV: session_id,character varying,NO,null
  session_id: varchar('session_id').notNull(),

  // From Supabase CSV: text,text,YES,null
  text: text('text'),

  // From Supabase CSV: flow_id,uuid,YES,null
  flow_id: uuid('flow_id'),

  // From Supabase CSV: files,json,YES,null
  // Using jsonb as it's generally preferred in PostgreSQL.
  // If Supabase column is strictly 'json', use json('files').
  files: jsonb('files'),

  // From Supabase CSV: error,boolean,NO,false
  error: boolean('error').default(false).notNull(),

  // From Supabase CSV: edit,boolean,NO,false
  edit: boolean('edit').default(false).notNull(),

  // From Supabase CSV: properties,json,YES,null
  properties: jsonb('properties'),

  // From Supabase CSV: category,text,YES,null
  category: text('category'),
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
