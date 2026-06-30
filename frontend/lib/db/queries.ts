import 'server-only';

import { and, asc, desc, eq, gt, gte, inArray, or, ilike, sql } from 'drizzle-orm';
import { db } from '@/lib/db';

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
  modelDeployment,
  type ModelDeployment,
  authorizedUsers,
  type AuthorizedUsers,
  pendingDeploymentInvite,
  type PendingDeploymentInvite,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';

// User Utility Functions
// ==========================================
export async function getUserByEmail(email: string): Promise<User | null> {
  try {
    const [selectedUser] = await db.select().from(user).where(eq(user.email, email));
    return selectedUser ?? null;
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

// Update the user's API key in the database
export async function updateUserApiKey({
  userId,
  apiKeyHash,
  apiKeyExpiresAt,
}: {
  userId: string;
  apiKeyHash: string;
  apiKeyExpiresAt: Date;
}) {
  try {
    return await db
      .update(user)
      .set({ apiKeyHash, apiKeyExpiresAt })
      .where(eq(user.id, userId));
  } catch (error) {
    console.error('Failed to update user API key in database');
    throw error;
  }
}

// Get the user's API key metadata from the database
export async function getUserApiKeyMetadata(userId: string) {
  try {
    const [selectedUser] = await db
      .select({
        apiKeyHash: user.apiKeyHash,
        apiKeyExpiresAt: user.apiKeyExpiresAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    return {
      hasApiKey: Boolean(selectedUser?.apiKeyHash),
      apiKeyExpiresAt: selectedUser?.apiKeyExpiresAt ?? null,
    };
  } catch (error) {
    console.error('Failed to get user API key metadata from database');
    throw error;
  }
}

// Look up a user by API key hash (for API key auth flows)
export async function getUserByApiKeyHash(apiKeyHash: string) {
  try {
    const [selectedUser] = await db
      .select({
        id: user.id,
        email: user.email,
        apiKeyExpiresAt: user.apiKeyExpiresAt,
      })
      .from(user)
      .where(eq(user.apiKeyHash, apiKeyHash))
      .limit(1);

    return selectedUser ?? null;
  } catch (error) {
    console.error('Failed to get user by API key hash from database');
    throw error;
  }
}

export async function searchUsers({ query }: { query: string }) {
  return await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      or(ilike(user.name, `%${query}%`), ilike(user.email, `%${query}%`)),
    )
    .orderBy(asc(user.name))
    .limit(20);
}


// Chat and Message Utility Functions
// ==========================================

export async function saveChat({
  id,
  userId,
  title,
  isBrowserChat,
}: {
  id: string;
  userId: string;
  title: string;
  isBrowserChat?: boolean;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      isBrowserChat: isBrowserChat ?? false,
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

    return await db.delete(chat).where(eq(chat.id, id));
  } catch (error) {
    console.error('Failed to delete chat by id from database');
    throw error;
  }
}

export async function getBrowserChatsByUserId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, id), eq(chat.isBrowserChat, true)))
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


// Vote Utility Functions
// ==========================================

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


// Document Utility Functions
// ==========================================

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

// Suggestion Utility Functions
// ==========================================

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


// ==========================================
// Model Deployment Utility Functions
// ==========================================

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

