import { Client, Databases } from 'node-appwrite';
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

const USERS_COLLECTION_ID = 'users';
const AUDITS_COLLECTION_ID = 'audits';

export async function ensureCollections(): Promise<void> {
  const connected = await verifyAppwriteConnection();
  if (!connected) {
    throw new Error('Failed to connect to Appwrite');
  }

  try {
    await ensureCollectionSchema(USERS_COLLECTION_ID, 'Users');
    await ensureCollectionSchema(AUDITS_COLLECTION_ID, 'Audit Logs');
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
