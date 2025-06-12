
// appendClientMessage and createDataStream imports removed for diagnostics

import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  saveMessages,
  getMessagesBySessionId, // Replaced getMessagesByChatId
  // deleteChatById, getChatById, saveChat were removed as they relied on the non-existent 'chat' table
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
// import { StreamingTextResponse } from 'ai'; // Explicitly commented out for build diagnosis
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
// import type { Chat } from '@/lib/db/schema'; // Chat type removed as schema is gone
import { differenceInSeconds } from 'date-fns';
import { ChatSDKError } from '@/lib/errors';
import { LangflowClient } from '@datastax/langflow-client';

export const maxDuration = 60;

// Type definitions for Langflow 'end' event data structure
interface LangflowEndEventMessageDetail {
  message?: string; // The actual text message
  type?: string;
}

interface LangflowEndEventFinalOutput {
  message?: LangflowEndEventMessageDetail;
}

interface LangflowEndEventInnerOutput {
  results?: any; // Keeping these less specific for brevity
  artifacts?: any;
  outputs?: LangflowEndEventFinalOutput; // This contains the message we need
  logs?: any;
  messages?: any[];
}

interface LangflowEndEventOuterOutput {
  inputs?: any;
  outputs?: LangflowEndEventInnerOutput[];
}

interface LangflowEndEventResult {
  session_id?: string;
  outputs?: LangflowEndEventOuterOutput[];
}

interface LangflowEndEventData {
  result?: LangflowEndEventResult;
}

// Type definition for Langflow 'add_message' event data structure
interface LangflowAddMessageEventData {
  timestamp?: string;
  sender?: string; // "User" or "Machine"
  sender_name?: string; // "User" or "AI"
  session_id?: string;
  text?: string; // The message content
  // other properties can be added if needed e.g., files, error, category etc.
}

// Initialize Langflow Client using environment variables
const LANGFLOW_BASE_URL = process.env.LANGFLOW_BASE_URL;
const LANGFLOW_FLOW_ID = process.env.LANGFLOW_FLOW_ID;
// const LANGFLOW_API_KEY = process.env.LANGFLOW_API_KEY; // Optional: uncomment if you use an API key

if (!LANGFLOW_BASE_URL) {
  const errorMsg = 'CRITICAL ERROR: LANGFLOW_BASE_URL environment variable is not set. Please ensure it is defined in your .env.local or server environment.';
  console.error(errorMsg);
  throw new Error(errorMsg);
}
if (!LANGFLOW_FLOW_ID) {
  const errorMsg = 'CRITICAL ERROR: LANGFLOW_FLOW_ID environment variable is not set. Please ensure it is defined in your .env.local or server environment.';
  console.error(errorMsg);
  throw new Error(errorMsg);
}
console.log(`[Langflow Client Init] LANGFLOW_BASE_URL: ${LANGFLOW_BASE_URL}`);
console.log(`[Langflow Client Init] LANGFLOW_FLOW_ID: ${LANGFLOW_FLOW_ID}`);

const client = new LangflowClient({
  baseUrl: LANGFLOW_BASE_URL,
  // apiKey: LANGFLOW_API_KEY, // Optional: uncomment if you use an API key
});


let globalStreamContext: ResumableStreamContext | null = null;

