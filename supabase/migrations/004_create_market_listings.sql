CREATE TABLE IF NOT EXISTS market_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  listing_type TEXT DEFAULT 'sale',
  property_category TEXT,
  title TEXT NOT NULL,
  price_text TEXT,
  price_numeric NUMERIC,
  currency TEXT DEFAULT 'CZK',
  location TEXT,
  city TEXT,
  district TEXT,
  address TEXT,
  url TEXT NOT NULL,
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_market_listings_source ON market_listings(source);
CREATE INDEX IF NOT EXISTS idx_market_listings_category ON market_listings(property_category);
CREATE INDEX IF NOT EXISTS idx_market_listings_city ON market_listings(city);
CREATE INDEX IF NOT EXISTS idx_market_listings_district ON market_listings(district);
CREATE INDEX IF NOT EXISTS idx_market_listings_price_numeric ON market_listings(price_numeric);
CREATE INDEX IF NOT EXISTS idx_market_listings_last_seen_at ON market_listings(last_seen_at DESC);
