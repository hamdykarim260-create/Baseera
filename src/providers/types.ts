// DataProvider — the contract every marketplace data source must follow.
//
// WHY THIS EXISTS (plain terms):
// Right now, the plan is to get marketplace data from Apify. Later it might
// be a different scraping service, or a direct API, or something else. If
// the rest of the app calls Apify directly everywhere, switching providers
// later means rewriting the whole app. Instead, everything in Baseera talks
// to "a DataProvider" — it doesn't know or care if that's Apify, a mock, or
// something else. Swapping the provider becomes a one-line config change.
//
// This is called an "interface" in TypeScript: it's a contract, not code.
// It says "anything that claims to be a DataProvider MUST have these
// methods, with these inputs and outputs" — but doesn't say how.

export type NormalizedProduct = {
  external_id: string;       // ASIN / SKU / marketplace's own product ID
  title: string;
  category: string | null;
  brand: string | null;
  price_minor: number | null; // price in minor units (piastres/halalas/fils), not float
  currency: string | null;
  rating: number | null;
  reviews_count: number | null;
  image_url: string | null;
  raw_url: string | null;
};

export type SearchProductsParams = {
  query: string;
  marketplace_code: string; // 'amazon_eg' | 'amazon_sa' | 'amazon_ae' | ...
  max_results?: number;
};

export interface DataProvider {
  // Search for products matching a keyword/category on one marketplace.
  searchProducts(params: SearchProductsParams): Promise<NormalizedProduct[]>;

  // Fetch the current state of a single known product.
  getProduct(externalId: string, marketplaceCode: string): Promise<NormalizedProduct | null>;

  // Fetch competitor listings for a product (used by Competitor Analysis, Phase 2).
  getCompetitors(externalId: string, marketplaceCode: string): Promise<NormalizedProduct[]>;
}
