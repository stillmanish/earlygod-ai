-- Event-Driven Memory System Schema
-- SQLite database for short-term and long-term memory storage

-- Short-term: Last N conversation turns (cleared after session)
CREATE TABLE IF NOT EXISTS short_term_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    game_title TEXT NOT NULL,
    user_message TEXT,
    ai_response TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_short_term_session ON short_term_memory(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_short_term_game ON short_term_memory(game_title, timestamp DESC);

-- Long-term: Event-based storage (persistent) with conflict resolution
CREATE TABLE IF NOT EXISTS long_term_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_title TEXT NOT NULL,
    category TEXT NOT NULL, -- 'boss', 'location', 'quest', 'weapon', 'build', 'item', 'floor', 'skill', etc.
    event_type TEXT, -- 'defeated', 'reached', 'obtained', 'started', 'completed', 'unlocked'
    entity_name TEXT, -- Boss name, location name, item name, etc.
    context TEXT, -- Original conversation snippet
    metadata JSON, -- Additional structured data
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'conversation', -- 'conversation', 'screen', 'manual'
    
    -- Conflict resolution fields
    confidence REAL DEFAULT 1.0, -- 0.0-1.0 confidence score
    is_active INTEGER DEFAULT 1, -- 0 = superseded/outdated, 1 = current
    superseded_by INTEGER REFERENCES long_term_events(id), -- Points to newer event that replaced this
    validation_method TEXT, -- 'regex', 'gemini', 'manual'
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_long_term_game_category ON long_term_events(game_title, category, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_long_term_active ON long_term_events(game_title, is_active, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_long_term_entity ON long_term_events(game_title, entity_name, is_active);

-- Session state: Last known state for resume
CREATE TABLE IF NOT EXISTS session_state (
    game_title TEXT PRIMARY KEY,
    last_session_id TEXT,
    last_played DATETIME,
    last_location TEXT,
    last_level INTEGER,
    last_objective TEXT,
    screen_state JSON, -- Last extracted screen data (health, resources, etc.)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User preferences (global)
CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT, -- 'ui', 'audio', 'gameplay', etc.
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_preferences_category ON user_preferences(category);

