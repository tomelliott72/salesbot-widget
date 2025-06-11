import {
  appendClientMessage,
  createDataStream, // Will still be used for 'data' but not returned yet
} from 'ai';

import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
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
import type { Chat } from '@/lib/db/schema';
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
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const { id, message, selectedChatModel, selectedVisibilityType } =
      requestBody;

    let chatDetails = await getChatById({ id });
    let langflowChatId: string;

    if (!chatDetails) {
      const title = await generateTitleFromUserMessage({
        message,
      });
      // Use the incoming UUID as the langflow_chat_id for new chats for now.
      // And use a placeholder for flow_id.
      const newChatData = {
        id: id, // chat.id (UUID)
        name: title,
        flow_id: "default_flow", // Placeholder
        chat_id: id, // chat.chat_id (varchar), using UUID for now
        is_public: selectedVisibilityType === 'public',
      };
      const savedChat = await saveChat(newChatData);
      // Ensure we use the chat_id from the saved/fetched chat record for subsequent operations
      // saveChat should return the created chat including its chat_id
      if (savedChat && savedChat.chat_id) {
        langflowChatId = savedChat.chat_id;
        chatDetails = savedChat; // So chatDetails is populated for later use if needed
      } else {
        // Fallback or error if saveChat didn't return expected structure or failed silently
        // For now, assume it worked and chat_id is what we set it to.
        langflowChatId = newChatData.chat_id;
        // Potentially re-fetch to be certain: chatDetails = await getChatById({ id });
      }
    } else {
      langflowChatId = chatDetails.chat_id;
    }

    // Ensure langflowChatId is defined before proceeding
    if (!langflowChatId) {
      console.error('Critical: langflowChatId could not be determined.');
      return new ChatSDKError('bad_request:api', 'Failed to determine chat session ID.').toResponse();
    }

    const previousMessages = await getMessagesByChatId({ id: langflowChatId });

    const messages = appendClientMessage({
      // @ts-expect-error: todo add type conversion from DBMessage[] to UIMessage[]
      messages: previousMessages,
      message,
    });

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

    return new Response(rawLangflowStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

  } catch (error) {
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

  let chat: Chat;

  try {
    chat = await getChatById({ id: chatId });
  } catch {
    return new ChatSDKError('not_found:chat').toResponse();
  }

  if (!chat) {
    return new ChatSDKError('not_found:chat').toResponse();
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
    const messages = await getMessagesByChatId({ id: chatId });
    const mostRecentMessage = messages.at(-1);

    if (!mostRecentMessage) {
      return new Response(emptyDataStream, { status: 200 });
    }

    if (mostRecentMessage.sender_type !== 'assistant') {
      return new Response(emptyDataStream, { status: 200 });
    }

    const messageCreatedAt = new Date(mostRecentMessage.created_at);

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

  const chat = await getChatById({ id });

  // Optional: Add a check here if you want to prevent deletion of non-existent chats
  // if (!chat) {
  //   return new ChatSDKError('not_found:chat').toResponse();
  // }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
