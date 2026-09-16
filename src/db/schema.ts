// Baseera — D1 schema (Drizzle ORM, SQLite dialect)
//
// Design notes (senior call-outs, not explicitly spelled out in the brief):
//
// 1. GLOBAL vs PRIVATE data separation (brief §69, §70):
//    marketplace_products / product_snapshots / product_prices / competitors are
//    GLOBAL — shared across every organization. If two sellers both research the
//    same ASIN, we scrape it once and both read the same snapshot. This is the
//    single biggest cost lever in the whole system (brief §70 "smart scraping").
//    saved_products / analyses / ai_conversations are PRIVATE — scoped to org_id.
//
// 2. Every table that holds a metric/analysis carries `confidence` and/or
//    `data_freshness` columns rather than bolting that on later — §46 and §22
//    both treat these as first-class, and retrofitting them onto a live table
//    is painful.
//
// 3. `fee_rules` is versioned (effective_from / effective_to), never mutated in
//    place — §79 explicitly requires this so historical profit calculations
//    don't silently change when a marketplace changes its commission.
//
// 4. Money is stored as integer minor units (piastres/halalas/fils), not float,
//    to avoid floating-point drift in profit calculations. `currency` is an
//    ISO 4217 code stored alongside every money column.
//
// 5. Nothing here is Phase-gated at the schema level — brief §63 says Phase 2/3
//    architecture must exist even if the application logic doesn't use it yet.
//    Feature flags (feature_flags table) control what's *active*, not what
//    tables exist.

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = {
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
  updated_at: text('updated_at').notNull().default(sql`(current_timestamp)`),
};

// ---------------------------------------------------------------------------
// 1. IDENTITY & TENANCY
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull(),
  password_hash: text('password_hash'), // null if using an external auth provider
  name: text('name'),
  preferred_language: text('preferred_language').default('ar'), // 'ar' | 'en'
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
}, (t) => ({
  emailUnique: uniqueIndex('users_email_unique').on(t.email),
}));

export const sessions = sqliteTable('sessions', {
  id: id(),
  user_id: text('user_id').notNull().references(() => users.id),
  token_hash: text('token_hash').notNull(),
  expires_at: text('expires_at').notNull(),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  tokenIdx: uniqueIndex('sessions_token_hash_unique').on(t.token_hash),
  userIdx: index('sessions_user_idx').on(t.user_id),
}));

export const organizations = sqliteTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  default_marketplace_code: text('default_marketplace_code'), // e.g. 'amazon_eg'
  default_currency: text('default_currency').default('EGP'),
  ...timestamps,
});

export const memberships = sqliteTable('memberships', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull().references(() => users.id),
  role: text('role').notNull(), // 'owner' | 'admin' | 'analyst' | 'operations' | 'viewer'
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgUserUnique: uniqueIndex('memberships_org_user_unique').on(t.organization_id, t.user_id),
  orgIdx: index('memberships_org_idx').on(t.organization_id),
}));

// ---------------------------------------------------------------------------
// 2. PLANS, SUBSCRIPTIONS & USAGE (brief §27, §28, §65)
// ---------------------------------------------------------------------------

export const plans = sqliteTable('plans', {
  id: id(),
  code: text('code').notNull(), // 'trial' | 'pro' | 'business'
  name: text('name').notNull(),
  price_minor: integer('price_minor').notNull().default(0),
  currency: text('currency').notNull().default('EGP'),
  limits: text('limits', { mode: 'json' }).notNull(), // { ai_calls_per_month, research_requests, ... }
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
}, (t) => ({
  codeUnique: uniqueIndex('plans_code_unique').on(t.code),
}));

export const subscriptions = sqliteTable('subscriptions', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  plan_id: text('plan_id').notNull().references(() => plans.id),
  status: text('status').notNull(), // 'trialing' | 'active' | 'past_due' | 'cancelled'
  trial_ends_at: text('trial_ends_at'),
  current_period_end: text('current_period_end'),
  billing_provider: text('billing_provider'), // null until real billing exists (§66)
  billing_provider_ref: text('billing_provider_ref'),
  ...timestamps,
}, (t) => ({
  orgIdx: index('subscriptions_org_idx').on(t.organization_id),
}));

// Every billable/limitable action increments this. Quota checks aggregate
// over a rolling window rather than reading a mutable counter, so usage is
// always reconstructable/auditable (ties into audit_logs, §54).
export const usage_events = sqliteTable('usage_events', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').references(() => users.id),
  feature: text('feature').notNull(), // 'ai_call' | 'research_request' | 'analysis' | 'export' | ...
  quantity: integer('quantity').notNull().default(1),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgFeatureIdx: index('usage_events_org_feature_idx').on(t.organization_id, t.feature, t.created_at),
}));

