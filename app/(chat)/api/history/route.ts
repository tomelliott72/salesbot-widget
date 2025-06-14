import type { NextRequest } from 'next/server';
// import { getChats } from '@/lib/db/queries'; // Removed as getChats is no longer available
import { ChatSDKError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Number.parseInt(searchParams.get('limit') || '10');
  const startingAfter = searchParams.get('starting_after');
  const endingBefore = searchParams.get('ending_before');

  if (startingAfter && endingBefore) {
    return new ChatSDKError(
      'bad_request:api',
      'Only one of starting_after or ending_before can be provided.',
    ).toResponse();
  }

  // const chats = await getChats({
  //   limit,
  //   startingAfter,
  //   endingBefore,
  // }); // Commented out as getChats is removed.

  // Return empty chat history structure as functionality needs reimplementation.
  return Response.json({ chats: [], hasMore: false });
}
