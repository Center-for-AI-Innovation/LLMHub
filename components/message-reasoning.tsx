'use client';

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';

interface MessageReasoningProps {
  isStreaming: boolean;
  reasoning: string;
}

export function MessageReasoning({
  isStreaming,
  reasoning,
}: MessageReasoningProps) {
  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger />

      <ReasoningContent>{reasoning}</ReasoningContent>
    </Reasoning>
  );
}
