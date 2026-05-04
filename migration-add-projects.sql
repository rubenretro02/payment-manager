-- =============================================
-- MIGRATION: Add projects/clients table
-- =============================================
-- Run this SQL in Supabase SQL Editor

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add project_id column to accounts if not exists
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Create index for project_id
CREATE INDEX IF NOT EXISTS idx_accounts_project_id ON accounts(project_id);

-- Enable RLS on projects table
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Create policy for projects
CREATE POLICY "Allow all for authenticated" ON projects FOR ALL USING (true);

-- Insert some default projects (SafeRide, Teladoc, Agero, etc.)
INSERT INTO projects (name, display_name, description) VALUES
    ('saferide', 'SafeRide', 'SafeRide Health - Medical transportation'),
    ('teladoc', 'Teladoc', 'Teladoc Health - Telehealth services'),
    ('agero', 'Agero', 'Agero - Roadside assistance'),
    ('ttec', 'TTEC', 'TTEC - Customer experience technology'),
    ('conduent', 'Conduent', 'Conduent - Business process services')
ON CONFLICT (name) DO NOTHING;

-- Verify the table and columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'projects';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'project_id';
