import { Client, Databases, Query } from 'node-appwrite';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(config.APPWRITE_ENDPOINT)
  .setProject(config.APPWRITE_PROJECT_ID)
  .setKey(config.APPWRITE_API_KEY);

export const databases = new Databases(client);

// Helper to verify Appwrite connection
async function verifyAppwriteConnection() {
  try {
    await databases.listCollections(config.APPWRITE_DATABASE_ID);
    return true;
  } catch (error) {
    const appwriteError = error as { code?: number; type?: string; message?: string };
    logger.error({
      code: appwriteError?.code,
      type: appwriteError?.type,
      message: appwriteError?.message || 'Failed to connect to Appwrite'
    }, 'Appwrite connection error');
    return false;
  }
}

// ===== Tasks API =====
export interface TaskDocument {
  task_id: string; // public id used in customIds
  guild_id: string;
  assigned_by: string; // discord id
  assigned_to: string; // discord id
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  due_date?: string | null; // ISO date string
  status: 'assigned' | 'in_progress' | 'blocked' | 'done';
  progress: number; // 0-100
  dm_message_id?: string | null;
  channel_message_id?: string | null;
  channel_id?: string | null;
  thread_id?: string | null;
  created_at: string;
  updated_at: string;
}

export async function createTask(doc: TaskDocument): Promise<void> {
  try {
    await databases.createDocument(
      config.APPWRITE_DATABASE_ID,
      TASKS_COLLECTION_ID,
      doc.task_id,
      {
        ...doc,
        // store numbers/strings as-is (schema uses string for safety)
        progress: String(doc.progress)
      },
    );
  } catch (e) {
    logger.error({ err: e }, 'Failed to create task');
    throw e;
  }
}

