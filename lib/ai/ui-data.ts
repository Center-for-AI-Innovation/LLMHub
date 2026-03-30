import type { UIMessageStreamWriter } from 'ai';
import crypto from 'node:crypto';

export type StreamDeltaType =
  | 'text-delta'
  | 'code-delta'
  | 'sheet-delta'
  | 'image-delta'
  | 'title'
  | 'id'
  | 'suggestion'
  | 'clear'
  | 'finish'
  | 'kind';

export function writeStreamDelta(
  writer: UIMessageStreamWriter,
  type: StreamDeltaType,
  data: unknown,
) {
  writer.write({
    type: `data-${type}`,
    id: crypto.randomUUID(),
    data,
  });
}

