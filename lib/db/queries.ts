import 'server-only';

import { genSaltSync, hashSync } from 'bcrypt-ts';
import { and, asc, desc, eq, gt, gte, inArray, or, ilike } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  user,
  chat,
  type User,
  document,
  type Suggestion,
  suggestion,
  type Message,
  message,
  vote,
  availableModel,
  vllmChatJob,
  type VllmChatJob,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    console.error('Failed to get user from database');
    throw error;
  }
}

export async function getUserById(id: string): Promise<User | null> {
  try {
    const [selectedUser] = await db.select().from(user).where(eq(user.id, id));
    return selectedUser || null;
  } catch (error) {
    console.error('Failed to get user by id from database');
    throw error;
  }
}

export async function createUser(email: string, password: string) {
  const salt = genSaltSync(10);
  const hash = hashSync(password, salt);

  try {
    return await db.insert(user).values({ email, password: hash });
  } catch (error) {
    console.error('Failed to create user in database');
    throw error;
  }
}

export async function saveChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
    });
  } catch (error) {
    console.error('Failed to save chat in database');
    throw error;
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    
    // Also delete vLLM job associations
    try {
      await db.delete(vllmChatJob).where(eq(vllmChatJob.chatId, id));
    } catch {
      // Ignore if table doesn't exist
    }

    return await db.delete(chat).where(eq(chat.id, id));
  } catch (error) {
    console.error('Failed to delete chat by id from database');
    throw error;
  }
}

export async function getChatsByUserId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(chat)
      .where(eq(chat.userId, id))
      .orderBy(desc(chat.createdAt));
  } catch (error) {
    console.error('Failed to get chats by user from database');
    throw error;
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    return selectedChat;
  } catch (error) {
    console.error('Failed to get chat by id from database');
    throw error;
  }
}

export async function saveMessages({ messages }: { messages: Array<Message> }) {
  try {
    console.log('messages', messages);
    return await db.insert(message).values(messages);
  } catch (error) {
    console.error('Failed to save messages in database', error);
    throw error;
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    console.error('Failed to get messages by chat id from database', error);
    throw error;
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: 'up' | 'down';
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up',
    });
  } catch (error) {
    console.error('Failed to upvote message in database', error);
    throw error;
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    console.error('Failed to get votes by chat id from database', error);
    throw error;
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db.insert(document).values({
      id,
      title,
      kind,
      content,
      userId,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('Failed to save document in database');
    throw error;
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    console.error('Failed to get document by id from database');
    throw error;
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    console.error('Failed to get document by id from database');
    throw error;
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)));
  } catch (error) {
    console.error(
      'Failed to delete documents by id after timestamp from database',
    );
    throw error;
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    console.error('Failed to save suggestions in database');
    throw error;
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    console.error(
      'Failed to get suggestions by document version from database',
    );
    throw error;
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    console.error('Failed to get message by id from database');
    throw error;
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    console.error(
      'Failed to delete messages by id after timestamp from database',
    );
    throw error;
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    console.error('Failed to update chat visibility in database');
    throw error;
  }
}

// Available Models
export async function getAvailableModels() {
  return await db.select().from(availableModel).orderBy(availableModel.family, availableModel.variant);
}

export async function getAvailableModelById({ id }: { id: string }) {
  return await db
    .select()
    .from(availableModel)
    .where(eq(availableModel.id, id))
    .limit(1);
}

export async function searchAvailableModels({ query }: { query: string }) {
  return await db
    .select()
    .from(availableModel)
    .where(
      or(
        ilike(availableModel.name, `%${query}%`),
        ilike(availableModel.family, `%${query}%`),
        ilike(availableModel.variant, `%${query}%`),
        ilike(availableModel.description, `%${query}%`)
      )
    )
    .orderBy(availableModel.family, availableModel.variant);
}

