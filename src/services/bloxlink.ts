import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import pRetry, { AbortError } from 'p-retry';

export interface BloxlinkLookup {
  robloxId?: string;
  robloxUsername?: string;
  linked: boolean;
}

function sanitizeUrl(u: URL): string {
  const clone = new URL(u.toString());
  const sensitive = ['api-key', 'apikey', 'apiKey', 'key', 'token'];
  for (const k of sensitive) if (clone.searchParams.has(k)) clone.searchParams.set(k, 'REDACTED');
  return clone.toString();
}

async function requestJson(url: URL): Promise<Response> {
  const key = config.BLOXLINK_API_KEY?.trim();
  const hasScheme = key ? /^(Bearer|Key|Token)\s+/i.test(key) : false;
  const bareKey = key ? (hasScheme ? key.replace(/^[^\s]+\s+/, '') : key) : undefined;

  // Special handling for v4 public endpoints: Use Authorization header with raw key
  const isV4Public = /\/v4\/public\//.test(url.pathname);
  if (isV4Public) {
    // For v4 public endpoints, use Authorization: <key> header
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (bareKey) {
      headers['Authorization'] = bareKey;
    }
    
    logger.info({ url: sanitizeUrl(url), headers: Object.keys(headers) }, '[Bloxlink] v4 public request');
    const res = await fetch(url, { headers });
    return res;
  }

  // Default behavior for non-public endpoints
  const baseHeaders = { 'Content-Type': 'application/json' } as Record<string, string>;
  const variants: Record<string, string>[] = [];
  if (key) {
    variants.push({ ...baseHeaders, Authorization: hasScheme ? key : `Bearer ${key}` });
    variants.push({ ...baseHeaders, Authorization: `Key ${key}` });
    variants.push({ ...baseHeaders, Authorization: `Token ${bareKey!}` });
    variants.push({ ...baseHeaders, Authorization: key });
    variants.push({ ...baseHeaders, 'X-API-Key': bareKey! });
    variants.push({ ...baseHeaders, 'X-Api-Key': bareKey! });
    variants.push({ ...baseHeaders, 'x-api-key': bareKey! });
    variants.push({ ...baseHeaders, 'api-key': bareKey! });
    variants.push({ ...baseHeaders, 'Api-Key': bareKey! });
    variants.push({ ...baseHeaders, apikey: bareKey! });
    variants.push({ ...baseHeaders, key: bareKey! });
    variants.push({ ...baseHeaders, apiKey: bareKey! });
    variants.push({ ...baseHeaders, 'Bloxlink-Api-Key': bareKey! });
    variants.push({ ...baseHeaders, 'Bloxlink-API-Key': bareKey! });
  } else {
    variants.push(baseHeaders);
  }

  let last: Response | null = null;
  for (const h of variants) {
    const res = await fetch(url, { headers: h });
    logger.info({ url: sanitizeUrl(url), status: res.status, headersTried: Object.keys(h) }, '[Bloxlink] request attempt');
    if (![400, 401, 403].includes(res.status)) return res;
    last = res;
  }
  return last as Response;
}

function mapLookup(data: any): BloxlinkLookup {
  // Try a variety of potential shapes
  const username: string | undefined =
    data?.user?.robloxUsername ??
    data?.user?.primaryAccount?.username ??
    data?.user?.primaryAccount ??
    data?.user?.username ??
    data?.robloxUsername ??
    data?.primaryAccount?.username ??
    data?.primaryAccount ??
    data?.username ??
    data?.result?.name ??
    // v4 public resolved structures (best-effort)
    data?.resolved?.robloxUsername ??
    data?.resolved?.username ??
    data?.resolved?.name ??
    data?.resolved?.user?.username ??
    data?.resolved?.user?.name;

  const robloxId: string | undefined =
    data?.user?.robloxId?.toString?.() ??
    data?.robloxId?.toString?.() ??
    // v4 public uses capital D: robloxID
    data?.robloxID?.toString?.() ??
    data?.result?.id?.toString?.();

  return { linked: Boolean(username || robloxId), robloxUsername: username, robloxId };
}

