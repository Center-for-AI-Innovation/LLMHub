import { generateUUID } from '@/lib/utils';
import { type UIMessageStreamWriter, tool } from 'ai';
import { z } from 'zod';
import {
  artifactKinds,
  documentHandlersByArtifactKind,
} from '@/lib/artifacts/server';
import { writeStreamDelta } from '@/lib/ai/ui-data';
import type { AuthSession } from '@/lib/auth/types';

interface CreateDocumentProps {
  session: AuthSession;
  writer: UIMessageStreamWriter;
}

export const createDocument = ({ session, writer }: CreateDocumentProps) =>
  tool({
    description:
      'Create a document for a writing or content creation activities. This tool will call other functions that will generate the contents of the document based on the title and kind.',
    inputSchema: z.object({
      title: z.string(),
      kind: z.enum(artifactKinds),
    }),
    execute: async ({ title, kind }) => {
      const id = generateUUID();

      writeStreamDelta(writer, 'kind', kind);
      writeStreamDelta(writer, 'id', id);
      writeStreamDelta(writer, 'title', title);
      writeStreamDelta(writer, 'clear', '');

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
        writer,
        session,
      });

      writeStreamDelta(writer, 'finish', '');

      return {
        id,
        title,
        kind,
        content: 'A document was created and is now visible to the user.',
      };
    },
  });
