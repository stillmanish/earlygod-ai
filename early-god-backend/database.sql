-- EarlyGod.ai Database Schema
-- Run this script to set up the database tables

-- Users table for Clerk authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    clerk_user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    image_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Guides table to store processed YouTube guides
CREATE TABLE IF NOT EXISTS guides (
    id SERIAL PRIMARY KEY,
    youtube_id VARCHAR(20) UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    channel_title VARCHAR(255),
    duration VARCHAR(50),
    transcript TEXT, -- Store full transcript for RAG
    guide_type VARCHAR(50) DEFAULT 'tips', -- walkthrough, tips, builds, locations, bosses, summary
    processing_status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed, partial
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Steps table to store individual guide steps
CREATE TABLE IF NOT EXISTS steps (
    id SERIAL PRIMARY KEY,
    guide_id INTEGER REFERENCES guides(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    action TEXT NOT NULL, -- GRANULAR 100-200 word detailed instructions with button presses
    visual_cues TEXT, -- RICH 80-150 word visual descriptions of UI, landmarks, colors
    observe TEXT, -- Specific success indicators
    fallback TEXT, -- Detailed troubleshooting alternatives
    resources TEXT, -- Comprehensive required items and prerequisites
    strategic_context TEXT, -- WHY this matters - 60-120 words on importance and implications
    estimated_time VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(guide_id, step_number)
);

-- User progress table to track user progress through guides
CREATE TABLE IF NOT EXISTS user_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    guide_id INTEGER REFERENCES guides(id) ON DELETE CASCADE,
    current_step INTEGER DEFAULT 1,
    completed_steps INTEGER[] DEFAULT '{}',
    started_at TIMESTAMP DEFAULT NOW(),
    last_updated TIMESTAMP DEFAULT NOW(),
    completed BOOLEAN DEFAULT FALSE,
    
    UNIQUE(user_id, guide_id)
);

-- Create indexes for better performance
-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login DESC);

-- Guides and steps indexes
CREATE INDEX IF NOT EXISTS idx_guides_youtube_id ON guides(youtube_id);
CREATE INDEX IF NOT EXISTS idx_guides_created_at ON guides(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_steps_guide_id ON steps(guide_id);
CREATE INDEX IF NOT EXISTS idx_steps_step_number ON steps(guide_id, step_number);

-- User progress indexes
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_guide_id ON user_progress(guide_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_user_guide ON user_progress(user_id, guide_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_guides_updated_at BEFORE UPDATE ON guides FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_progress_updated_at BEFORE UPDATE ON user_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- NEW TABLES FOR CLUELY-STYLE REAL-TIME GAMING ASSISTANCE

-- Gaming sessions table to track active gameplay sessions
CREATE TABLE IF NOT EXISTS gaming_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    clerk_user_id VARCHAR(255), -- Optional: direct reference to Clerk ID
    game_title VARCHAR(255),
    game_process VARCHAR(255), -- Process name for screen capture
    status VARCHAR(50) DEFAULT 'active', -- active, paused, ended
    screen_resolution VARCHAR(50), -- e.g. "1920x1080"
    capture_fps INTEGER DEFAULT 3,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT NOW()
);

-- Screen captures table to store analysis results
CREATE TABLE IF NOT EXISTS screen_captures (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES gaming_sessions(id) ON DELETE CASCADE,
    frame_timestamp TIMESTAMP DEFAULT NOW(),
    frame_data BYTEA, -- Compressed JPEG frame (optional storage)
    analysis_results JSONB, -- GPT-4o Vision analysis results
    game_state JSONB, -- Extracted game state (health, enemies, etc.)
    processing_time_ms INTEGER,
    confidence_score DECIMAL(3,2) -- 0.00 to 1.00
);

-- Audio transcriptions table for voice commands/questions
CREATE TABLE IF NOT EXISTS audio_transcriptions (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES gaming_sessions(id) ON DELETE CASCADE,
    audio_timestamp TIMESTAMP DEFAULT NOW(),
    transcription_text TEXT,
    confidence_score DECIMAL(3,2),
    intent_classification VARCHAR(100), -- question, command, casual_talk
    processing_service VARCHAR(50) DEFAULT 'deepgram', -- deepgram, openai, etc.
    processing_time_ms INTEGER
);

-- AI responses table to track AI coaching responses
CREATE TABLE IF NOT EXISTS ai_responses (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES gaming_sessions(id) ON DELETE CASCADE,
    response_timestamp TIMESTAMP DEFAULT NOW(),
    trigger_type VARCHAR(50), -- audio_question, urgent_situation, periodic_check
    context_data JSONB, -- Screen state + audio context combined
    ai_response TEXT,
    response_type VARCHAR(50), -- tactical_tip, answer, warning, encouragement
    ai_model VARCHAR(100), -- gemini-2.5-flash, gpt-4o, etc.
    processing_time_ms INTEGER,
    tts_audio_length_ms INTEGER
);

-- Game state events table for tracking important game events
CREATE TABLE IF NOT EXISTS game_events (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES gaming_sessions(id) ON DELETE CASCADE,
    event_timestamp TIMESTAMP DEFAULT NOW(),
    event_type VARCHAR(100), -- low_health, enemy_spotted, boss_phase_change, etc.
    event_data JSONB,
    urgency_level INTEGER DEFAULT 1, -- 1-5 scale
    ai_triggered BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES gaming_sessions(id) ON DELETE CASCADE,
    metric_timestamp TIMESTAMP DEFAULT NOW(),
    total_pipeline_latency_ms INTEGER,
    capture_latency_ms INTEGER,
    transcription_latency_ms INTEGER,
    vision_analysis_latency_ms INTEGER,
    ai_generation_latency_ms INTEGER,
    tts_generation_latency_ms INTEGER,
    frames_processed INTEGER DEFAULT 0,
    audio_chunks_processed INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_session_id ON gaming_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_status ON gaming_sessions(status);
CREATE INDEX IF NOT EXISTS idx_screen_captures_session_timestamp ON screen_captures(session_id, frame_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audio_transcriptions_session_timestamp ON audio_transcriptions(session_id, audio_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_session_timestamp ON ai_responses(session_id, response_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_game_events_session_urgency ON game_events(session_id, urgency_level DESC);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_session_timestamp ON performance_metrics(session_id, metric_timestamp DESC);

-- Create triggers for gaming sessions last_activity_at
CREATE TRIGGER update_gaming_sessions_activity BEFORE UPDATE ON gaming_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();