export async function getChatWithMessages({ id }: { id: string }) {
  try {
    const chatData = await getChatById({ id });
    const messagesData = await getMessagesByChatId({ id });
    const votesData = await getVotesByChatId({ id });
    
    // Get all unique document IDs referenced in messages
    const documentIds = [...new Set(
      messagesData
        .filter(msg => typeof msg.content === 'string' && msg.content.includes('documentId'))
        .map(msg => {
          try {
            // Try to extract documentId from the message content
            const content = msg.content as string;
            const match = content.match(/"documentId":\s*"([^"]+)"/);
            return match ? match[1] : null;
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean) as string[]
    )];
    
    // Fetch documents if there are any unique IDs
    const documentsData = documentIds.length > 0 
      ? await Promise.all(documentIds.map(docId => getDocumentsById({ id: docId })))
      : [];
    
    // Flatten the array of document arrays
    const flattenedDocuments = documentsData.flat();
    
    return {
      chat: chatData,
      messages: messagesData,
      votes: votesData,
      documents: flattenedDocuments
    };
  } catch (error) {
    console.error('Failed to get chat with messages from database', error);
    throw error;
  }
}

// ==========================================
// vLLM Chat Job Queries
// ==========================================

/**
 * Build the proxy URL for a vLLM job
 */
export function buildProxyUrl(slurmJobId: string): string {
  return `/api/v1/job/${slurmJobId}/chat/completions`;
}

/**
 * Save a vLLM chat job association
 */
export async function saveVllmChatJob({
  chatId,
  userId,
  slurmJobId,
  modelName,
  endpointUrl,
  proxyUrl,
}: {
  chatId: string;
  userId: string;
  slurmJobId: string;
  modelName?: string;
  endpointUrl?: string;
  proxyUrl?: string;
}): Promise<void> {
  try {
    // Auto-generate proxy URL if not provided
    const finalProxyUrl = proxyUrl || buildProxyUrl(slurmJobId);
    
    await db.insert(vllmChatJob).values({
      chatId,
      userId,
      slurmJobId,
      modelName: modelName || null,
      endpointUrl: endpointUrl || null,
      proxyUrl: finalProxyUrl,
      status: 'active',
    });
  } catch (error) {
    console.error('Failed to save vLLM chat job in database', error);
    throw error;
  }
}

/**
 * Get vLLM job by chat ID
 */
export async function getVllmJobByChatId({ 
  chatId 
}: { 
  chatId: string 
}): Promise<VllmChatJob | null> {
  try {
    const [job] = await db
      .select()
      .from(vllmChatJob)
      .where(eq(vllmChatJob.chatId, chatId))
      .orderBy(desc(vllmChatJob.createdAt))
      .limit(1);
    return job || null;
  } catch (error) {
    console.error('Failed to get vLLM job by chat ID from database', error);
    throw error;
  }
}

/**
 * Get active vLLM job for a user
 * Returns the most recent active job for a user
 */
export async function getActiveVllmJobByUserId({ 
  userId 
}: { 
  userId: string 
}): Promise<VllmChatJob | null> {
  try {
    const [job] = await db
      .select()
      .from(vllmChatJob)
      .where(
        and(
          eq(vllmChatJob.userId, userId),
          eq(vllmChatJob.status, 'active')
        )
      )
      .orderBy(desc(vllmChatJob.createdAt))
      .limit(1);
    return job || null;
  } catch (error) {
    console.error('Failed to get active vLLM job by user ID from database', error);
    throw error;
  }
}

/**
 * Get vLLM job by Slurm job ID
 */
export async function getVllmJobByJobId({ 
  slurmJobId 
}: { 
  slurmJobId: string 
}): Promise<VllmChatJob | null> {
  try {
    const [job] = await db
      .select()
      .from(vllmChatJob)
      .where(eq(vllmChatJob.slurmJobId, slurmJobId))
      .limit(1);
    return job || null;
  } catch (error) {
    console.error('Failed to get vLLM job by Slurm job ID from database', error);
    throw error;
  }
}

/**
 * Update vLLM job status
 */
export async function updateVllmJobStatus({
  chatId,
  status,
}: {
  chatId: string;
  status: 'active' | 'inactive' | 'failed';
}): Promise<void> {
  try {
    await db
      .update(vllmChatJob)
      .set({ 
        status, 
        updatedAt: new Date() 
      })
      .where(eq(vllmChatJob.chatId, chatId));
  } catch (error) {
    console.error('Failed to update vLLM job status in database', error);
    throw error;
  }
}

/**
 * Delete vLLM job by chat ID
 */
export async function deleteVllmJobByChatId({ 
  chatId 
}: { 
  chatId: string 
}): Promise<void> {
  try {
    await db.delete(vllmChatJob).where(eq(vllmChatJob.chatId, chatId));
  } catch (error) {
    console.error('Failed to delete vLLM job by chat ID from database', error);
    throw error;
  }
}

/**
 * Get all vLLM jobs for a user
 */
export async function getVllmJobsByUserId({ 
  userId 
}: { 
  userId: string 
}): Promise<VllmChatJob[]> {
  try {
    return await db
      .select()
      .from(vllmChatJob)
      .where(eq(vllmChatJob.userId, userId))
      .orderBy(desc(vllmChatJob.createdAt));
  } catch (error) {
    console.error('Failed to get vLLM jobs by user ID from database', error);
    throw error;
  }
}
