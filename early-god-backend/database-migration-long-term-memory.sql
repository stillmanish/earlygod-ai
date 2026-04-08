-- Long-Term Memory System for Neon PostgreSQL
-- Stores important game events (boss defeats, items obtained, locations reached)
-- This persists across sessions and backend restarts

CREATE TABLE IF NOT EXISTS long_term_memory (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    game_title VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'boss', 'location', 'quest', 'item', 'death', 'level'
    event_type VARCHAR(50), -- 'defeated', 'reached', 'obtained', 'completed', 'died_to', 'reached_level'
    entity_name VARCHAR(255), -- Boss name, location name, item name, etc.
    context TEXT, -- Brief description from conversation
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_long_term_game ON long_term_memory(game_title, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_long_term_category ON long_term_memory(game_title, category, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_long_term_entity ON long_term_memory(game_title, entity_name);
CREATE INDEX IF NOT EXISTS idx_long_term_user ON long_term_memory(user_id, game_title);

-- Example data:
-- INSERT INTO long_term_memory (game_title, category, event_type, entity_name, context)
-- VALUES ('Elden Ring', 'boss', 'defeated', 'Margit the Fell Omen', 'User defeated Margit after 5 attempts');