function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
    console.log('[API /api/chat POST] Request body received:', JSON.stringify(requestBody, null, 2));
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const { id, message, selectedChatModel, selectedVisibilityType } =
      requestBody;

    // The 'id' from requestBody is now treated as the session_id.
    // Logic for getChatById, saveChat, and title generation is removed as 'chat' table doesn't exist.
    const sessionId = id; // id from requestBody is the session_id
    let langflowChatId: string = sessionId;

    // Ensure langflowChatId (sessionId) is defined before proceeding
    if (!langflowChatId) {
      console.error('Critical: sessionId (langflowChatId) could not be determined from request.');
      return new ChatSDKError('bad_request:api', 'Failed to determine chat session ID.').toResponse();
    }

    const previousMessages = await getMessagesBySessionId({ sessionId: langflowChatId });

    // const messages = appendClientMessage({ // Commented out for diagnostics
      // @ts-expect-error: todo add type conversion from DBMessage[] to UIMessage[]
    //   messages: previousMessages,
    //   message,
    // });
    const messages = previousMessages; // Placeholder for diagnostics

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    // User message will be saved by Langflow
    const userMessageText = message.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');

    if (!userMessageText) {
      console.error('[API /api/chat POST] User message text is empty after filtering parts.');
      return new ChatSDKError('bad_request:api', 'Empty message received.').toResponse();
    }

    console.log(`[API /api/chat POST] Attempting to stream from Langflow. Flow ID: ${LANGFLOW_FLOW_ID}, Session ID: ${langflowChatId}, Input: "${userMessageText.substring(0, 100)}..."`);

    try {
      const langflowEventStream = await client
        .flow(LANGFLOW_FLOW_ID!) // LANGFLOW_FLOW_ID is checked at module load to be non-null
        .stream(userMessageText, { session_id: langflowChatId });

      console.log('[API /api/chat POST] Successfully initiated Langflow stream object.');

      const readableStream = new ReadableStream({
        async start(controller) {
          const textEncoder = new TextEncoder();
          const reader = langflowEventStream.getReader();
          console.log('[API /api/chat POST] ReadableStream started for Langflow events. Reader obtained.');
          try {
            while (true) {
              // console.log('[API /api/chat POST] Calling reader.read()...'); // Very verbose
              const { done, value: event } = await reader.read();
              // console.log(`[API /api/chat POST] reader.read() returned: done=${done}`, event ? `event type=${event.event}`: ''); // Very verbose

              if (done) {
                console.log('[API /api/chat POST] Langflow stream processing finished (reader indicated done).');
                break;
              }

              // console.log('[API /api/chat POST] Raw Langflow event:', JSON.stringify(event)); // Very verbose, log if other logs aren't enough

              if (event.event === 'token' && event.data && typeof event.data.chunk === 'string') {
                // console.log('[API /api/chat POST] Received token chunk:', event.data.chunk); // Verbose, uncomment if needed for char-by-char debugging
                controller.enqueue(textEncoder.encode(`0:${JSON.stringify(event.data.chunk)}\n`));
              } else if (event.event === 'end') {
                console.log('[API /api/chat POST] Langflow stream \'end\' event. Full response data:', JSON.stringify(event.data));
                // Cast event.data to our defined type for 'end' events
                const endEventData = event.data as LangflowEndEventData;
                // Attempt to extract the full message from the 'end' event
                const messageText = endEventData?.result?.outputs?.[0]?.outputs?.[0]?.outputs?.message?.message;
                if (typeof messageText === 'string' && messageText.length > 0) {
                  console.log('[API /api/chat POST] Enqueuing full message from \'end\' event:', messageText);
                  controller.enqueue(textEncoder.encode(`0:${JSON.stringify(messageText)}\n`));
                } else {
                  console.log('[API /api/chat POST] No message text found in \'end\' event or messageText was empty.');
                }
                // The loop will break on next read if 'done' is true, or controller will be closed in finally.
              } else if (event.event === 'add_message') {
                console.log('[API /api/chat POST] Langflow \'add_message\' event:', JSON.stringify(event.data));
                const addEventData = event.data as LangflowAddMessageEventData;
                if (addEventData.sender === 'Machine' && typeof addEventData.text === 'string' && addEventData.text.length > 0) {
                  console.log('[API /api/chat POST] Enqueuing text from AI \'add_message\' event:', addEventData.text);
                  controller.enqueue(textEncoder.encode(`0:${JSON.stringify(addEventData.text)}\n`));
                }
              } else {
                // console.log('[API /api/chat POST] Received other/unknown Langflow event:', JSON.stringify(event));
              }
            }
          } catch (streamError) {
            console.error('[API /api/chat POST] Error during Langflow stream processing loop:', streamError);
            controller.error(streamError); // Propagate error to the client response stream
          } finally {
            console.log('[API /api/chat POST] Closing ReadableStream controller (finally block).');
            controller.close();
          }
        },
        cancel(reason) {
          console.log('[API /api/chat POST] ReadableStream cancelled by consumer. Reason:', reason);
          // langflow-client's stream might not be directly cancellable via its reader.
          // If the underlying fetch supports AbortController, client would need to expose that.
        }
      });

      console.log('[API /api/chat POST] Returning new Response with ReadableStream.');
      return new Response(readableStream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });

    } catch (clientError) {
      console.error('[API /api/chat POST] Error initializing or calling Langflow client .stream() method:', clientError);
      // Ensure clientError is an Error instance for consistent logging/handling if needed
      const errorMessage = clientError instanceof Error ? clientError.message : String(clientError);
      return new ChatSDKError('bad_request:api', `Failed to connect to Langflow service: ${errorMessage}`).toResponse();
    }

  } catch (error) {
    console.error('[API /api/chat POST] Error in POST handler:', error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
  }
}

