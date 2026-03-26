ALTER TABLE properties
ADD COLUMN IF NOT EXISTS ruian_address_code BIGINT,
ADD COLUMN IF NOT EXISTS geocode_source TEXT,
ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_properties_ruian_address_code ON properties(ruian_address_code);
