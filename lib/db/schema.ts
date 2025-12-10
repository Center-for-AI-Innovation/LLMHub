import type { InferSelectModel } from 'drizzle-orm';
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
} from 'drizzle-orm/pg-core';

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

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

export const modelDeployment = pgTable('ModelDeployment', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  modelName: varchar('modelName', { length: 255 }).notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  slurmJobId: varchar('slurmJobId', { length: 50 }).notNull(),
  status: varchar('status', {
    enum: ['pending', 'launching', 'ready', 'failed', 'shutdown'],
  })
    .notNull()
    .default('pending'),
  endpointUrl: varchar('endpointUrl', { length: 255 }),
  tunnelUrl: varchar('tunnelUrl', { length: 255 }),
  errorMessage: text('errorMessage'),
  resourceAllocation: json('resourceAllocation'),
  expirationTime: timestamp('expirationTime'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type ModelDeployment = InferSelectModel<typeof modelDeployment>;

export const availableModel = pgTable('AvailableModel', {
  id: varchar('id', { length: 255 }).primaryKey().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { enum: ['WARM', 'COLD', 'OFFLINE'] }).notNull().default('WARM'),
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

// Table to link chats with vLLM jobs
// This stores the mapping between a chat session and the vLLM job ID used for that chat
export const vllmChatJob = pgTable('VllmChatJob', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  slurmJobId: varchar('slurmJobId', { length: 50 }).notNull(),
  modelName: varchar('modelName', { length: 255 }),
  // The actual vLLM server URL (e.g., http://worker-node:8000)
  endpointUrl: varchar('endpointUrl', { length: 255 }),
  // The frontend proxy URL for users to call (e.g., /api/v1/job/{jobId}/chat/completions)
  proxyUrl: varchar('proxyUrl', { length: 255 }),
  status: varchar('status', { enum: ['active', 'inactive', 'failed'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type VllmChatJob = InferSelectModel<typeof vllmChatJob>;
