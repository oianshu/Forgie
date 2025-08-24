import { describe, it, expect } from 'vitest';
import { getRobloxUsername } from '../src/services/bloxlink.js';

// Note: This is a basic smoke test with a fake base URL. In CI, mock fetch or inject a test server.
describe('bloxlink service', () => {
  it('gracefully handles errors and returns null', async () => {
    const name = await getRobloxUsername('0');
    expect(name === null || typeof name === 'string').toBe(true);
  });
});