async function fetchLookup(discordId: string, opts?: { guildId?: string }): Promise<BloxlinkLookup> {
  // Build against API origin to avoid double-versioning (e.g., /v4/v1/...)
  const base = new URL(config.BLOXLINK_API_BASE);
  const origin = `${base.protocol}//${base.host}`;

  // Candidate paths across versions
  const candidatePaths: string[] = [];
  
  // If guildId is provided, try the v4 public guild endpoint first (most specific)
  if (opts?.guildId) {
    candidatePaths.push(
      '/v4/public/guilds/{gid}/discord-to-roblox/{id}'
    );
  }
  
  // Then try other public endpoints
  candidatePaths.push(
    // v4 public
    '/v4/public/discord/{id}',
    '/v4/discord/{id}',
    // v3
    '/v3/user/lookup?discordId={id}',
    '/v3/discord/{id}',
    // v1
    '/v1/user/lookup?discordId={id}',
    '/v1/user/lookup?userId={id}',
    '/v1/discord/{id}',
    // Unversioned
    '/user/lookup?discordId={id}',
    '/user/lookup?userId={id}',
    '/discord/{id}',
    // explicit public without version prefix
    '/public/discord/{id}'
  );
  
  // Legacy guild-scoped endpoints (lower priority)
  if (opts?.guildId) {
    candidatePaths.push(
      '/v4/guilds/{gid}/discord/{id}',
      '/v3/guilds/{gid}/discord/{id}',
      '/guilds/{gid}/discord/{id}',
      '/v4/guilds/{gid}/users/{id}',
      '/v3/guilds/{gid}/users/{id}'
    );
  }

  const attempts: URL[] = [];
  for (const p of candidatePaths) {
    const withIds = p.replace('{id}', encodeURIComponent(discordId)).replace('{gid}', encodeURIComponent(opts?.guildId ?? ''));
    const url = new URL(withIds, origin);
    if (opts?.guildId && url.search) url.searchParams.set('guildId', opts.guildId);
    logger.info({ url: url.toString() }, '[Bloxlink] candidate URL');
    attempts.push(url);
    // For public endpoints, also try the public.blox.link host with versioned and versionless paths
    if (/\/public\//.test(url.pathname) || /^\/public\//.test(url.pathname)) {
      try {
        const u1 = new URL(url.toString());
        u1.hostname = 'public.blox.link';
        // Try versioned without '/public'
        const u2 = new URL(u1.toString());
        u2.pathname = u2.pathname.replace(/\/public\//, '/'); // e.g., /v4/public/discord -> /v4/discord
        logger.info({ url: u2.toString() }, '[Bloxlink] candidate URL');
        attempts.push(u2);
        // And also versionless on public host
        const u3 = new URL(u1.toString());
        u3.pathname = u3.pathname
          .replace(/\/v4\/public\//, '/discord/')
          .replace(/^\/public\//, '/discord/');
        // Ensure path matches /discord/{id}
        if (!/\/discord\//.test(u3.pathname)) {
          u3.pathname = `/discord/${encodeURIComponent(discordId)}`;
        }
        logger.info({ url: u3.toString() }, '[Bloxlink] candidate URL');
        attempts.push(u3);
      } catch (e) {
        logger.debug({ err: (e as Error)?.message }, '[Bloxlink] public host variant generation failed (non-fatal)');
      }
    }
  }

  let lastErr: unknown = null;
  let all404 = true; // assume all 404 until we see a non-404
  for (const url of attempts) {
    try {
      const res = await requestJson(url);
      if (res.status === 404) {
        logger.info({ url: url.toString() }, '[Bloxlink] 404 at endpoint, will try next');
        // keep all404 true for this endpoint and continue trying others
        continue;
      } else {
        all404 = false;
      }
      if (res.status === 429) {
        throw new AppError('Rate limited by Bloxlink', { code: 'BLOXLINK_429', status: 429 });
      }
      if (!res.ok) {
        const text = await res.text();
        logger.info({ url: url.toString(), status: res.status, body: text?.slice(0, 400) }, '[Bloxlink] non-OK response');
        throw new AppError(`Bloxlink error: ${res.status} ${text}`, { code: 'BLOXLINK_ERROR', status: res.status });
      }
      const data = (await res.json()) as any;
      const mapped = mapLookup(data);
      // Lightweight debug for development troubleshooting (promoted to info)
      logger.info({ url: url.toString() }, '[Bloxlink] matched endpoint');
      logger.info({ parsed: { linked: mapped.linked, robloxUsername: mapped.robloxUsername, robloxId: mapped.robloxId } }, '[Bloxlink] parsed');
      if (!mapped.linked) logger.info({ sample: JSON.stringify(data)?.slice(0, 400) }, '[Bloxlink] raw sample (truncated)');
      return mapped;
    } catch (e) {
      lastErr = e;
      logger.info({ error: (e as Error)?.message, url: url.toString() }, '[Bloxlink] attempt failed, trying next');
      // try next variant
    }
  }
  // If all attempts failed with non-404
  if (all404) return { linked: false };
  if (lastErr instanceof AppError) throw lastErr;
  throw new AppError('Bloxlink lookup failed', { code: 'BLOXLINK_FAILED' });
}

export async function getRobloxUsername(discordId: string, opts?: { guildId?: string }): Promise<string | null> {
  try {
    if (config.NODE_ENV !== 'production') logger.debug({ discordId, guildId: opts?.guildId }, '[Bloxlink] getRobloxUsername start');
    const result = await pRetry(() => fetchLookup(discordId, opts), {
      retries: 3,
      onFailedAttempt: (err) => {
        if ((err as any)?.status === 404) throw new AbortError(err as any);
      },
      minTimeout: 500,
      factor: 2,
      randomize: true,
    });
    if (!result.linked) return null;
    // Prefer username returned by Bloxlink
    if (result.robloxUsername) return result.robloxUsername;
    // If only robloxId is present, resolve username from Roblox API as a best-effort
    if (result.robloxId) {
      const resolved = await resolveRobloxUsername(result.robloxId);
      if (resolved) return resolved;
      // Fallback if resolve failed
      return `Roblox ID: ${result.robloxId}`;
    }
    return null;
  } catch (e) {
    if (e instanceof AbortError) return null;
    logger.error({ err: e }, '[Bloxlink] lookup error');
    return null; // gracefully fallback
  }
}

// Return both Roblox username and id for display purposes
export async function getRobloxInfo(discordId: string, opts?: { guildId?: string }): Promise<{ username: string | null; id: string | null; linked: boolean }>
{
  try {
    if (config.NODE_ENV !== 'production') logger.debug({ discordId, guildId: opts?.guildId }, '[Bloxlink] getRobloxInfo start');
    const result = await pRetry(() => fetchLookup(discordId, opts), {
      retries: 3,
      onFailedAttempt: (err) => {
        if ((err as any)?.status === 404) throw new AbortError(err as any);
      },
      minTimeout: 500,
      factor: 2,
      randomize: true,
    });
    if (!result.linked) return { username: null, id: null, linked: false };
    let username: string | null = result.robloxUsername ?? null;
    const id: string | null = result.robloxId ?? null;
    if (!username && id) {
      username = await resolveRobloxUsername(id);
    }
    return { username, id, linked: Boolean(username || id) };
  } catch (e) {
    if (e instanceof AbortError) return { username: null, id: null, linked: false };
    logger.error({ err: e }, '[Bloxlink] info error');
    return { username: null, id: null, linked: false };
  }
}

// Best-effort resolver for Roblox username given a Roblox user ID using public Roblox API
async function resolveRobloxUsername(robloxId: string): Promise<string | null> {
  try {
    const url = new URL(`https://users.roblox.com/v1/users/${encodeURIComponent(robloxId)}`);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      logger.info({ status: res.status }, '[Roblox] username resolve failed');
      return null;
    }
    const body: any = await res.json();
    const display: string | undefined = body?.displayName ?? body?.DisplayName;
    const name: string | undefined = body?.name ?? body?.Username ?? body?.user?.name;
    return (display || name) ?? null;
  } catch (e) {
    logger.info({ err: (e as Error)?.message }, '[Roblox] username resolve error');
    return null;
  }
}
