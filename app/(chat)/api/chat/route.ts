
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

export const maxDuration = 60;

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

    const langflowApiUrl = 'https://sailsbot-dev.up.railway.app/api/v1/run/ff5c9c02-cb4a-4561-b35d-90fce606ee1f'; // TODO: Make this configurable. Consider if flow_id from chatDetails should be part of the URL.
    const langflowPayload = {
      input_value: userMessageText,
      output_type: "chat",
      input_type: "chat",
      session_id: langflowChatId, // This is chatDetails.chat_id
    };

    console.log('[API /api/chat POST] Calling Langflow URL:', langflowApiUrl);
    console.log('[API /api/chat POST] Langflow payload:', JSON.stringify(langflowPayload, null, 2));
    const langflowResponse = await fetch(langflowApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(langflowPayload),
    });

    if (!langflowResponse.ok) {
      const errorText = await langflowResponse.text();
      console.error(`Langflow API error: ${langflowResponse.status} ${errorText}`);
      return new ChatSDKError('bad_request:api', `Langflow API Error: ${langflowResponse.status} - ${errorText}`).toResponse();
    }

    if (!langflowResponse.body) {
      console.error('Langflow response body is null');
      return new ChatSDKError('bad_request:api', 'Langflow response body is null').toResponse();
    }

    console.log('[API /api/chat POST] Langflow response status:', langflowResponse.status, langflowResponse.statusText);
    if (!langflowResponse.ok) {
      const errorBody = await langflowResponse.text();
      console.error('[API /api/chat POST] Langflow error response body:', errorBody);
      // Potentially return an error response to the client here if Langflow fails
      return new ChatSDKError('bad_request:api', `Langflow service error: ${langflowResponse.status} - ${errorBody}`).toResponse(); // Changed to valid error code
    }
    const rawLangflowStream = langflowResponse.body;



    // The rawLangflowStream is the direct ReadableStream from Langflow's response body.
    // We don't need to manually format it to AI SDK's 0:"chunk" format if using streamToResponse correctly.

    // For now, to simplify and test basic streaming, we'll return a direct Response.
    // The DataStream 'data' creation is commented out to isolate the writer.close() lint error.
    // We will revisit integrating it once basic text streaming from Langflow is confirmed.
    /*
    const _data = createDataStream({
      execute: async (writer) => {
        try {
          // Auxiliary data would be appended here if needed.
        } catch (e) {
          console.error("Error in data stream execute:", e);
        } finally {
          // writer.close(); // Commented out due to persistent lint error
        }
      },
      onError: (error) => {
        console.error("Error in createDataStream's onError callback:", error);
        return 'An error occurred while processing auxiliary data.';
      }
    });
    */

    // Langflow sends a single JSON object, not a stream of text chunks.
    // We need to parse this JSON and extract the actual message.
    const langflowJsonText = await langflowResponse.text();
    console.log('[API /api/chat POST] Langflow full response text:', langflowJsonText);

    try {
      const langflowData = JSON.parse(langflowJsonText);
      const messageText = langflowData?.outputs?.[0]?.outputs?.[0]?.results?.message?.text;

      if (typeof messageText === 'string') {
        // Create a new stream with just the message text for the client
        const clientStream = new ReadableStream({
          start(controller) {
            const streamData = `0:${JSON.stringify(messageText)}\n`;
            controller.enqueue(new TextEncoder().encode(streamData));
            controller.close();
          },
        });
        return new Response(clientStream, { // Send the new simple text stream
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      } else {
        console.error('[API /api/chat POST] Could not extract messageText from Langflow response:', langflowData);
        return new Response('Error: Could not extract message from Langflow response.', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    } catch (parseError) {
      console.error('[API /api/chat POST] Failed to parse Langflow JSON response:', parseError, langflowJsonText);
      return new Response('Error: Failed to parse Langflow response.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Fallback if somehow the above logic doesn't return (should not happen)
    return new Response(rawLangflowStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

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
