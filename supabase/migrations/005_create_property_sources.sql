CREATE TABLE IF NOT EXISTS property_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_url TEXT,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_property_sources_property_id ON property_sources(property_id);
CREATE INDEX IF NOT EXISTS idx_property_sources_source ON property_sources(source);
