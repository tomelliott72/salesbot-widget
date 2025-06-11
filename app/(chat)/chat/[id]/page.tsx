import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';


import { Chat } from '@/components/chat';
import { getMessagesBySessionId } from '@/lib/db/queries';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import type { DBMessage } from '@/lib/db/schema';
import type { Attachment, UIMessage } from 'ai';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: sessionId } = params; // Renaming id to sessionId for clarity

  // The chat object is no longer fetched as the 'chat' table does not exist.
  // params.id (now sessionId) is the identifier for the chat session.

  const messagesFromDb = await getMessagesBySessionId({
    sessionId,
  });

  function convertToUIMessages(dbMessages: Array<DBMessage>): Array<UIMessage> {
    return dbMessages.map((dbMsg) => {
      // Determine role based on sender_name or sender
      let role: UIMessage['role'] = 'user'; // Default to user
      if (dbMsg.sender_name?.toLowerCase() === 'bot' || dbMsg.sender?.toLowerCase() === 'bot') {
        role = 'assistant';
      } else if (dbMsg.sender_name?.toLowerCase() === 'user' || dbMsg.sender?.toLowerCase() === 'user') {
        role = 'user';
      }
      // Langflow 'files' are likely URLs or structured data, map to attachments if possible
      // This is a basic attempt, might need refinement based on actual 'files' content
      let attachments: Attachment[] | undefined = undefined;
      if (dbMsg.files && typeof dbMsg.files === 'string') { // Assuming files might be a JSON string of URLs
        try {
          const parsedFiles = JSON.parse(dbMsg.files as string);
          if (Array.isArray(parsedFiles)) {
            attachments = parsedFiles.map((fileUrl: any) => ({
              contentType: 'application/octet-stream', // Or determine from URL/type
              name: typeof fileUrl === 'string' ? fileUrl.substring(fileUrl.lastIndexOf('/') + 1) : 'file',
              url: typeof fileUrl === 'string' ? fileUrl : '',
            }));
          }
        } catch (e) {
          // console.warn('Failed to parse message.files JSON:', e);
        }
      } else if (dbMsg.files && Array.isArray(dbMsg.files)) { // If files is already an array of objects
         attachments = (dbMsg.files as any[]).map(fileObj => ({
            contentType: fileObj.contentType || 'application/octet-stream',
            name: fileObj.name || 'file',
            url: fileObj.url || '',
         }));
      }

      return {
        id: dbMsg.id,
        content: dbMsg.text ?? '', // Add content property
        parts: [{ type: 'text', text: dbMsg.text ?? '' }],
        role: role,
        createdAt: dbMsg.timestamp, // timestamp from new schema
        experimental_attachments: attachments,
        // data: dbMsg.properties, // Optionally map 'properties' to 'data' if needed
      };
    });
  }

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get('chat-model');

  if (!chatModelFromCookie) {
    return (
      <>
        <Chat
          id={sessionId} // Use sessionId (formerly params.id) as the chat identifier
          initialMessages={convertToUIMessages(messagesFromDb)}
          initialChatModel={DEFAULT_CHAT_MODEL}
          initialVisibilityType={'private'} // Defaulting as chat.is_public is no longer available
          isReadonly={false}
          autoResume={true}
        />
        <DataStreamHandler id={sessionId} />
      </>
    );
  }



  return (
    <>
      <Chat
        id={sessionId} // Use sessionId (formerly params.id) as the chat identifier
        initialMessages={convertToUIMessages(messagesFromDb)}
        initialChatModel={chatModelFromCookie.value}
        initialVisibilityType={'private'} // Defaulting as chat.is_public is no longer available
        isReadonly={false}
        autoResume={true}
      />
      <DataStreamHandler id={sessionId} />
    </>
  );
}