// ---------------------------------------------------------------------------
// 3. MARKETPLACES (global reference data)
// ---------------------------------------------------------------------------

export const marketplaces = sqliteTable('marketplaces', {
  id: id(),
  code: text('code').notNull(), // 'amazon_eg' | 'amazon_sa' | 'amazon_ae' | 'noon_eg' | 'jumia_eg'
  name: text('name').notNull(),
  country: text('country').notNull(), // ISO 3166-1 alpha-2: 'EG' | 'SA' | 'AE'
  currency: text('currency').notNull(), // 'EGP' | 'SAR' | 'AED'
  is_enabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true), // feature-flag gated
  ...timestamps,
}, (t) => ({
  codeUnique: uniqueIndex('marketplaces_code_unique').on(t.code),
}));

// Versioned fee rules — never mutate, always insert a new row (§79).
export const fee_rules = sqliteTable('fee_rules', {
  id: id(),
  marketplace_id: text('marketplace_id').notNull().references(() => marketplaces.id),
  commission_pct: real('commission_pct').notNull(),
  fulfillment_fee_minor: integer('fulfillment_fee_minor').notNull().default(0),
  shipping_fee_minor: integer('shipping_fee_minor').notNull().default(0),
  other_fees: text('other_fees', { mode: 'json' }), // { name: amount_minor }
  effective_from: text('effective_from').notNull(),
  effective_to: text('effective_to'), // null = current
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  marketplaceIdx: index('fee_rules_marketplace_idx').on(t.marketplace_id, t.effective_from),
}));

// ---------------------------------------------------------------------------
// 4. PRODUCTS — GLOBAL shared marketplace data (§69, §70)
// ---------------------------------------------------------------------------

export const marketplace_products = sqliteTable('marketplace_products', {
  id: id(),
  marketplace_id: text('marketplace_id').notNull().references(() => marketplaces.id),
  external_id: text('external_id').notNull(), // ASIN / SKU / marketplace product ID
  identity_hash: text('identity_hash').notNull(), // dedup key: marketplace_id + normalized external_id (§24)
  raw_url: text('raw_url'),
  title: text('title').notNull(),
  normalized_title: text('normalized_title'),
  category: text('category'),
  brand: text('brand'),
  image_url: text('image_url'),
  ...timestamps,
}, (t) => ({
  identityUnique: uniqueIndex('marketplace_products_identity_unique').on(t.identity_hash),
  marketplaceIdx: index('marketplace_products_marketplace_idx').on(t.marketplace_id, t.category),
}));

// Point-in-time snapshot of a product's observable state. This is the
// freshness/provenance unit referenced throughout the brief (§22, §23, §80).
export const product_snapshots = sqliteTable('product_snapshots', {
  id: id(),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  price_minor: integer('price_minor'),
  currency: text('currency'),
  rating: real('rating'),
  reviews_count: integer('reviews_count'),
  ranking: integer('ranking'),
  seller_count: integer('seller_count'),
  raw_reference: text('raw_reference'), // pointer to raw provider payload (R2 key or dataset id)
  provider: text('provider').notNull(), // 'apify' | 'manual' | ...
  normalization_version: integer('normalization_version').notNull().default(1),
  collected_at: text('collected_at').notNull(),
  freshness: text('freshness').notNull().default('fresh'), // 'fresh' | 'recent' | 'stale' | 'unavailable'
}, (t) => ({
  productIdx: index('product_snapshots_product_idx').on(t.marketplace_product_id, t.collected_at),
}));

// Dedicated price time series (separate from snapshots per §52) — lighter
// rows, queried far more often than full snapshots for price-history charts.
export const product_prices = sqliteTable('product_prices', {
  id: id(),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  price_minor: integer('price_minor').notNull(),
  currency: text('currency').notNull(),
  recorded_at: text('recorded_at').notNull(),
}, (t) => ({
  productIdx: index('product_prices_product_idx').on(t.marketplace_product_id, t.recorded_at),
}));

// Calculated metrics (demand score, competition density, etc.) kept separate
// from raw snapshots so recomputing a metric doesn't touch provider data.
export const product_metrics = sqliteTable('product_metrics', {
  id: id(),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  metric_type: text('metric_type').notNull(), // 'demand' | 'competition_density' | 'price_stability' | ...
  value: real('value').notNull(),
  computed_at: text('computed_at').notNull(),
  version: integer('version').notNull().default(1),
}, (t) => ({
  productMetricIdx: index('product_metrics_product_idx').on(t.marketplace_product_id, t.metric_type),
}));

