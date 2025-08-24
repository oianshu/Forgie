export class AppError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;
  public readonly status?: number;

  constructor(message: string, options?: { code?: string; cause?: unknown; status?: number }) {
    super(message);
    this.name = 'AppError';
    this.code = options?.code ?? 'APP_ERROR';
    this.cause = options?.cause;
    this.status = options?.status;
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AppError(message, { code: 'ASSERTION_FAILED' });
}
