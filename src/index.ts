import { Hono } from 'hono';
import type { Env } from './types/env';
import { productsRoute } from './routes/products';

const app = new Hono<{ Bindings: Env }>();

// A health check costs nothing to build and tells you instantly whether the
// Worker is even running, before debugging anything more complex.
app.get('/health', (c) => c.json({ success: true, data: { status: 'ok' }, error: null }));

app.route('/api/products', productsRoute);

export default app;
