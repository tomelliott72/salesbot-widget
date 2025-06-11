import { generateUUID } from '@/lib/utils';
import { DataStreamWriter, tool } from 'ai';
import { z } from 'zod';
import { LangflowClient } from '@datastax/langflow-client';

import {
  artifactKinds,
  documentHandlersByArtifactKind,
} from '@/lib/artifacts/server';

interface CreateDocumentProps {
  dataStream: DataStreamWriter;
}

const LANGFLOW_BASE_URL = process.env.LANGFLOW_BASE_URL;
const LANGFLOW_FLOW_ID = process.env.LANGFLOW_FLOW_ID;

if (!LANGFLOW_BASE_URL || !LANGFLOW_FLOW_ID) {
  throw new Error(
    'Langflow base URL or Flow ID is not set in environment variables. Please check your .env.local file.',
  );
}

const client = new LangflowClient({
  baseUrl: LANGFLOW_BASE_URL,
  // If your Langflow instance requires an API key, add it here:
  // apiKey: process.env.LANGFLOW_API_KEY,
});
const flow = client.flow(LANGFLOW_FLOW_ID);

export const createDocument = ({ dataStream }: CreateDocumentProps) =>
  tool({
    description:
      'Create a document for a writing or content creation activities. This tool will call other functions that will generate the contents of the document based on the title and kind.',
    parameters: z.object({
      title: z.string(),
      kind: z.enum(artifactKinds),
    }),
    execute: async ({ title, kind }) => {
      const id = generateUUID();

      dataStream.writeData({
        type: 'kind',
        content: kind,
      });

      dataStream.writeData({
        type: 'id',
        content: id,
      });

      dataStream.writeData({
        type: 'title',
        content: title,
      });

      dataStream.writeData({
        type: 'clear',
        content: '',
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === kind,
      );

      if (!documentHandler) {
        throw new Error(`No document handler found for kind: ${kind}`);
      }

      await documentHandler.onCreateDocument({
        id,
        title,
        dataStream,
      });

      dataStream.writeData({ type: 'finish', content: '' });

      return {
        id,
        title,
        kind,
        content: 'A document was created and is now visible to the user.',
      };
    },
  });
