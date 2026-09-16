// This describes what's available inside every Worker request — the D1
// database, the KV cache, and secret API keys. Wrangler injects the real
// values at runtime based on wrangler.toml + `wrangler secret put`.
//
// Think of this as the Worker's equivalent of `process.env` in Node, but
// typed and explicit instead of a loose object.

export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  JOB_QUEUE: Queue;
  APIFY_API_TOKEN: string;
  OPENROUTER_API_KEY: string;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
};