export const competitors = sqliteTable('competitors', {
  id: id(),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  competitor_marketplace_product_id: text('competitor_marketplace_product_id').references(() => marketplace_products.id),
  price_minor: integer('price_minor'),
  rating: real('rating'),
  reviews_count: integer('reviews_count'),
  listing_quality_score: real('listing_quality_score'),
  collected_at: text('collected_at').notNull(),
}, (t) => ({
  productIdx: index('competitors_product_idx').on(t.marketplace_product_id),
}));

// ---------------------------------------------------------------------------
// 5. TRENDS (§7, §19 of the language doc, §7 of the main doc)
// ---------------------------------------------------------------------------

export const trend_queries = sqliteTable('trend_queries', {
  id: id(),
  keyword: text('keyword').notNull(),
  normalized_keyword: text('normalized_keyword'),
  marketplace_id: text('marketplace_id').references(() => marketplaces.id),
  country: text('country').notNull(),
  time_range: text('time_range').notNull(), // '30d' | '90d' | '12m'
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  keywordIdx: index('trend_queries_keyword_idx').on(t.normalized_keyword, t.country),
}));

export const trend_snapshots = sqliteTable('trend_snapshots', {
  id: id(),
  trend_query_id: text('trend_query_id').notNull().references(() => trend_queries.id),
  interest_value: real('interest_value').notNull(),
  timestamp: text('timestamp').notNull(),
  trend_direction: text('trend_direction'), // 'rising' | 'stable' | 'falling'
  trend_score: real('trend_score'),
}, (t) => ({
  queryIdx: index('trend_snapshots_query_idx').on(t.trend_query_id, t.timestamp),
}));

// ---------------------------------------------------------------------------
// 6. ANALYSIS & OPPORTUNITY SCORING (§13, §46, §47, §82 — PRIVATE, org-scoped)
// ---------------------------------------------------------------------------

export const analyses = sqliteTable('analyses', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').references(() => users.id),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  type: text('type').notNull(), // 'full' | 'quick' | 'listing_audit'
  result: text('result', { mode: 'json' }).notNull(), // structured, schema-validated (§35)
  confidence: text('confidence').notNull(), // 'high' | 'medium' | 'low'
  risk_level: text('risk_level'), // 'low' | 'medium' | 'high'
  ai_model: text('ai_model'),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgProductIdx: index('analyses_org_product_idx').on(t.organization_id, t.marketplace_product_id),
}));

// Opportunity scores are GLOBAL (computed from global product data) but
// versioned so the scoring formula can change without rewriting history (§13).
export const opportunity_scores = sqliteTable('opportunity_scores', {
  id: id(),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  score: real('score').notNull(),
  components: text('components', { mode: 'json' }).notNull(), // { demand, competition, margin, trend, price_stability, risk }
  formula_version: integer('formula_version').notNull().default(1),
  confidence: text('confidence').notNull(),
  computed_at: text('computed_at').notNull(),
}, (t) => ({
  productIdx: index('opportunity_scores_product_idx').on(t.marketplace_product_id, t.computed_at),
}));

// ---------------------------------------------------------------------------
// 7. SAVED PRODUCTS & ALERTS (PRIVATE, org-scoped — §20, §21)
// ---------------------------------------------------------------------------

export const saved_products = sqliteTable('saved_products', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull().references(() => users.id),
  marketplace_product_id: text('marketplace_product_id').notNull().references(() => marketplace_products.id),
  notes: text('notes'),
  tags: text('tags', { mode: 'json' }),
  target_cost_minor: integer('target_cost_minor'),
  target_selling_price_minor: integer('target_selling_price_minor'),
  target_margin_pct: real('target_margin_pct'),
  status: text('status').notNull().default('researching'), // researching|shortlisted|sourcing|testing|selling|rejected
  is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  orgProductUnique: uniqueIndex('saved_products_org_product_unique').on(t.organization_id, t.marketplace_product_id),
  orgIdx: index('saved_products_org_idx').on(t.organization_id, t.status),
}));

export const alerts = sqliteTable('alerts', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull().references(() => users.id),
  saved_product_id: text('saved_product_id').references(() => saved_products.id),
  type: text('type').notNull(), // 'price_change' | 'competitor_change' | 'trend_change' | 'score_change' | ...
  condition: text('condition', { mode: 'json' }).notNull(), // { operator, threshold }
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgIdx: index('alerts_org_idx').on(t.organization_id, t.is_active),
}));

export const notifications = sqliteTable('notifications', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull().references(() => users.id),
  alert_id: text('alert_id').references(() => alerts.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  is_read: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index('notifications_user_idx').on(t.user_id, t.is_read),
}));

