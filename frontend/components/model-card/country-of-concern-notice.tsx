'use client';

import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ModelInfo } from '@/hooks/use-models';

/** Notice shown on model cards for models trained in a US government designated Country of Concern. */
export const COUNTRY_OF_CONCERN_PARAGRAPHS = [
  'This model was trained in a US government designated Country of Concern. It may exhibit biases based on differences in geopolitical environments, cultural norms, policy constraints, or censorship behaviors.',
] as const;

/** Extra paragraph shown only for DeepSeek models, about the DHS removal directive. */
export const DEEPSEEK_DIRECTIVE_PARAGRAPH =
  'Be aware that on October 19, 2026 Homeland Security issued a directive ordering federal civilian agencies to remove DeepSeek from their systems. We are seeking guidance from the university on the implications of this for us. We are not yet removing DeepSeek, but that could end up happening with little to no advanced notice.';

/** UI System guidance on AI models from designated Countries of Concern. */
export const COUNTRY_OF_CONCERN_LINK =
  'https://ai.uillinois.edu/userfiles/public/ui_system_ai_guidance_countries_of_concern.pdf';

const LINKED_PHRASE = 'Country of Concern';

/**
 * Renders a notice paragraph, linking the "Country of Concern" phrase to the
 * UI System guidance PDF. Returns plain text when the phrase is absent.
 */
function linkCountryOfConcernPhrase(paragraph: string): ReactNode {
  const index = paragraph.indexOf(LINKED_PHRASE);
  if (index === -1) {
    return paragraph;
  }
  return (
    <>
      {paragraph.slice(0, index)}
      <a
        href={COUNTRY_OF_CONCERN_LINK}
        target="_blank"
        rel="noreferrer"
        className="text-status-info hover:underline"
      >
        {LINKED_PHRASE}
      </a>
      {paragraph.slice(index + LINKED_PHRASE.length)}
    </>
  );
}

/**
 * Keywords identifying models from organizations based in a US government
 * designated Country of Concern. Matched against the model family, id,
 * name, and Hugging Face id.
 */
const COUNTRY_OF_CONCERN_KEYWORDS = [
  'deepseek', // DeepSeek
  'qwen', // Alibaba Qwen
  'qwq', // Alibaba QwQ (Qwen reasoning)
  'glm', // Zhipu AI / THUDM GLM
  'thudm', // Zhipu AI / THUDM (HF org)
  'internvl', // OpenGVLab InternVL
  'opengvlab', // OpenGVLab (HF org)
] as const;

function modelIdentifiers(model: ModelInfo): string {
  return [model.family, model.id, model.modelName, model.huggingfaceId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * True for models from organizations based in a US government designated
 * Country of Concern.
 */
export function isCountryOfConcernModel(model: ModelInfo): boolean {
  const identifiers = modelIdentifiers(model);
  return COUNTRY_OF_CONCERN_KEYWORDS.some((keyword) =>
    identifiers.includes(keyword),
  );
}

/**
 * Small-font caution notice rendered on model cards for Country of Concern
 * models. Renders nothing for other models. DeepSeek models additionally
 * show the DHS removal-directive paragraph.
 */
export function CountryOfConcernNotice({ model }: { model: ModelInfo }) {
  if (!isCountryOfConcernModel(model)) return null;

  const paragraphs = modelIdentifiers(model).includes('deepseek')
    ? [...COUNTRY_OF_CONCERN_PARAGRAPHS, DEEPSEEK_DIRECTIVE_PARAGRAPH]
    : COUNTRY_OF_CONCERN_PARAGRAPHS;

  return (
    <aside
      aria-label="Country of Concern notice"
      className="mb-4 flex items-start gap-2 rounded-lg border border-status-neutral/30 bg-status-neutral/10 px-3 py-2"
    >
      <TriangleAlert
        className="mt-px size-3.5 shrink-0 text-status-neutral"
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-1 text-xs leading-snug text-muted-foreground">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{linkCountryOfConcernPhrase(paragraph)}</p>
        ))}
      </div>
    </aside>
  );
}
