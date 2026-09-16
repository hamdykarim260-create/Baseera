// MockProvider — fake data that LOOKS like real Apify results, so we can
// build and test everything else (routes, scoring, UI) without needing a
// real Apify account or API token yet.
//
// IMPORTANT (per the brief's §60 "no fake features" and §87 "mock providers
// must be clearly separated from production"): this class is only ever
// wired in when ENVIRONMENT === 'development'. It must never run in
// production — see src/providers/index.ts for that switch.

import type { DataProvider, NormalizedProduct, SearchProductsParams } from './types';

const DEMO_PRODUCTS: NormalizedProduct[] = [
  {
    external_id: 'DEMO-EG-001',
    title: 'سماعة بلوتوث لاسلكية إلغاء ضوضاء',
    category: 'إلكترونيات',
    brand: 'SoundCore',
    price_minor: 89900, // 899.00 EGP
    currency: 'EGP',
    rating: 4.3,
    reviews_count: 1240,
    image_url: null,
    raw_url: null,
  },
  {
    external_id: 'DEMO-EG-002',
    title: 'قلاية هوائية 5 لتر',
    category: 'مطبخ',
    brand: 'Fresh',
    price_minor: 219900, // 2199.00 EGP
    currency: 'EGP',
    rating: 4.1,
    reviews_count: 610,
    image_url: null,
    raw_url: null,
  },
  {
    external_id: 'DEMO-EG-003',
    title: 'حامل موبايل مكتبي قابل للطي',
    category: 'إكسسوارات',
    brand: 'Generic',
    price_minor: 14900, // 149.00 EGP
    currency: 'EGP',
    rating: 3.9,
    reviews_count: 85,
    image_url: null,
    raw_url: null,
  },
];

export class MockProvider implements DataProvider {
  async searchProducts(params: SearchProductsParams): Promise<NormalizedProduct[]> {
    const q = params.query.trim().toLowerCase();
    if (!q) return DEMO_PRODUCTS.slice(0, params.max_results ?? 10);

    return DEMO_PRODUCTS.filter((p) => p.title.toLowerCase().includes(q)).slice(
      0,
      params.max_results ?? 10
    );
  }

  async getProduct(externalId: string): Promise<NormalizedProduct | null> {
    return DEMO_PRODUCTS.find((p) => p.external_id === externalId) ?? null;
  }

  async getCompetitors(externalId: string): Promise<NormalizedProduct[]> {
    return DEMO_PRODUCTS.filter((p) => p.external_id !== externalId).slice(0, 3);
  }
}