export async function getTask(taskId: string): Promise<TaskDocument | null> {
  try {
    const doc = await databases.getDocument(
      config.APPWRITE_DATABASE_ID,
      TASKS_COLLECTION_ID,
      taskId,
    );
    return {
      task_id: String(doc.task_id),
      guild_id: String(doc.guild_id),
      assigned_by: String(doc.assigned_by),
      assigned_to: String(doc.assigned_to),
      title: String(doc.title),
      description: doc.description ?? undefined,
      priority: doc.priority ?? undefined,
      due_date: doc.due_date ?? null,
      status: (doc.status as TaskDocument['status']) ?? 'assigned',
      progress: Number(doc.progress ?? '0'),
      dm_message_id: doc.dm_message_id ?? null,
      channel_message_id: doc.channel_message_id ?? null,
      channel_id: doc.channel_id ?? null,
      thread_id: doc.thread_id ?? null,
      created_at: String(doc.created_at ?? new Date().toISOString()),
      updated_at: String(doc.updated_at ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export async function updateTask(taskId: string, patch: Partial<TaskDocument>): Promise<void> {
  try {
    await databases.updateDocument(
      config.APPWRITE_DATABASE_ID,
      TASKS_COLLECTION_ID,
      taskId,
      {
        ...patch,
        ...(patch.progress !== undefined ? { progress: String(patch.progress) } : {}),
        updated_at: new Date().toISOString(),
      },
    );
  } catch (e) {
    logger.error({ err: e }, 'Failed to update task');
    throw e;
  }
}

export async function updateTaskProgress(taskId: string, progress: number, status?: TaskDocument['status']): Promise<void> {
  await updateTask(taskId, { progress, status });
}

export async function listUserTasks(assignedTo: string, guildId: string): Promise<TaskDocument[]> {
  try {
    const res = await databases.listDocuments(
      config.APPWRITE_DATABASE_ID,
      TASKS_COLLECTION_ID,
      [
        Query.equal('assigned_to', assignedTo),
        Query.equal('guild_id', guildId),
      ]
    );
    const documents = (res.documents || []) as Array<Record<string, unknown>>;
    const tasks: TaskDocument[] = documents.map((doc) => {
      const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : String(v ?? fb));
      const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
      const nulStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
      const num = (v: unknown, fb = 0): number => (typeof v === 'number' ? v : Number(v ?? fb));

      const statusVal = ((): TaskDocument['status'] => {
        const s = str(doc.status, 'assigned');
        if (s === 'in_progress' || s === 'blocked' || s === 'done' || s === 'assigned') return s;
        return 'assigned';
      })();

      const priorityVal = ((): TaskDocument['priority'] | undefined => {
        const p = optStr(doc.priority);
        if (!p) return undefined;
        const pl = p.toLowerCase();
        return pl === 'low' || pl === 'medium' || pl === 'high' ? pl : undefined;
      })();

      return {
        task_id: str(doc.task_id),
        guild_id: str(doc.guild_id),
        assigned_by: str(doc.assigned_by),
        assigned_to: str(doc.assigned_to),
        title: str(doc.title),
        description: optStr(doc.description),
        priority: priorityVal,
        due_date: nulStr(doc.due_date),
        status: statusVal,
        progress: num(doc.progress, 0),
        dm_message_id: nulStr(doc.dm_message_id),
        channel_message_id: nulStr(doc.channel_message_id),
        channel_id: nulStr(doc.channel_id),
        thread_id: nulStr(doc.thread_id),
        created_at: str(doc.created_at, new Date().toISOString()),
        updated_at: str(doc.updated_at, new Date().toISOString()),
      };
    });
    return tasks;
  } catch (e) {
    logger.error({ err: e }, 'Failed to list user tasks');
    return [];
  }
}

export async function getUserProfile(discordId: string, guildId: string): Promise<UserProfile | null> {
  const docId = `${guildId.slice(0, 8)}${discordId.slice(0, 8)}`;
  try {
    const doc = await databases.getDocument(
      config.APPWRITE_DATABASE_ID,
      USERS_COLLECTION_ID,
      docId,
    );
    // Coerce result to UserProfile shape (Appwrite returns generic document)
    const profile: UserProfile = {
      discord_id: String(doc.discord_id ?? discordId),
      guild_id: String(doc.guild_id ?? guildId),
      username: String(doc.username ?? ''),
      joined_at: doc.joined_at ?? null,
      highest_role_id: doc.highest_role_id ?? null,
      highest_role_name: doc.highest_role_name ?? null,
      roblox_username: doc.roblox_username ?? null,
      last_seen_at: String(doc.last_seen_at ?? new Date().toISOString()),
      timezone: doc.timezone ?? null,
    };
    return profile;
  } catch (e) {
    // Not found or other error
    return null;
  }
}

const USERS_COLLECTION_ID = 'users';
const AUDITS_COLLECTION_ID = 'audits';
const TASKS_COLLECTION_ID = 'tasks';

export async function ensureCollections(): Promise<void> {
  const connected = await verifyAppwriteConnection();
  if (!connected) {
    throw new Error('Failed to connect to Appwrite');
  }

  try {
    await ensureCollectionSchema(USERS_COLLECTION_ID, 'Users');
    await ensureCollectionSchema(AUDITS_COLLECTION_ID, 'Audit Logs');
    await ensureCollectionSchema(TASKS_COLLECTION_ID, 'Tasks');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error ensuring collections: ${errorMessage}`);
    throw error;
  }
}

export interface UserProfile {
  discord_id: string;
  guild_id: string;
  username: string;
  joined_at: string | null;
  highest_role_id: string | null;
  highest_role_name: string | null;
  roblox_username: string | null;
  last_seen_at: string;
  timezone?: string | null;
}

// Appwrite error type
interface AppwriteError extends Error {
  code?: number | string;
  response?: {
    message?: string;
    code?: number | string;
    type?: string;
  };
}

// Collection attribute schema
type CollectionAttribute = {
  key: string;
  type: 'string' | 'boolean' | 'datetime';
  size?: number;
  required?: boolean;
};

// Collection schemas
const COLLECTION_ATTRIBUTES = {
  users: [
    { key: 'discord_id', type: 'string' as const, size: 255, required: true },
    { key: 'guild_id', type: 'string' as const, size: 255, required: true },
    { key: 'username', type: 'string' as const, size: 255, required: true },
    { key: 'joined_at', type: 'string' as const, size: 255 },
    { key: 'highest_role_id', type: 'string' as const, size: 255 },
    { key: 'highest_role_name', type: 'string' as const, size: 255 },
    { key: 'roblox_username', type: 'string' as const, size: 255 },
    { key: 'email_available', type: 'boolean' as const },
    { key: 'last_seen_at', type: 'string' as const, size: 255, required: true },
    { key: 'timezone', type: 'string' as const, size: 255 },
    { key: 'oauth_data', type: 'string' as const, size: 2000 } // JSON stringified
  ],
  audits: [
    { key: 'action', type: 'string' as const, size: 255, required: true },
    { key: 'actor_discord_id', type: 'string' as const, size: 255, required: true },
    { key: 'guild_id', type: 'string' as const, size: 255, required: true },
    { key: 'timestamp', type: 'string' as const, size: 255, required: true },
    { key: 'metadata', type: 'string' as const, size: 2000 } // JSON stringified
  ],
  oauth_sessions: [
    { key: 'discordUserId', type: 'string' as const, size: 255, required: true },
    { key: 'state', type: 'string' as const, size: 255, required: true },
    { key: 'codeVerifier', type: 'string' as const, size: 255, required: true },
    { key: 'createdAt', type: 'datetime' as const, required: true }
  ],
  tasks: [
    { key: 'task_id', type: 'string' as const, size: 255, required: true },
    { key: 'guild_id', type: 'string' as const, size: 255, required: true },
    { key: 'assigned_by', type: 'string' as const, size: 255, required: true },
    { key: 'assigned_to', type: 'string' as const, size: 255, required: true },
    { key: 'title', type: 'string' as const, size: 255, required: true },
    { key: 'description', type: 'string' as const, size: 2000 },
    { key: 'priority', type: 'string' as const, size: 50 },
    { key: 'due_date', type: 'string' as const, size: 255 },
    { key: 'status', type: 'string' as const, size: 50 },
    { key: 'progress', type: 'string' as const, size: 10 },
    { key: 'dm_message_id', type: 'string' as const, size: 255 },
    { key: 'channel_message_id', type: 'string' as const, size: 255 },
    { key: 'channel_id', type: 'string' as const, size: 255 },
    { key: 'thread_id', type: 'string' as const, size: 255 },
    { key: 'created_at', type: 'string' as const, size: 255, required: true },
    { key: 'updated_at', type: 'string' as const, size: 255, required: true }
  ]
} as const;

// Type for existing attributes from Appwrite
interface ExistingAttribute {
  key: string;
  type: string;
  size?: number;
  required: boolean;
}

async function ensureCollectionSchema(collectionId: string, name: string) {
  try {
    // Try to get the collection to check if it exists
    const collection = await databases.getCollection(
      config.APPWRITE_DATABASE_ID,
      collectionId
    );

    // If we get here, the collection exists - check its attributes
    const existingAttributes: ExistingAttribute[] = [];
    const existingAttrKeys: string[] = [];

    if (collection.attributes && Array.isArray(collection.attributes)) {
      for (const attr of collection.attributes) {
        if (attr && typeof attr === 'object' && 'key' in attr) {
          const attrObj = attr as { key: string; type?: string; size?: number; required?: boolean };
          existingAttributes.push({
            key: attrObj.key,
            type: attrObj.type || 'string',
            size: attrObj.size,
            required: Boolean(attrObj.required)
          });
          existingAttrKeys.push(attrObj.key);
        }
      }
    }

    // Get expected attributes for this collection
    const collectionAttrs = (
      collectionId in COLLECTION_ATTRIBUTES 
        ? COLLECTION_ATTRIBUTES[collectionId as keyof typeof COLLECTION_ATTRIBUTES] 
        : []
    ) as readonly CollectionAttribute[];

    // Find missing attributes
    const missingAttrs = collectionAttrs.filter(attr => 
      !existingAttrKeys.includes(attr.key)
    );

    // Add missing attributes
    for (const attr of missingAttrs) {
      try {
        if (attr.type === 'string' && typeof attr.size === 'number') {
          await databases.createStringAttribute(
            config.APPWRITE_DATABASE_ID,
            collectionId,
            attr.key,
            attr.size,
            Boolean(attr.required)
          );
        } else if (attr.type === 'boolean') {
          await databases.createBooleanAttribute(
            config.APPWRITE_DATABASE_ID,
            collectionId,
            attr.key,
            Boolean(attr.required)
          );
        } else if (attr.type === 'datetime') {
          await databases.createDatetimeAttribute(
            config.APPWRITE_DATABASE_ID,
            collectionId,
            attr.key,
            Boolean(attr.required)
          );
        }
      } catch (error) {
        const appwriteError = error as AppwriteError;
        if (appwriteError?.code !== 409) { // 409 = attribute already exists
          throw error;
        }
      }
    }
  } catch (error) {
    const appwriteError = error as AppwriteError;
    
    // If collection doesn't exist, create it
    if (appwriteError?.code === 404) {
      try {
        await databases.createCollection(
          config.APPWRITE_DATABASE_ID,
          collectionId,
          name,
          undefined, // No explicit permissions
          true,      // Document level permissions
          true       // Enabled
        );

        // After creating collection, add all attributes
        const collectionAttrs = (
          collectionId in COLLECTION_ATTRIBUTES 
            ? COLLECTION_ATTRIBUTES[collectionId as keyof typeof COLLECTION_ATTRIBUTES] 
            : []
        ) as readonly CollectionAttribute[];

        for (const attr of collectionAttrs) {
          try {
            if (attr.type === 'string' && typeof attr.size === 'number') {
              await databases.createStringAttribute(
                config.APPWRITE_DATABASE_ID,
                collectionId,
                attr.key,
                attr.size,
                Boolean(attr.required)
              );
            } else if (attr.type === 'boolean') {
              await databases.createBooleanAttribute(
                config.APPWRITE_DATABASE_ID,
                collectionId,
                attr.key,
                Boolean(attr.required)
              );
            } else if (attr.type === 'datetime') {
              await databases.createDatetimeAttribute(
                config.APPWRITE_DATABASE_ID,
                collectionId,
                attr.key,
                Boolean(attr.required)
              );
            }
          } catch (attrError) {
            const appwriteAttrError = attrError as AppwriteError;
            if (appwriteAttrError?.code !== 409) { // Skip if attribute already exists
              logger.warn({
                collection: collectionId,
                attribute: attr.key,
                error: appwriteAttrError?.message || 'Unknown error'
              }, 'Failed to create attribute');
            }
          }
        }
      } catch (createError) {
        if ((createError as AppwriteError)?.code !== 409) { // 409 = collection already exists
          throw new Error(
            `Failed to create collection: ${createError instanceof Error ? createError.message : 'Unknown error'}`
          );
        }
      }
    } else if (appwriteError?.code !== 409) { // 409 = collection already exists
      throw error;
    }
  }
}

export async function upsertUserProfile(profile: UserProfile): Promise<void> {
  // Shorter document ID format: first 8 chars of guild ID + first 8 chars of user ID
  const docId = `${profile.guild_id.slice(0, 8)}${profile.discord_id.slice(0, 8)}`;
  try {
    await databases.updateDocument(
      config.APPWRITE_DATABASE_ID,
      USERS_COLLECTION_ID,
      docId,
      profile,
    );
  } catch {
    try {
      await databases.createDocument(
        config.APPWRITE_DATABASE_ID,
        USERS_COLLECTION_ID,
        docId,
        profile,
      );
    } catch (e) {
      logger.error({ err: e }, 'Failed to upsert user profile');
    }
  }
}

export async function setUserTimezone(discordId: string, guildId: string, timezone: string): Promise<void> {
  const docId = `${guildId.slice(0, 8)}${discordId.slice(0, 8)}`;
  try {
    await databases.updateDocument(
      config.APPWRITE_DATABASE_ID,
      USERS_COLLECTION_ID,
      docId,
      { timezone },
    );
  } catch {
    try {
      await databases.createDocument(
        config.APPWRITE_DATABASE_ID,
        USERS_COLLECTION_ID,
        docId,
        {
          discord_id: discordId,
          guild_id: guildId,
          username: '',
          joined_at: null,
          highest_role_id: null,
          highest_role_name: null,
          roblox_username: null,
          last_seen_at: new Date().toISOString(),
          timezone,
        },
      );
    } catch (e) {
      logger.error({ err: e }, 'Failed to set user timezone');
      throw e;
    }
  }
}

export async function createAudit(entry: {
  action: string;
  actor_discord_id: string;
  guild_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    // Convert metadata to JSON string if it exists
    const auditData = {
      ...entry,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined
    };

    // Create a deterministic ID from timestamp and actor
    const docId = `${entry.timestamp.slice(0, 8)}_${entry.actor_discord_id.slice(0, 8)}`;
    
    await databases.createDocument(
      config.APPWRITE_DATABASE_ID,
      AUDITS_COLLECTION_ID,
      docId,
      auditData,
    );
  } catch (e) {
    logger.error({ err: e, action: entry.action }, 'Failed to create audit');
  }
}