// ---------------------------------------------------------------------------
// 8. AI COPILOT (§11, §72-§75)
// ---------------------------------------------------------------------------

export const ai_conversations = sqliteTable('ai_conversations', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').notNull().references(() => users.id),
  title: text('title'),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgIdx: index('ai_conversations_org_idx').on(t.organization_id, t.user_id),
}));

export const ai_messages = sqliteTable('ai_messages', {
  id: id(),
  conversation_id: text('conversation_id').notNull().references(() => ai_conversations.id),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  tool_calls: text('tool_calls', { mode: 'json' }), // structured record of internal tool calls (§74)
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  conversationIdx: index('ai_messages_conversation_idx').on(t.conversation_id, t.created_at),
}));

// Every AI call, full stop — this is how §10 (cost control) and §28 (usage
// metering) actually get enforced, not just displayed.
export const ai_usage = sqliteTable('ai_usage', {
  id: id(),
  organization_id: text('organization_id').notNull().references(() => organizations.id),
  user_id: text('user_id').references(() => users.id),
  feature: text('feature').notNull(), // 'copilot' | 'listing_audit' | 'opportunity_explanation' | ...
  model: text('model').notNull(),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  estimated_cost_minor: integer('estimated_cost_minor'),
  latency_ms: integer('latency_ms'),
  success: integer('success', { mode: 'boolean' }).notNull(),
  request_id: text('request_id').notNull(),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgIdx: index('ai_usage_org_idx').on(t.organization_id, t.created_at),
}));

// ---------------------------------------------------------------------------
// 9. JOBS & PROVIDER EXECUTION (§50, §30)
// ---------------------------------------------------------------------------

export const jobs = sqliteTable('jobs', {
  id: id(),
  organization_id: text('organization_id').references(() => organizations.id),
  user_id: text('user_id').references(() => users.id),
  type: text('type').notNull(), // 'product_research' | 'bulk_refresh' | 'listing_audit' | ...
  provider: text('provider'),
  status: text('status').notNull().default('queued'), // queued|running|completed|failed|cancelled
  started_at: text('started_at'),
  completed_at: text('completed_at'),
  error: text('error'),
  metadata: text('metadata', { mode: 'json' }),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgIdx: index('jobs_org_idx').on(t.organization_id, t.status),
}));

export const provider_executions = sqliteTable('provider_executions', {
  id: id(),
  job_id: text('job_id').notNull().references(() => jobs.id),
  provider: text('provider').notNull(),
  actor_id: text('actor_id'), // Apify actor ID, config-driven per §6
  status: text('status').notNull(), // 'success' | 'failed' | 'timeout'
  duration_ms: integer('duration_ms'),
  error: text('error'),
  executed_at: text('executed_at').notNull(),
}, (t) => ({
  jobIdx: index('provider_executions_job_idx').on(t.job_id),
}));

// ---------------------------------------------------------------------------
// 10. SYSTEM: audit, settings, feature flags, dictionary (§54, §61, §62, §19 lang doc)
// ---------------------------------------------------------------------------

export const audit_logs = sqliteTable('audit_logs', {
  id: id(),
  organization_id: text('organization_id').references(() => organizations.id),
  user_id: text('user_id').references(() => users.id),
  action: text('action').notNull(), // 'login' | 'plan_changed' | 'admin_config_changed' | ...
  metadata: text('metadata', { mode: 'json' }),
  created_at: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  orgIdx: index('audit_logs_org_idx').on(t.organization_id, t.created_at),
}));

export const system_settings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updated_at: text('updated_at').notNull().default(sql`(current_timestamp)`),
});

export const feature_flags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(), // 'ENABLE_TRENDS' | 'ENABLE_MARKETPLACE_NOON' | ...
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  description: text('description'),
});

// Multilingual search dictionary (language doc §19, §23)
export const market_dictionary = sqliteTable('market_dictionary', {
  id: id(),
  term: text('term').notNull(),
  normalized_term: text('normalized_term').notNull(),
  language: text('language').notNull(), // 'ar' | 'en' | 'arabizi'
  country: text('country').notNull(),
  marketplace_id: text('marketplace_id').references(() => marketplaces.id),
  category: text('category'),
  synonym_group: text('synonym_group'),
  confidence: real('confidence').notNull().default(1.0),
  status: text('status').notNull().default('active'), // 'active' | 'pending_review' | 'rejected'
  ...timestamps,
}, (t) => ({
  normalizedIdx: index('market_dictionary_normalized_idx').on(t.normalized_term, t.country),
}));
