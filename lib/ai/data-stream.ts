import type { Suggestion } from '@/lib/db/schema';
import type { StreamDeltaType } from '@/lib/ai/ui-data';

export type DataStreamDelta = {
  type: StreamDeltaType;
  content: string | Suggestion;
};

