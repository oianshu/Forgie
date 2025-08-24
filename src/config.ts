import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  APPWRITE_ENDPOINT: z.string().url(),
  APPWRITE_PROJECT_ID: z.string().min(1),
  APPWRITE_API_KEY: z.string().min(1),
  APPWRITE_DATABASE_ID: z.string().min(1),
  BLOXLINK_API_BASE: z.string().url(),
  BLOXLINK_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const config = EnvSchema.parse({
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
  APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY: process.env.APPWRITE_API_KEY,
  APPWRITE_DATABASE_ID: process.env.APPWRITE_DATABASE_ID,
  BLOXLINK_API_BASE: process.env.BLOXLINK_API_BASE || 'https://api.blox.link/v4',
  BLOXLINK_API_KEY: process.env.BLOXLINK_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
});
