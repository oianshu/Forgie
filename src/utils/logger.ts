import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  redact: {
    paths: [
      'DISCORD_TOKEN',
      'APPWRITE_API_KEY',
      'BLOXLINK_API_KEY',
      'headers.authorization',
      'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
