-- Migration Script: Add Enhanced Guide Step Fields
-- This script adds the new visual_cues and strategic_context fields to the steps table
-- Run this on existing databases to enable the enhanced guide processing features

-- Add visual_cues column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'steps' AND column_name = 'visual_cues'
    ) THEN
        ALTER TABLE steps ADD COLUMN visual_cues TEXT;
        RAISE NOTICE 'Added visual_cues column to steps table';
    ELSE
        RAISE NOTICE 'visual_cues column already exists';
    END IF;
END $$;

-- Add strategic_context column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'steps' AND column_name = 'strategic_context'
    ) THEN
        ALTER TABLE steps ADD COLUMN strategic_context TEXT;
        RAISE NOTICE 'Added strategic_context column to steps table';
    ELSE
        RAISE NOTICE 'strategic_context column already exists';
    END IF;
END $$;

-- Update existing steps with placeholder values for visual_cues (using observe field as fallback)
UPDATE steps 
SET visual_cues = COALESCE(observe, 'Visual cues not yet extracted - guide needs reprocessing')
WHERE visual_cues IS NULL;

-- Update existing steps with placeholder values for strategic_context
UPDATE steps 
SET strategic_context = 'Strategic context not yet extracted - guide needs reprocessing'
WHERE strategic_context IS NULL OR strategic_context = '';

-- Display summary
SELECT 
    'Migration Complete' as status,
    COUNT(*) as total_steps,
    COUNT(CASE WHEN visual_cues LIKE '%not yet extracted%' THEN 1 END) as needs_reprocessing
FROM steps;

-- Instructions for next steps
DO $$ 
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'NEXT STEPS:';
    RAISE NOTICE '1. Existing guides will work but have placeholder values';
    RAISE NOTICE '2. To get enhanced details, reprocess guides by:';
    RAISE NOTICE '   - Deleting the guide record (will trigger auto-reprocessing)';
    RAISE NOTICE '   - Or manually calling the /add-guide endpoint again';
    RAISE NOTICE '3. New guides will automatically use the enhanced processing';
    RAISE NOTICE '=================================================================';
END $$;

