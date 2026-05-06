import type { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
  date,
  integer,
  unique,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  apiKeyHash: text('apiKeyHash'),
  apiKeyExpiresAt: timestamp('apiKeyExpiresAt'),
}, (table) => ({
  emailUnique: unique().on(table.email),
}));

export type User = InferSelectModel<typeof user>;

export const session = pgTable(
  'Session',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    expiresAt: timestamp('expiresAt').notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    tokenUnique: unique().on(table.token),
    userIdIndex: index('Session_userId_idx').on(table.userId),
  }),
);

export type Session = InferSelectModel<typeof session>;

export const account = pgTable(
  'Account',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull(),
  },
  (table) => ({
    userIdIndex: index('Account_userId_idx').on(table.userId),
  }),
);

export type Account = InferSelectModel<typeof account>;

export const verification = pgTable(
  'Verification',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => ({
    identifierIndex: index('Verification_identifier_idx').on(table.identifier),
  }),
);

export type Verification = InferSelectModel<typeof verification>;

export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
  isBrowserChat: boolean('isBrowserChat').notNull().default(false),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable('Message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  content: json('content').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type Message = InferSelectModel<typeof message>;

export const vote = pgTable(
  'Vote',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('text', { enum: ['text', 'code', 'image', 'sheet'] })
      .notNull()
      .default('text'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  },
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  }),
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const modelRequest = pgTable('ModelRequest', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  department: varchar('department', { length: 255 }).notNull(),
  modelType: varchar('modelType', { enum: ['custom', 'finetuned', 'existing'] }).notNull(),
  purpose: text('purpose').notNull(),
  startDate: date('startDate').notNull(),
  endDate: date('endDate').notNull(),
  resourceRequirements: text('resourceRequirements'),
  status: varchar('status', {
    enum: ['pending', 'approved', 'rejected', 'active', 'completed'],
  })
    .notNull()
    .default('pending'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type ModelRequest = InferSelectModel<typeof modelRequest>;

export const resourceAllocation = pgTable('ResourceAllocation', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  resourceType: varchar('resourceType', { length: 50 }).notNull(),
  resourceName: varchar('resourceName', { length: 50 }).notNull(),
  totalCount: integer('totalCount').notNull(),
  allocatedCount: integer('allocatedCount').notNull().default(0),
  isActive: boolean('isActive').notNull().default(true),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type ResourceAllocation = InferSelectModel<typeof resourceAllocation>;


export const availableModel = pgTable('AvailableModel', {
  id: varchar('id', { length: 255 }).primaryKey().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { enum: ['warm', 'cold'] }).notNull().default('cold'),
  type: varchar('type', { enum: ['Small', 'Medium', 'Large'] }).notNull(),
  family: varchar('family', { length: 100 }).notNull(),
  variant: varchar('variant', { length: 100 }).notNull(),
  modelType: varchar('modelType', { length: 50 }),
  specs: json('specs').notNull(),
  vocabSize: integer('vocabSize'),
  huggingfaceId: varchar('huggingfaceId', { length: 255 }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type AvailableModel = InferSelectModel<typeof availableModel>;


export const modelDeployment = pgTable('ModelDeployment',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    modelId: varchar('modelId', { length: 255 })
      .notNull()
      .references(() => availableModel.id),
    modelName: varchar('modelName', { length: 255 }).notNull(),
    userId: uuid('userId').notNull().references(() => user.id),
    slurmJobId: varchar('slurmJobId', { length: 50 }).notNull(),
    status: varchar('status', {
      enum: ['pending', 'launching', 'ready', 'running', 'failed', 'shutdown', 'completed'],
    })
      .notNull()
      .default('pending'),
    endpointUrl: varchar('endpointUrl', { length: 255 }),
    proxyUrl: varchar('proxyUrl', { length: 255 }),
    errorMessage: text('errorMessage'),
    resourceAllocation: json('resourceAllocation'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    expiresAt: timestamp('expiresAt'),
  },
  (table) => ({
    activeDeploymentUnique: uniqueIndex('ModelDeployment_active_modelId_userId_unique')
    .on(table.modelId, table.userId)
    .where(sql`status IN ('pending', 'launching', 'ready', 'running')`), // Ensure there is only active deployment per user 
  }),
);

export type ModelDeployment = InferSelectModel<typeof modelDeployment>;


export const authorizedUsers = pgTable(
  'AuthorizedUsers',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    deploymentId: uuid('deploymentId')
      .notNull()
      .references(() => modelDeployment.id),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    permission: varchar('permission', { enum: ['owner', 'user'] }).notNull().default('owner'),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => ({
    // One permission row per user per deployment
    deploymentUserUnique: unique().on(table.deploymentId, table.userId),
  }),
);

export type AuthorizedUsers = InferSelectModel<typeof authorizedUsers>;

// Tracks share invites for emails that don't yet have a registered User row.
// Once the invitee signs up with the same email, these rows are converted to
// AuthorizedUsers entries and removed.
export const pendingDeploymentInvite = pgTable(
  'PendingDeploymentInvite',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    deploymentId: uuid('deploymentId')
      .notNull()
      .references(() => modelDeployment.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    permission: varchar('permission', { enum: ['owner', 'user'] })
      .notNull()
      .default('user'),
    invitedBy: uuid('invitedBy')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => ({
    deploymentEmailUnique: unique().on(table.deploymentId, table.email),
    emailIndex: index('PendingDeploymentInvite_email_idx').on(table.email),
  }),
);

export type PendingDeploymentInvite = InferSelectModel<
  typeof pendingDeploymentInvite
>;
