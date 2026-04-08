-- Migration: Add game maps and checkpoint positions tables
-- Run this on your Neon PostgreSQL database

-- ========================================
-- TABLE: game_maps
-- Stores map images and metadata per game
-- ========================================
CREATE TABLE IF NOT EXISTS game_maps (
    id SERIAL PRIMARY KEY,
    game_title VARCHAR(255) UNIQUE NOT NULL,
    map_image_url TEXT NOT NULL,
    map_width INTEGER DEFAULT 2304,
    map_height INTEGER DEFAULT 2304,
    source_url TEXT,
    source_attribution TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- TABLE: checkpoint_positions
-- Stores checkpoint locations on the map
-- ========================================
CREATE TABLE IF NOT EXISTS checkpoint_positions (
    id SERIAL PRIMARY KEY,
    game_title VARCHAR(255) NOT NULL,
    checkpoint_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    x_position FLOAT NOT NULL,              -- Position as percentage (0-100)
    y_position FLOAT NOT NULL,              -- Position as percentage (0-100)
    region VARCHAR(255),                    -- Game region/area name
    checkpoint_type VARCHAR(50) DEFAULT 'location',  -- 'expedition_flag', 'bonfire', 'location', 'boss', 'fast_travel'
    adjacent_checkpoints TEXT[],            -- Array of connected checkpoint names
    is_main_story BOOLEAN DEFAULT FALSE,    -- Is this part of main progression?
    sort_order INTEGER DEFAULT 0,           -- Order in progression
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_title, checkpoint_name)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_checkpoint_game ON checkpoint_positions(game_title);
CREATE INDEX IF NOT EXISTS idx_checkpoint_region ON checkpoint_positions(game_title, region);
CREATE INDEX IF NOT EXISTS idx_game_maps_title ON game_maps(game_title);

-- ========================================
-- SEED DATA: Clair Obscur: Expedition 33
-- ========================================

-- Insert map for Expedition 33
INSERT INTO game_maps (game_title, map_image_url, map_width, map_height, source_url, source_attribution)
VALUES (
    'Clair Obscur: Expedition 33',
    'https://images.steamusercontent.com/ugc/41204317368744841/918255F55CF67C5DC59812E2D690042CEF1BBE5B/',
    2304,
    2304,
    'https://steamcommunity.com/sharedfiles/filedetails/?id=3469490030',
    'Steam Community / Gamer Guides'
)
ON CONFLICT (game_title) DO UPDATE SET
    map_image_url = EXCLUDED.map_image_url,
    updated_at = CURRENT_TIMESTAMP;

-- Insert checkpoint positions for Expedition 33
-- Coordinates are percentages (0-100) based on gmtreks.com normalized data
-- Using approximate positions based on game progression and map layout

-- Main Story Locations (roughly in order)
INSERT INTO checkpoint_positions (game_title, checkpoint_name, display_name, x_position, y_position, region, checkpoint_type, is_main_story, sort_order, adjacent_checkpoints)
VALUES
    -- Starting Area
    ('Clair Obscur: Expedition 33', 'lumiere_prologue', 'Lumiere (Prologue)', 50.0, 85.0, 'Lumiere', 'location', TRUE, 1, ARRAY['spring_meadows']),

    -- Act 1 Progression
    ('Clair Obscur: Expedition 33', 'spring_meadows', 'Spring Meadows', 45.0, 70.0, 'Spring Meadows', 'location', TRUE, 2, ARRAY['lumiere_prologue', 'flying_waters', 'camp']),
    ('Clair Obscur: Expedition 33', 'camp', 'Camp', 48.0, 65.0, 'Camp', 'fast_travel', TRUE, 3, ARRAY['spring_meadows', 'ancient_sanctuary']),
    ('Clair Obscur: Expedition 33', 'flying_waters', 'Flying Waters', 35.0, 60.0, 'Flying Waters', 'location', TRUE, 4, ARRAY['spring_meadows', 'ancient_sanctuary']),
    ('Clair Obscur: Expedition 33', 'ancient_sanctuary', 'Ancient Sanctuary', 40.0, 55.0, 'Ancient Sanctuary', 'location', TRUE, 5, ARRAY['flying_waters', 'gestral_village']),
    ('Clair Obscur: Expedition 33', 'gestral_village', 'Gestral Village', 55.0, 50.0, 'Gestral Village', 'location', TRUE, 6, ARRAY['ancient_sanctuary', 'esquies_nest']),
    ('Clair Obscur: Expedition 33', 'esquies_nest', 'Esquie''s Nest', 60.0, 45.0, 'Esquie''s Nest', 'location', TRUE, 7, ARRAY['gestral_village', 'stone_wave_cliffs']),

    -- Act 2 Progression
    ('Clair Obscur: Expedition 33', 'stone_wave_cliffs', 'Stone Wave Cliffs', 65.0, 40.0, 'Stone Wave Cliffs', 'location', TRUE, 8, ARRAY['esquies_nest', 'forgotten_battlefield']),
    ('Clair Obscur: Expedition 33', 'forgotten_battlefield', 'Forgotten Battlefield', 70.0, 35.0, 'Forgotten Battlefield', 'location', TRUE, 9, ARRAY['stone_wave_cliffs', 'monocos_station']),
    ('Clair Obscur: Expedition 33', 'monocos_station', 'Monoco''s Station', 60.0, 30.0, 'Monoco''s Station', 'location', TRUE, 10, ARRAY['forgotten_battlefield', 'old_lumiere']),
    ('Clair Obscur: Expedition 33', 'old_lumiere', 'Old Lumiere', 50.0, 25.0, 'Old Lumiere', 'location', TRUE, 11, ARRAY['monocos_station', 'visages']),

    -- Act 3 Progression
    ('Clair Obscur: Expedition 33', 'visages', 'Visages', 40.0, 20.0, 'Visages', 'location', TRUE, 12, ARRAY['old_lumiere', 'sirene']),
    ('Clair Obscur: Expedition 33', 'sirene', 'Sirene', 30.0, 25.0, 'Sirene', 'location', TRUE, 13, ARRAY['visages', 'the_monolith']),
    ('Clair Obscur: Expedition 33', 'the_monolith', 'The Monolith', 25.0, 35.0, 'The Monolith', 'location', TRUE, 14, ARRAY['sirene', 'lumiere_finale']),
    ('Clair Obscur: Expedition 33', 'lumiere_finale', 'Lumiere (Finale)', 50.0, 85.0, 'Lumiere', 'location', TRUE, 15, ARRAY['the_monolith', 'the_manor']),

    -- Epilogue
    ('Clair Obscur: Expedition 33', 'the_manor', 'The Manor', 75.0, 50.0, 'The Manor', 'location', TRUE, 16, ARRAY['lumiere_finale']),

    -- Optional Areas (scattered around the map)
    ('Clair Obscur: Expedition 33', 'crimson_forest', 'Crimson Forest', 25.0, 55.0, 'Crimson Forest', 'location', FALSE, 100, ARRAY['flying_waters']),
    ('Clair Obscur: Expedition 33', 'dark_shores', 'Dark Shores', 15.0, 45.0, 'Dark Shores', 'location', FALSE, 101, ARRAY['crimson_forest']),
    ('Clair Obscur: Expedition 33', 'endless_tower', 'Endless Tower', 80.0, 60.0, 'Endless Tower', 'location', FALSE, 102, ARRAY['stone_wave_cliffs']),
    ('Clair Obscur: Expedition 33', 'flying_casino', 'Flying Casino', 85.0, 40.0, 'Flying Casino', 'location', FALSE, 103, ARRAY['forgotten_battlefield']),
    ('Clair Obscur: Expedition 33', 'lost_woods', 'Lost Woods', 20.0, 65.0, 'Lost Woods', 'location', FALSE, 104, ARRAY['spring_meadows']),
    ('Clair Obscur: Expedition 33', 'white_sands', 'White Sands', 10.0, 70.0, 'White Sands', 'location', FALSE, 105, ARRAY['lost_woods']),
    ('Clair Obscur: Expedition 33', 'esoteric_ruins', 'Esoteric Ruins', 75.0, 25.0, 'Esoteric Ruins', 'location', FALSE, 106, ARRAY['old_lumiere']),
    ('Clair Obscur: Expedition 33', 'yellow_harvest', 'Yellow Harvest', 55.0, 60.0, 'Yellow Harvest', 'location', FALSE, 107, ARRAY['gestral_village', 'spring_meadows']),
    ('Clair Obscur: Expedition 33', 'abbest_cave', 'Abbest Cave', 30.0, 45.0, 'Abbest Cave', 'location', FALSE, 108, ARRAY['sirene']),
    ('Clair Obscur: Expedition 33', 'sky_island', 'Sky Island', 45.0, 15.0, 'Sky Island', 'location', FALSE, 109, ARRAY['visages'])
ON CONFLICT (game_title, checkpoint_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    x_position = EXCLUDED.x_position,
    y_position = EXCLUDED.y_position,
    region = EXCLUDED.region,
    checkpoint_type = EXCLUDED.checkpoint_type,
    is_main_story = EXCLUDED.is_main_story,
    sort_order = EXCLUDED.sort_order,
    adjacent_checkpoints = EXCLUDED.adjacent_checkpoints;

-- ========================================
-- HELPFUL QUERIES
-- ========================================

-- Get map and all checkpoints for a game:
-- SELECT m.*, cp.*
-- FROM game_maps m
-- LEFT JOIN checkpoint_positions cp ON m.game_title = cp.game_title
-- WHERE m.game_title = 'Clair Obscur: Expedition 33'
-- ORDER BY cp.sort_order;

-- Get visited checkpoints (join with long_term_memory):
-- SELECT cp.*, ltm.timestamp as visited_at
-- FROM checkpoint_positions cp
-- LEFT JOIN long_term_memory ltm ON cp.game_title = ltm.game_title
--     AND (LOWER(cp.checkpoint_name) = LOWER(ltm.entity_name)
--          OR LOWER(cp.display_name) = LOWER(ltm.entity_name))
-- WHERE cp.game_title = 'Clair Obscur: Expedition 33';