export async function GET(request: Request) {
  const streamContext = getStreamContext();
  const resumeRequestedAt = new Date();

  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  // let chat: Chat; // Chat type and getChatById removed.
  // The concept of fetching a 'chat' entity by id is removed.
  // Stream resumption logic below is mostly disabled and will rely on sessionId (chatId from URL).
  const sessionId = chatId; // chatId from URL is the sessionId

  if (!sessionId) {
    return new ChatSDKError('bad_request:api', 'Session ID (chatId) is required.').toResponse();
  }


  // const streamIds = await getStreamIdsByChatId({ chatId }); // getStreamIdsByChatId removed

  // if (!streamIds.length) {
  //   return new ChatSDKError('not_found:stream').toResponse();
  // }

  // const recentStreamId = streamIds.at(-1);
  const recentStreamId = null; // Placeholder as streamIds logic is removed

  if (!recentStreamId) { // This will now always be true, effectively disabling stream resumption here
    return new ChatSDKError('not_found:stream', 'Stream resumption is temporarily unavailable.').toResponse();
  }

  const emptyDataStream = createDataStream({
    execute: () => {},
  });

  const stream = await streamContext.resumableStream(
    recentStreamId,
    () => emptyDataStream,
  );

  /*
   * For when the generation is streaming during SSR
   * but the resumable stream has concluded at this point.
   */
  if (!stream) {
    const messages = await getMessagesBySessionId({ sessionId: chatId }); // Use sessionId
    const mostRecentMessage = messages.at(-1);

    if (!mostRecentMessage) {
      return new Response(emptyDataStream, { status: 200 });
    }

    if (mostRecentMessage.sender !== 'assistant') { // Corrected sender_type to sender
      return new Response(emptyDataStream, { status: 200 });
    }

    const messageCreatedAt = new Date(mostRecentMessage.timestamp); // Corrected created_at to timestamp

    if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) > 15) {
      return new Response(emptyDataStream, { status: 200 });
    }

    const restoredStream = createDataStream({
      execute: (buffer) => {
        buffer.writeData({
          type: 'append-message',
          message: JSON.stringify(mostRecentMessage),
        });
      },
    });

    return new Response(restoredStream, { status: 200 });
  }

  return new Response(stream, { status: 200 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  // const chat = await getChatById({ id }); // getChatById removed
  // const deletedChat = await deleteChatById({ id }); // deleteChatById removed

  // Deletion of all messages for a session (id from URL is sessionId) is not yet implemented.
  // Returning a success response as a no-op for now to fix build.
  // Proper implementation would use something like deleteMessagesBySessionId(sessionId).
  console.log(`DELETE request for session ${id} - no operation performed.`);
  return Response.json({ message: `Chat deletion for session ${id} not fully implemented. No messages deleted.` }, { status: 200 });
}
