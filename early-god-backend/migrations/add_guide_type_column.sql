-- Migration: Add guide_type column to guides table
-- Date: 2026-01-05
-- Description: Adds guide_type column to support guide type classification (walkthrough, tips, builds, etc.)

-- Add the column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='guides'
        AND column_name='guide_type'
    ) THEN
        ALTER TABLE guides ADD COLUMN guide_type VARCHAR(50) DEFAULT 'tips';
        RAISE NOTICE 'Column guide_type added successfully';
    ELSE
        RAISE NOTICE 'Column guide_type already exists';
    END IF;
END $$;

-- Update any existing guides that have NULL guide_type to default 'tips'
UPDATE guides SET guide_type = 'tips' WHERE guide_type IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_guides_guide_type ON guides(guide_type);

-- Verify the migration
SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'guides'
AND column_name = 'guide_type';
