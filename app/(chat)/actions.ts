'use server';

import { generateText, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import {
  deleteMessagesBySessionIdAfterTimestamp,
  getMessageById,
} from '@/lib/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const { text: title } = await generateText({
    model: myProvider.languageModel('title-model'),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  // id here is the UUID of a specific message
  const [messageDetails] = await getMessageById({ id });

  if (!messageDetails || !messageDetails.session_id || !messageDetails.timestamp) {
    // eslint-disable-next-line no-console
    console.error('Failed to get message details or session_id/timestamp for deletion.');
    return;
  }

  await deleteMessagesBySessionIdAfterTimestamp({
    sessionId: messageDetails.session_id, // Use session_id from the message
    timestampValue: messageDetails.timestamp, // Use timestamp from the message
  });
}

// The function updateChatVisibility has been removed because it relied on updateChatVisiblityById,
// which was removed due to the 'chat' table no longer existing.
