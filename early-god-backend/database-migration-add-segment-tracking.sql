-- Migration: Add segment tracking columns for real-time progress bar
-- Date: 2025-12-29
-- Purpose: Track video processing progress by segments/chunks

-- Add columns to guides table
ALTER TABLE guides 
ADD COLUMN IF NOT EXISTS total_segments INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS processed_segments INTEGER DEFAULT 0;

-- Create index for querying processing progress
CREATE INDEX IF NOT EXISTS idx_guides_processing_progress ON guides(processing_status, processed_segments, total_segments);

-- Update existing guides to have default values (already processed = 100%)
UPDATE guides 
SET total_segments = 1, processed_segments = 1 
WHERE processing_status = 'completed' AND total_segments IS NULL;

COMMENT ON COLUMN guides.total_segments IS 'Total number of video segments/chunks to process';
COMMENT ON COLUMN guides.processed_segments IS 'Number of segments/chunks completed so far';

