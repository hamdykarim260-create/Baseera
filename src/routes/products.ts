import { Hono } from 'hono';
import { z } from 'zod';
import { getProvider } from '../providers';
import type { Env } from '../types/env';

export const productsRoute = new Hono<{ Bindings: Env }>();

const searchQuerySchema = z.object({
  query: z.string().default(''),
  marketplace: z.string().default('amazon_eg'),
});

// GET /api/products/search?query=سماعة&marketplace=amazon_eg
productsRoute.get('/search', async (c) => {
  const parsed = searchQuerySchema.safeParse({
    query: c.req.query('query'),
    marketplace: c.req.query('marketplace'),
  });

  if (!parsed.success) {
    return c.json(
      { success: false, data: null, error: { code: 'INVALID_INPUT', message: 'باراميترز البحث غير صحيحة' } },
      400
    );
  }

  const provider = getProvider(c.env);
  const results = await provider.searchProducts({
    query: parsed.data.query,
    marketplace_code: parsed.data.marketplace,
  });

  // Response shape follows the brief's §51 standard envelope exactly.
  return c.json({ success: true, data: results, error: null, meta: { count: results.length } });
});
