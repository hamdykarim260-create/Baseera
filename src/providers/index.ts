// This is the ONE place in the whole app that decides "which data provider
// are we actually using right now". Every route imports getProvider(env)
// instead of importing MockProvider or ApifyProvider directly — so this
// file is the only thing that needs to change when we add a real provider,
// or when production must never accidentally use mock data.

import type { DataProvider } from './types';
import { MockProvider } from './mock-provider';
import type { Env } from '../types/env';

export function getProvider(env: Env): DataProvider {
  if (env.ENVIRONMENT === 'production') {
    // ApifyProvider isn't built yet — this throws on purpose rather than
    // silently falling back to fake data in production (brief §60).
    throw new Error('ApifyProvider not implemented yet — cannot run in production without it.');
  }
  return new MockProvider();
}
