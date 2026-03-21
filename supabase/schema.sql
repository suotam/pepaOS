-- Clients table
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  owner TEXT
);

-- Leads table
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  source_channel TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT
);

-- Properties table
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  address TEXT NOT NULL,
  locality TEXT,
  property_type TEXT,
  status TEXT,
  asking_price NUMERIC,
  reconstruction_status TEXT,
  renovation_notes TEXT,
  structural_modifications TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Deals table
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id),
  client_id UUID REFERENCES clients(id),
  stage TEXT,
  amount NUMERIC,
  closed_at TIMESTAMP WITH TIME ZONE
);

-- Calendar events table
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  end_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Workflows table
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT,
  schedule TEXT,
  config_json JSONB,
  status TEXT
);

-- Outputs table
CREATE TABLE outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT,
  title TEXT,
  content_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent logs table
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_prompt TEXT NOT NULL,
  detected_intent TEXT,
  tools_used JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);