export async function getAvailableModelByName({ name }: { name: string }) {
  return await db
    .select()
    .from(availableModel)
    .where(eq(availableModel.name, name))
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


// ==========================================
// Model Deployment Utility Functions
// ==========================================

export async function createModelDeployment({
  modelId,
  modelName,
  userId,
  slurmJobId,
  status = 'pending',
  endpointUrl,
  proxyUrl,
  errorMessage,
  resourceAllocation,
  expiresAt,
}: {
  modelId: string;
  modelName: string;
  userId: string;
  slurmJobId: string;
  status?: ModelDeployment['status'];
  endpointUrl?: string | null;
  proxyUrl?: string | null;
  errorMessage?: string | null;
  resourceAllocation?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}): Promise<ModelDeployment> {
  try {
    const [deployment] = await db
      .insert(modelDeployment)
      .values({
        modelId,
        modelName,
        userId,
        slurmJobId,
        status,
        endpointUrl,
        proxyUrl,
        errorMessage,
        resourceAllocation,
        expiresAt,
      })
      .returning();
    return deployment;
  } catch (error) {
    console.error('Failed to create model deployment in database', error);
    throw error;
  }
}

/**
 * Get model deployment by Slurm job ID
 */
export async function getModelDeploymentByJobId(slurmJobId: string): Promise<ModelDeployment | null> {
  try {
    const [deployment] = await db
      .select()
      .from(modelDeployment)
      .where(eq(modelDeployment.slurmJobId, slurmJobId))
      .limit(1);
    return deployment || null;
  } catch (error) {
    console.error('Failed to get model deployment by job ID from database', error);
    throw error;
  }
}


export async function getModelDeploymentsByUserId(userId: string): Promise<ModelDeployment[]> {
  try {
    return await db
      .select()
      .from(modelDeployment)
      .where(eq(modelDeployment.userId, userId));
  } catch (error) {
    console.error('Failed to get model deployments by user id from database');
    throw error;
  }
}

export async function getModelDeploymentById(id: string): Promise<ModelDeployment | null> {
  try {
    const [deployment] = await db
      .select()
      .from(modelDeployment)
      .where(eq(modelDeployment.id, id))
      .limit(1);
    return deployment || null;
  } catch (error) {
    console.error('Failed to get model deployment by id from database', error);
    throw error;
  }
}

/**
 * Get the active/running model deployment for a user
 * Returns the most recent deployment where the user has access and status is 'ready' or 'running'
 */
export async function getActiveModelDeploymentByUserId(userId: string): Promise<ModelDeployment | null> {
  try {
    // Look for deployments where status is 'ready' or 'running'
    const [deployment] = await db
      .select()
      .from(modelDeployment)
      .where(
        and(
          eq(modelDeployment.userId, userId),
          or(
            eq(modelDeployment.status, 'ready'),
            eq(modelDeployment.status, 'running')
          )
        )
      )
      // Prefer the newest active deployment deterministically.
      .orderBy(desc(modelDeployment.updatedAt), desc(modelDeployment.createdAt))
      .limit(1);
    return deployment || null;
  } catch (error) {
    console.error('Failed to get active model deployment by user id from database', error);
    throw error;
  }
}

/**
 * Set the status of a model deployment by ID to 'shutdown'
 */
export async function shutdownModelDeploymentById(id: string): Promise<void> {
  try {
    await db.update(modelDeployment).set({ status: 'shutdown' }).where(eq(modelDeployment.id, id));
  } catch (error) {
    console.error('Failed to shutdown model deployment by id from database', error);
    throw error;
  }
}

// ==========================================
// Authorized Users Utility Functions
// ==========================================

/**
 * Add a user to a deployment.
 */
export async function addUserToDeployment({
  deploymentId,
  userId,
  permission = 'user',
}: {
  deploymentId: string;
  userId: string;
  permission?: 'owner' | 'user';
}): Promise<AuthorizedUsers | null> {
  try {
    const [row] = await db
      .insert(authorizedUsers)
      .values({ deploymentId, userId, permission })
      .returning();
    return row;
  } catch (error) {
    console.error('Failed to add user to deployment in database', error);
    throw error;
  }
}

/**
 * Revoke a user's access to a deployment.
 */
export async function removeUserFromDeployment({
  deploymentId,
  userId,
}: {
  deploymentId: string;
  userId: string;
}): Promise<void> {
  try {
    await db
      .delete(authorizedUsers)
      .where(
        and(
          eq(authorizedUsers.deploymentId, deploymentId),
          eq(authorizedUsers.userId, userId),
        ),
      );
  } catch (error) {
    console.error('Failed to remove user from deployment in database', error);
    throw error;
  }
}

/**
 * Return all access rows for a given deployment (owner + shared users).
 */
export async function getAuthorizedUsersByDeploymentId(deploymentId: string) {
  try {
    return await db
      .select({
        userId: authorizedUsers.userId,
        permission: authorizedUsers.permission,
        name: user.name,
        email: user.email,
      })
      .from(authorizedUsers)
      .innerJoin(user, eq(authorizedUsers.userId, user.id))
      .where(eq(authorizedUsers.deploymentId, deploymentId));
  } catch (error) {
    console.error('Failed to get authorized users by deployment id from database', error);
    throw error;
  }
}

/**
 * Return a specific access row for a given deployment/user pair.
 */
export async function getAuthorizedUserByDeploymentIdAndUserId({
  deploymentId,
  userId,
}: {
  deploymentId: string;
  userId: string;
}): Promise<AuthorizedUsers | null> {
  try {
    const [row] = await db
      .select()
      .from(authorizedUsers)
      .where(
        and(
          eq(authorizedUsers.deploymentId, deploymentId),
          eq(authorizedUsers.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error(
      'Failed to get authorized user by deployment id and user id from database',
      error,
    );
    throw error;
  }
}

/**
 * Return all ModelDeployment rows that a given user has any access to
 * (either as owner or as a shared user).
 */
export async function getAccessibleDeploymentsByUserId(
  userId: string,
): Promise<ModelDeployment[]> {
  try {
    const rows = await db
      .select({ deployment: modelDeployment })
      .from(authorizedUsers)
      .innerJoin(modelDeployment, eq(authorizedUsers.deploymentId, modelDeployment.id))
      .where(eq(authorizedUsers.userId, userId));
    return rows.map((r) => r.deployment);
  } catch (error) {
    console.error('Failed to get accessible deployments by user id from database', error);
    throw error;
  }
}

/**
 * Get the most recent active deployment a user can access
 * (owner or shared via AuthorizedUsers).
 */
export async function getActiveAccessibleDeploymentByUserId(
  userId: string,
): Promise<ModelDeployment | null> {
  try {
    const [row] = await db
      .select({ deployment: modelDeployment })
      .from(authorizedUsers)
      .innerJoin(
        modelDeployment,
        eq(authorizedUsers.deploymentId, modelDeployment.id),
      )
      .where(
        and(
          eq(authorizedUsers.userId, userId),
          or(
            eq(modelDeployment.status, 'ready'),
            eq(modelDeployment.status, 'running'),
          ),
        ),
      )
      .orderBy(desc(modelDeployment.updatedAt), desc(modelDeployment.createdAt))
      .limit(1);

    return row?.deployment || null;
  } catch (error) {
    console.error(
      'Failed to get active accessible deployment by user id from database',
      error,
    );
    throw error;
  }
}

// ==========================================
// Pending Deployment Invite Helpers
// ==========================================

/**
 * Insert a pending invite for an email that does not yet have a User row.
 * Idempotent on (deploymentId, email): if a row already exists, returns it.
 */
export async function upsertPendingDeploymentInvite({
  deploymentId,
  email,
  invitedBy,
  permission = 'user',
}: {
  deploymentId: string;
  email: string;
  invitedBy: string;
  permission?: 'owner' | 'user';
}): Promise<{ row: PendingDeploymentInvite; alreadyExisted: boolean }> {
  const trimmedEmail = email.trim();

  try {
    const [row] = await db
      .insert(pendingDeploymentInvite)
      .values({
        deploymentId,
        email: trimmedEmail,
        permission,
        invitedBy,
      })
      .returning();

    return { row, alreadyExisted: false };
  } catch (error) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: string }).code
        : undefined;

    if (errorCode === '23505') {
      const [existing] = await db
        .select()
        .from(pendingDeploymentInvite)
        .where(
          and(
            eq(pendingDeploymentInvite.deploymentId, deploymentId),
            eq(pendingDeploymentInvite.email, trimmedEmail),
          ),
        )
        .limit(1);
      if (existing) {
        return { row: existing, alreadyExisted: true };
      }
    }

    console.error('Failed to upsert pending deployment invite', error);
    throw error;
  }
}

/**
 * Return all pending invites attached to a deployment.
 */
export async function getPendingDeploymentInvitesByDeploymentId(
  deploymentId: string,
): Promise<PendingDeploymentInvite[]> {
  try {
    return await db
      .select()
      .from(pendingDeploymentInvite)
      .where(eq(pendingDeploymentInvite.deploymentId, deploymentId));
  } catch (error) {
    console.error(
      'Failed to get pending deployment invites by deployment id',
      error,
    );
    throw error;
  }
}

/**
 * Convert any pending invites for the given email into AuthorizedUsers
 * rows for the given user. Returns the number of invites that were claimed.
 *
 * Safe to call multiple times — invites are deleted as they're claimed and
 * unique-constraint violations from existing AuthorizedUsers rows are ignored.
 */
export async function claimPendingDeploymentInvitesForUser({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<number> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return 0;
  }

  try {
    const invites = await db
      .select()
      .from(pendingDeploymentInvite)
      .where(eq(pendingDeploymentInvite.email, trimmedEmail));

    let claimed = 0;
    for (const invite of invites) {
      try {
        await db
          .insert(authorizedUsers)
          .values({
            deploymentId: invite.deploymentId,
            userId,
            permission: invite.permission,
          });
        claimed += 1;
      } catch (error) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        // 23505 = unique violation: user already has access. Treat as claimed.
        if (errorCode === '23505') {
          claimed += 1;
        } else {
          console.error('Failed to convert pending invite', error);
          continue;
        }
      }

      try {
        await db
          .delete(pendingDeploymentInvite)
          .where(eq(pendingDeploymentInvite.id, invite.id));
      } catch (error) {
        console.error('Failed to remove claimed pending invite', error);
      }
    }

    return claimed;
  } catch (error) {
    console.error('Failed to claim pending deployment invites', error);
    throw error;
  }
}


