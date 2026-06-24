import { myProvider } from '@/lib/ai/models';
import { createDocumentHandler } from '@/lib/artifacts/server';
import { experimental_generateImage } from 'ai';
import { writeStreamDelta } from '@/lib/ai/ui-data';

export const imageDocumentHandler = createDocumentHandler<'image'>({
  kind: 'image',
  onCreateDocument: async ({ title, writer }) => {
    let draftContent = '';

    const { image } = await experimental_generateImage({
      model: myProvider.imageModel('small-model'),
      prompt: title,
      n: 1,
    });

    draftContent = image.base64;

    writeStreamDelta(writer, 'image-delta', image.base64);

    return draftContent;
  },
  onUpdateDocument: async ({ description, writer }) => {
    let draftContent = '';

    const { image } = await experimental_generateImage({
      model: myProvider.imageModel('small-model'),
      prompt: description,
      n: 1,
    });

    draftContent = image.base64;

    writeStreamDelta(writer, 'image-delta', image.base64);

    return draftContent;
  },
});
