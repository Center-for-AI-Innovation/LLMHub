import type { FileUIPart } from 'ai';

export type UploadedAttachment = {
  url: string;
  name?: string;
  contentType: string;
};

export function toFileUIPart(attachment: UploadedAttachment): FileUIPart {
  return {
    type: 'file',
    url: attachment.url,
    filename: attachment.name,
    mediaType: attachment.contentType,
  };
}

