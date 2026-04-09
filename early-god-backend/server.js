const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const OpenAI = require('openai');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const WebSocket = require('ws');
// Note: RealtimeClient removed for now - using direct WebSocket approach
const fs = require('fs');
const path = require('path');
const GuideSearchService = require('./services/GuideSearchService');
const VoiceModeLayer = require('./layers/VoiceModeLayer');
const SaveFileWatcher = require('./SaveFileWatcher');

// Load environment variables
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
// Load local .env first (package dir), then fall back to repo-root .env
dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '.env') });


const app = express();

// Clerk SDK for authentication — OPTIONAL.
// To use a different auth provider (Auth0, Supabase, Firebase, custom JWT, or no auth):
// 1. Uninstall @clerk/clerk-sdk-node from package.json
// 2. The app will run without auth (all auth endpoints return "auth disabled")
// 3. Implement your own auth in a new file and replace the Clerk endpoints in this file
// See docs/AUTH.md for the full guide.
let Clerk = null;
try {
    Clerk = require('@clerk/clerk-sdk-node').Clerk;
} catch (err) {
    log('ℹ️ @clerk/clerk-sdk-node not installed — auth endpoints disabled (running in no-auth mode)');
}

let clerk = null;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (Clerk && clerkSecretKey && clerkSecretKey !== 'sk_test_YOUR_SECRET_KEY_HERE') {
    clerk = new Clerk({ secretKey: clerkSecretKey });
    log('✅ Clerk initialized for', process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT');
} else if (Clerk) {
    console.warn('⚠️ CLERK_SECRET_KEY not configured - authentication disabled');
}
const PORT = process.env.PORT || 3001;

// Validate required environment variables for production
const missingVars = [];

if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
    missingVars.push('OPENAI_API_KEY');
}

if (!process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY === 'your_youtube_api_key_here') {
    missingVars.push('YOUTUBE_API_KEY');
}

if (!process.env.NEON_DATABASE_API || process.env.NEON_DATABASE_API === 'your_neon_database_connection_string_here') {
    missingVars.push('NEON_DATABASE_API');
}

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    missingVars.push('GEMINI_API_KEY');
}

// ====================================
// 🚫 VERTEX AI FINE-TUNED MODEL - COMMENTED OUT
// ====================================
// Custom fine-tuned model code is disabled to use standard gemini-2.5-flash instead.
// To re-enable: Uncomment the hasVertexAIConfig check and set useFineTunedModel: true in config.
// Required env vars: GCP_PROJECT_ID, GCP_LOCATION, TUNED_GEMINI_MODEL_ID, GOOGLE_APPLICATION_CREDENTIALS_BASE64
// ====================================

// const hasVertexAIConfig = process.env.GCP_PROJECT_ID && 
//                          process.env.GCP_LOCATION && 
//                          process.env.TUNED_GEMINI_MODEL_ID && 
//                          process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

// Force disable fine-tuned model - always use standard gemini-2.5-flash
const hasVertexAIConfig = false;

// if (hasVertexAIConfig) {
//     log('✅ Vertex AI fine-tuned model configuration detected');
//     log('   📍 Project:', process.env.GCP_PROJECT_ID);
//     log('   🌍 Location:', process.env.GCP_LOCATION);
//     log('   🤖 Model ID:', process.env.TUNED_GEMINI_MODEL_ID);
//     log('   🔐 Credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ? 'Present' : 'Missing');
// } else if (process.env.GCP_PROJECT_ID || process.env.GCP_LOCATION || process.env.TUNED_GEMINI_MODEL_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
//     console.warn('⚠️ Partial Vertex AI configuration detected - some variables missing:');
//     if (!process.env.GCP_PROJECT_ID) console.warn('   - GCP_PROJECT_ID missing');
//     if (!process.env.GCP_LOCATION) console.warn('   - GCP_LOCATION missing');
//     if (!process.env.TUNED_GEMINI_MODEL_ID) console.warn('   - TUNED_GEMINI_MODEL_ID missing');
//     if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) console.warn('   - GOOGLE_APPLICATION_CREDENTIALS_BASE64 missing');
//     console.warn('   📝 Will fall back to standard Gemini API');
// } else {
//     log('ℹ️ No Vertex AI configuration - using standard Gemini API');
// }

// Log that we're using standard Gemini 2.5 Flash (fine-tuned model disabled)
log('✅ Using standard Gemini 2.5 Flash model (fine-tuned model disabled)');

// Optional but recommended for Cluely-style architecture
if (!process.env.DEEPGRAM_API_KEY) {
    console.warn('⚠️ DEEPGRAM_API_KEY not configured - will use OpenAI Realtime API for transcription');
}

if (!process.env.ELEVENLABS_API_KEY) {
    console.warn('⚠️ ELEVENLABS_API_KEY not configured - will use OpenAI TTS for voice output');
}

// Clerk authentication validation
if (!process.env.CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY === 'sk_test_YOUR_SECRET_KEY_HERE') {
    console.warn('⚠️ CLERK_SECRET_KEY not configured - authentication endpoints disabled');
}

// Clerk configuration complete

if (missingVars.length > 0) {
    console.error('⚠️ Missing environment variables (server will run with limited functionality):');
    missingVars.forEach(varName => {
        console.error(`   - ${varName}`);
    });
    console.error('');
    console.error('📝 For full functionality, configure your API keys in Railway Variables');
    console.error('🔑 Get your API keys from:');
    console.error('   - OpenAI: https://platform.openai.com/api-keys');
    console.error('   - YouTube Data API: https://console.cloud.google.com/apis/credentials');
    console.error('   - Neon Postgres: https://neon.tech/');
    console.error('   - Gemini: https://makersuite.google.com/app/apikey');
    console.error('');
    console.warn('⚠️ Starting server in limited mode...');
}

log(`🚀 Starting EarlyGod.ai backend on port ${PORT}`);
log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
if (missingVars.length === 0) {
    log('✅ All required environment variables configured');
} else {
    log(`⚠️ Running with ${missingVars.length} missing environment variables`);
}

// Add global error handlers to prevent process crashes
process.on('uncaughtException', (error) => {
    console.error('❌ [CRITICAL] Uncaught Exception - preventing crash:', error.message);
    console.error('❌ [CRITICAL] Stack:', error.stack);
    // Don't exit - keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [CRITICAL] Unhandled Rejection - preventing crash:', reason);
    console.error('❌ [CRITICAL] Promise:', promise);
    // Don't exit - keep the server running
});

// Handle Railway's SIGTERM gracefully
process.on('SIGTERM', () => {
    log('🛑 Received SIGTERM - shutting down gracefully');
    process.exit(0);
});

// Reduce memory usage
if (process.env.NODE_ENV === 'production') {
    // Force garbage collection more frequently on Railway
    if (global.gc) {
        setInterval(() => {
            global.gc();
        }, 30000); // Every 30 seconds
    }
}

// Initialize OpenAI client (if API key available)
let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORGANIZATION
    });
    log('✅ OpenAI client initialized');
} else {
    console.warn('⚠️ OpenAI client not initialized - API key missing');
}

// Initialize YouTube Data API client (if API key available)
let youtube = null;
if (process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'your_youtube_api_key_here') {
    youtube = google.youtube({
        version: 'v3',
        auth: process.env.YOUTUBE_API_KEY
    });
    log('✅ YouTube client initialized');
} else {
    console.warn('⚠️ YouTube client not initialized - API key missing');
}

// Initialize Gemini AI client (if API key available)
let genAI = null, geminiModel = null;
if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ 
        model: "gemini-3-pro-preview"
        // thinkingLevel defaults to HIGH for Gemini 3, so we don't need to set it explicitly
        // setting it explicitly caused 400 Bad Request with current SDK
    });
    log('✅ Gemini client initialized (Gemini 3 Pro Preview)');
} else {
    console.warn('⚠️ Gemini client not initialized - API key missing');
}

// Initialize Postgres pool with connection retry logic (if connection string available)
// Accepts DATABASE_URL (standard) or NEON_DATABASE_API (legacy). If neither is set,
// the app runs without a database — session memory becomes in-process only.
const dbConnectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_API;
let pool = null;
if (dbConnectionString && dbConnectionString !== 'your_neon_database_connection_string_here') {
    const poolConfig = {
        connectionString: dbConnectionString,
        ssl: { rejectUnauthorized: false },
        max: 20, // Maximum number of connections
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 60000,
        retry: 5 // Retry failed connections
    };
    
    pool = new Pool(poolConfig);
    log('✅ Database pool initialized');
} else {
    console.warn('⚠️ Database pool not initialized - connection string missing');
}

// Initialize Guide Search Service
let guideSearchService = null;
if (pool) {
    guideSearchService = new GuideSearchService(pool);
    log('✅ GuideSearchService initialized');
}

// Test database connection on startup (if pool exists)
if (pool) {
    pool.on('connect', (client) => {
        log('📡 New database connection established');
    });

    pool.on('error', (err, client) => {
        console.error('❌ Unexpected database error:', err);
    });

    pool.on('remove', (client) => {
        log('📡 Database connection removed');
    });

    // Create conversation_history table if it doesn't exist
    (async () => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS conversation_history (
                    id SERIAL PRIMARY KEY,
                    game_title VARCHAR(255) NOT NULL,
                    user_message TEXT NOT NULL,
                    ai_response TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    session_id VARCHAR(100)
                );

                -- Index for fast lookups by game_title
                CREATE INDEX IF NOT EXISTS idx_conversation_game_title
                ON conversation_history(game_title, timestamp DESC);

                -- Table for proactive tips from background agent
                CREATE TABLE IF NOT EXISTS proactive_tips (
                    id SERIAL PRIMARY KEY,
                    game_title VARCHAR(255) NOT NULL,
                    tip_text TEXT NOT NULL,
                    priority VARCHAR(20) NOT NULL,
                    reason TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    session_id VARCHAR(100)
                );

                -- Index for fast lookups by game_title
                CREATE INDEX IF NOT EXISTS idx_proactive_tips_game_title
                ON proactive_tips(game_title, timestamp DESC);
            `);
            log('✅ Conversation history table ready');
            log('✅ Proactive tips table ready');
        } catch (error) {
            console.error('❌ Failed to create conversation_history table:', error.message);
        }
    })();
}

// Middleware
app.use(cors({
    origin: '*',
    credentials: true
}));
// Increase body size limit to handle larger payloads (default 100kb is too small)
app.use(express.json({ limit: '10mb' }));

// Log all requests for debugging
app.use((req, res, next) => {
    if (req.url.includes('gaming-assistant') || req.url.includes('voice-agent')) {
        log(`📥 ${req.method} ${req.url}`, {
            upgrade: req.headers.upgrade,
            connection: req.headers.connection
        });
    }
    next();
});

// ====================================
// CLERK AUTHENTICATION ENDPOINTS
// ====================================

// Session verification endpoint
app.post('/api/auth/verify-session', async (req, res) => {
    const { sessionToken } = req.body;
    
    if (!clerk) {
        return res.status(501).json({ 
            authenticated: false, 
            error: 'Authentication not configured' 
        });
    }
    
    if (!sessionToken) {
        return res.status(401).json({ 
            authenticated: false, 
            error: 'No session token provided' 
        });
    }
    
    try {
        log('🔐 Verifying Clerk session...');
        
        // Verify session with Clerk
        const session = await clerk.sessions.verifySession(sessionToken);
        
        if (!session || session.status !== 'active') {
            return res.status(401).json({ 
                authenticated: false,
                error: 'Invalid or inactive session' 
            });
        }
        
        // Get user details
        const user = await clerk.users.getUser(session.userId);
        
        log('✅ Session verified for user:', user.emailAddresses[0]?.emailAddress);
        
        // Store/update user in database (if available)
        if (pool) {
            try {
                await pool.query(
                    `INSERT INTO users (clerk_user_id, email, name, image_url, created_at) 
                     VALUES ($1, $2, $3, $4, NOW()) 
                     ON CONFLICT (clerk_user_id) DO UPDATE SET 
                     email = EXCLUDED.email,
                     name = EXCLUDED.name,
                     image_url = EXCLUDED.image_url,
                     last_login = NOW()`,
                    [
                        user.id, 
                        user.emailAddresses[0]?.emailAddress || '',
                        `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
                        user.imageUrl || null
                    ]
                );
                log('💾 User record updated in database');
            } catch (dbError) {
                console.warn('⚠️ Database update failed (continuing anyway):', dbError.message);
            }
        }
        
        res.json({
            authenticated: true,
            user: {
                id: user.id,
                email: user.emailAddresses[0]?.emailAddress || '',
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
                firstName: user.firstName,
                lastName: user.lastName,
                imageUrl: user.imageUrl,
                createdAt: user.createdAt
            },
            session: {
                id: session.id,
                status: session.status,
                lastActiveAt: session.lastActiveAt,
                expireAt: session.expireAt
            }
        });
        
    } catch (error) {
        console.error('❌ Session verification error:', error.message);
        res.status(401).json({ 
            authenticated: false, 
            error: 'Session verification failed' 
        });
    }
});

// Sign out endpoint
app.post('/api/auth/signout', async (req, res) => {
    const { sessionToken } = req.body;
    
    if (!clerk) {
        return res.json({ success: true, message: 'Authentication not configured' });
    }
    
    try {
        log('👋 Processing sign out...');
        
        if (sessionToken) {
            // Revoke session in Clerk
            await clerk.sessions.revokeSession(sessionToken);
            log('✅ Session revoked in Clerk');
        }
        
        res.json({ success: true, message: 'Signed out successfully' });
        
    } catch (error) {
        console.error('❌ Sign out error:', error.message);
        // Still return success - local logout should work even if remote fails
        res.json({ success: true, message: 'Local sign out completed' });
    }
});

// Get current user endpoint (for checking auth status)
app.get('/api/auth/user', async (req, res) => {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.replace('Bearer ', '');
    
    if (!clerk || !sessionToken) {
        return res.status(401).json({ 
            authenticated: false, 
            error: 'No valid session' 
        });
    }
    
    try {
        const session = await clerk.sessions.verifySession(sessionToken);
        
        if (!session || session.status !== 'active') {
            return res.status(401).json({ 
                authenticated: false,
                error: 'Session expired' 
            });
        }
        
        const user = await clerk.users.getUser(session.userId);
        
        res.json({
            authenticated: true,
            user: {
                id: user.id,
                email: user.emailAddresses[0]?.emailAddress || '',
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
                firstName: user.firstName,
                lastName: user.lastName,
                imageUrl: user.imageUrl
            }
        });
        
    } catch (error) {
        console.error('❌ Get user error:', error.message);
        res.status(401).json({ 
            authenticated: false, 
            error: 'Authentication failed' 
        });
    }
});

// ====================================  
// SIMPLE CLERK AUTHENTICATION
// ====================================

// Elegant callback page with loading message
app.get('/auth/clerk-callback', (req, res) => {
    log('🔐 Auth callback');
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Authentication Complete</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 40%, #2a2a2a 100%); 
            color: white; 
            text-align: center; 
            padding: 50px; 
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .card { 
            background: rgba(42, 42, 42, 0.8); 
            padding: 40px; 
            border-radius: 16px; 
            max-width: 400px; 
            border: 1px solid rgba(251, 191, 36, 0.2);
            backdrop-filter: blur(10px);
        }
        .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid rgba(251, 191, 36, 0.3);
            border-top: 3px solid #fbbf24;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h1 { 
            color: #fbbf24; 
            margin-bottom: 16px; 
            font-size: 24px;
        }
        p { 
            color: #94a3b8; 
            margin-bottom: 24px; 
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>✅ Authentication Complete!</h1>
        <div class="spinner"></div>
        <p>Returning to Gaming Assistant...</p>
    </div>
    
    <script>
        // Auto-close after 2 seconds
        setTimeout(() => {
            window.close();
        }, 2000);
    </script>
</body>
</html>`);
});

// EXISTING API ENDPOINTS
// ====================================

// Test endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Config endpoint for Clerk publishable key (for Electron main process)
app.get('/api/config/clerk-publishable-key', (req, res) => {
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
    
    if (!publishableKey) {
        return res.status(500).json({ 
            error: 'CLERK_PUBLISHABLE_KEY not configured' 
        });
    }
    
    res.json({ publishableKey });
});

// Simple return page
app.get('/return-to-app', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Return to EarlyGod.ai</title>
    <style>
        body { font-family: Arial; background: #1a1a1a; color: white; text-align: center; padding: 50px; }
        .card { background: #2a2a2a; padding: 40px; border-radius: 16px; max-width: 400px; margin: 0 auto; }
        .button { display: inline-block; padding: 16px 32px; background: #fbbf24; color: #000; text-decoration: none; border-radius: 8px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🎉 You're signed in!</h1>
        <p>Click to return to your app:</p>
        <a href="earlygodai://auth/callback" class="button">🚀 Open EarlyGod.ai</a>
    </div>
</body>
</html>`);
});

// WebSocket test endpoint
app.get('/api/ws-test', (req, res) => {
    res.json({ 
        status: 'WebSocket endpoints configured',
        endpoints: [
            { path: '/voice-agent/ws', status: 'active' },
            { path: '/gaming-assistant/ws', status: gamingOrchestrator ? 'active' : 'pending initialization' }
        ],
        orchestratorReady: !!gamingOrchestrator,
        timestamp: new Date().toISOString() 
    });
});


// Process YouTube video and extract guide steps
app.post('/api/process-video', async (req, res) => {
    const startTime = Date.now();
    log('🎬 Processing video request started');
    
    try {
        const { youtubeUrl } = req.body;
        log('   🔗 URL:', youtubeUrl);

        if (!youtubeUrl) {
            console.error('❌ No YouTube URL provided');
            return res.status(400).json({ error: 'YouTube URL is required' });
        }

        // Extract video ID from URL
        log('🔍 Extracting video ID...');
        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            console.error('❌ Invalid YouTube URL format');
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        log('   📺 Video ID:', videoId);

        // Check if guide already exists in database (RAG approach)
        log('🔍 Checking if guide already exists...');
        const existingGuide = await checkExistingGuide(videoId);
        
        if (existingGuide) {
            log('✅ Found existing guide in database, using cached version');
            log('   🆔 Guide ID:', existingGuide.id);
            log('   📋 Steps count:', existingGuide.steps.length);
            
            const processingTime = Date.now() - startTime;
            return res.json({
                success: true,
                guideId: existingGuide.id,
                steps: existingGuide.steps,
                metadata: {
                    title: existingGuide.title,
                    channelTitle: existingGuide.channel_title,
                    duration: existingGuide.duration
                },
                cached: true,
                processingTime
            });
        }

        // Fetch video metadata
        log('📥 Fetching video metadata...');
        const videoData = await fetchVideoData(videoId);
        log('   ✅ Video data fetched:', videoData.title);

        // 🚀 ASYNC PROCESSING START
        log('🚀 Starting async background processing...');
        const guideId = await createProcessingGuide(videoId, videoData);
        
        // Return immediate response to prevent client timeout
        res.json({
            success: true,
            guideId,
            status: 'processing',
            metadata: videoData,
            message: 'Video processing started in background'
        });

        // Continue processing in background (fire and forget)
        (async () => {
            try {
                // Get transcript and analysis using Gemini
                log('🤖 Processing video with Gemini AI (Background)...');
                const { transcript, guideSteps, guideType } = await processVideoWithGemini(youtubeUrl, videoData, guideId);
                log('   📊 Transcript length:', transcript?.length || 0);
                log('   🎯 Steps generated by Gemini:', guideSteps?.length || 0);
                log('   🏷️ Guide type:', guideType);

                // CRITICAL CHECK: Verify steps were actually returned
                if (!guideSteps || guideSteps.length === 0) {
                    console.error('❌ CRITICAL: processVideoWithGemini returned EMPTY guideSteps!');
                    console.error('   Video:', videoData.title);
                    console.error('   This will create a guide with 0 steps in database.');
                }

                // Log full transcript for inspection
                if (transcript && transcript.length > 0) {
                    log('📝 FULL TRANSCRIPT CONTENT (truncated):');
                    log('=' .repeat(80));
                    log(transcript.substring(0, 500) + '...');
                    log('=' .repeat(80));
                }

                // Store in database with transcript for future RAG use
                log('💾 Storing results in database...');
                log(`   📤 Passing ${guideSteps?.length || 0} steps to storeGuide`);
                await storeGuide(videoId, videoData, guideSteps, transcript, guideType);
                
                const bgTime = Date.now() - startTime;
                log(`✅ Background processing completed in ${bgTime}ms for guide:`, guideId);
                
            } catch (bgError) {
                console.error('❌ Background processing failed:', bgError.message);
                console.error('   Stack:', bgError.stack);
                // Update status to failed
                try {
                    await pool.query('UPDATE guides SET processing_status = $1 WHERE id = $2', ['failed', guideId]);
                } catch (dbError) {
                    console.error('❌ Failed to update error status:', dbError.message);
                }
            }
        })();

    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`❌ Video processing failed after ${processingTime}ms`);
        console.error('   Error:', error.message);
        console.error('   Stack:', error.stack);
        
        res.status(500).json({ 
            error: 'Failed to process video',
            details: error.message,
            processingTime
        });
    }
});

// Get guide by ID
app.get('/api/guide/:id', async (req, res) => {
    try {
        const { id } = req.params;
        log('📖 Fetching guide:', id);
        
        if (!pool) {
            console.error('❌ Database pool not available');
            return res.status(503).json({ error: 'Database not available' });
        }
        
        const result = await pool.query('SELECT * FROM guides WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            log('❌ Guide not found:', id);
            return res.status(404).json({ error: 'Guide not found' });
        }

        const guide = result.rows[0];
        const stepsResult = await pool.query('SELECT * FROM steps WHERE guide_id = $1 ORDER BY step_number', [id]);

        log('✅ Guide fetched:', guide.title, 'with', stepsResult.rows.length, 'steps');
        
        res.json({
            ...guide,
            steps: stepsResult.rows
        });
    } catch (error) {
        console.error('❌ Error fetching guide:', error.message);
        res.status(500).json({ error: 'Failed to fetch guide' });
    }
});

// Voice Mode endpoints
const activeVoiceSessions = new Map();

// Web search tool for ElevenLabs agent
app.post('/api/voice-mode/tool/web-search', async (req, res) => {
    log('🌐 [TOOL] Web search tool called by ElevenLabs agent');
    log('   📦 Request body:', JSON.stringify(req.body).substring(0, 200));

    try {
        const query = req.body.query || '';

        if (!query) {
            return res.json({ result: 'No search query provided' });
        }

        // 🎯 CRITICAL FIX: Get game context from active voice session
        let gameContext = null;
        for (const [sessionId, session] of activeVoiceSessions.entries()) {
            if (session.voiceMode) {
                gameContext = session.voiceMode.gameContext;
                break;
            }
        }

        // 🎯 Prepend game name to search query for accurate results
        let enhancedQuery = query;
        if (gameContext && gameContext.gameTitle && gameContext.gameTitle !== 'General Gaming Session') {
            enhancedQuery = `${gameContext.gameTitle}: ${query}`;
            log('   🎮 Enhanced query with game name:', enhancedQuery);
        } else {
            log('   ⚠️ No game context found, using original query');
        }

        log('   🔍 Search query:', enhancedQuery);
        log('   🌐 Using Gemini with Google Search grounding');

        // Use Gemini with Google Search tool (same as Gaming Session does)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: `Search the web and provide a concise answer (2-3 sentences max) for this gaming question: ${enhancedQuery}` }]
            }],
            tools: [{ googleSearch: {} }] // Enable Google Search
        });
        
        const searchResult = result.response.text();
        
        log('✅ [TOOL] Web search complete');
        log('   📝 Result:', searchResult.substring(0, 150));
        
        // Return to ElevenLabs
        res.json({ result: searchResult });
        
    } catch (error) {
        console.error('❌ [TOOL] Web search error:', error);
        res.json({ result: 'Unable to search the web at the moment.' });
    }
});

// Tool endpoint for ElevenLabs agent (called when agent needs screen analysis)
app.post('/api/voice-mode/tool/screen-analysis', async (req, res) => {
    log('🔍 [TOOL] Screen analysis tool called by ElevenLabs agent');
    log('   📦 Request body:', JSON.stringify(req.body).substring(0, 200));
    
    try {
        const query = req.body.query || '';
        
        // Get most recent voice mode session
        const sessions = Array.from(activeVoiceSessions.values());
        const session = sessions[sessions.length - 1];
        
        if (!session || !session.clientConnection) {
            console.error('   ❌ No active voice mode session with client connection');
            return res.json({
                result: 'Screen capture unavailable. Please describe what you see.'
            });
        }
        
        log('   ✅ Requesting fresh screenshot from frontend (using proven Gaming Session pattern)');
        
        // Store the HTTP response object so we can reply after screenshot arrives
        session.pendingToolResponse = res;
        session.pendingToolQuery = query;
        
        // Notify frontend to update status
        session.clientConnection.send(JSON.stringify({
            type: 'status',
            status: 'Fetching Screenshot'
        }));
        
        // Request screenshot using Gaming Session's proven pattern
        session.clientConnection.send(JSON.stringify({
            type: 'use_cached_screenshot',
            question: query || 'What is on the screen?'
        }));
        
        // Set timeout to prevent hanging (increased to 30 seconds for debugging)
        session.screenshotTimeout = setTimeout(() => {
            if (session.pendingToolResponse) {
                console.warn('   ⚠️ Screenshot capture timed out after 30 seconds');
                log('   🔍 Debug - Checking if screenshot arrived late...');
                log('      Session still exists:', !!session);
                log('      Client connection open:', session?.clientConnection?.readyState === 1);
                session.pendingToolResponse.json({
                    result: 'Unable to capture screen at the moment. Please describe what you see.'
                });
                session.pendingToolResponse = null;
            }
        }, 30000); // Increased from 5s to 30s
        
        // Response will be sent when screenshot arrives (in screen_frame handler)
        
        // NOTE: Response will be sent asynchronously when screenshot arrives
        // See the 'screen_frame' case handler below
        
    } catch (error) {
        console.error('❌ [TOOL] Error in screen analysis:', error);
        if (!res.headersSent) {
            res.json({
                result: 'Unable to analyze screen. Please describe what you see.'
            });
        }
    }
});

// Voice agent tool: Memory retrieval
app.post('/api/voice-agent/memory', async (req, res) => {
    log('🧠 [TOOL] Memory retrieval tool called by ElevenLabs agent');
    log('   📦 Request body:', JSON.stringify(req.body).substring(0, 200));

    try {
        const query = req.body.query || '';

        // Get most recent voice mode session
        const sessions = Array.from(activeVoiceSessions.values());
        const session = sessions[sessions.length - 1];

        if (!session || !session.gameTitle) {
            console.warn('   ⚠️ No active session or game title');
            return res.json({
                result: 'Memory system unavailable. No active game session detected.'
            });
        }

        const gameTitle = session.gameTitle;
        log('   🎮 Fetching memory for:', gameTitle);

        // Fetch long-term memory from Neon
        const events = await pool.query(
            `SELECT category, event_type, entity_name, context, timestamp
             FROM long_term_memory
             WHERE game_title = $1
             ORDER BY timestamp DESC
             LIMIT 50`,
            [gameTitle]
        );

        if (events.rows.length === 0) {
            log('   ℹ️ No memory events found for', gameTitle);
            return res.json({
                result: `No memory events recorded yet for ${gameTitle}. As you play, I'll automatically track bosses defeated, checkpoints reached, items collected, and deaths.`
            });
        }

        // Format memory for agent response
        const formattedMemory = formatLongTermMemory(events.rows);
        log('   ✅ Retrieved', events.rows.length, 'memory events');

        res.json({
            result: formattedMemory
        });

    } catch (error) {
        console.error('❌ [TOOL] Error in memory retrieval:', error);
        if (!res.headersSent) {
            res.json({
                result: 'Unable to retrieve memory at this time. Please try again.'
            });
        }
    }
});

// ========================================
// LONG-TERM MEMORY API (Neon PostgreSQL)
// ========================================

// Store long-term memory event
app.post('/api/memory/store-event', async (req, res) => {
    try {
        const { gameTitle, category, eventType, entityName, context, userId } = req.body;

        if (!gameTitle || !category || !entityName) {
            return res.status(400).json({ error: 'gameTitle, category, and entityName are required' });
        }

        const result = await pool.query(
            `INSERT INTO long_term_memory (user_id, game_title, category, event_type, entity_name, context)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [userId || null, gameTitle, category, eventType || null, entityName, context || null]
        );

        log('[MEMORY] Stored event:', category, entityName, 'for', gameTitle);
        res.json({ success: true, id: result.rows[0].id });

    } catch (error) {
        console.error('[MEMORY] Error storing event:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Store proactive tip from background agent
app.post('/api/memory/store-tip', async (req, res) => {
    try {
        const { gameTitle, tipText, priority, reason, sessionId } = req.body;

        if (!gameTitle || !tipText || !priority) {
            return res.status(400).json({ error: 'gameTitle, tipText, and priority are required' });
        }

        const result = await pool.query(
            `INSERT INTO proactive_tips (game_title, tip_text, priority, reason, session_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [gameTitle, tipText, priority, reason || null, sessionId || null]
        );

        log('[TIPS] Stored tip:', priority, 'for', gameTitle);
        res.json({ success: true, id: result.rows[0].id });

    } catch (error) {
        console.error('[TIPS] Error storing tip:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get proactive tips for a game
app.get('/api/memory/tips/:gameTitle', async (req, res) => {
    try {
        const { gameTitle } = req.params;
        const { limit = 50 } = req.query;

        const result = await pool.query(
            `SELECT * FROM proactive_tips
             WHERE game_title = $1
             ORDER BY timestamp DESC
             LIMIT $2`,
            [gameTitle, parseInt(limit)]
        );

        res.json({
            success: true,
            tips: result.rows
        });

    } catch (error) {
        console.error('[TIPS] Error fetching tips:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get long-term memory events for a game
app.get('/api/memory/events/:gameTitle', async (req, res) => {
    try {
        const { gameTitle } = req.params;
        const { category, limit = 50 } = req.query;

        let query = 'SELECT * FROM long_term_memory WHERE game_title = $1';
        const params = [gameTitle];

        if (category) {
            query += ' AND category = $2';
            params.push(category);
        }

        query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
        params.push(parseInt(limit));

        const result = await pool.query(query, params);

        log('[MEMORY] Retrieved', result.rows.length, 'events for', gameTitle);
        res.json({ success: true, events: result.rows });

    } catch (error) {
        console.error('[MEMORY] Error retrieving events:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get recent checkpoints for a game (deduplicated)
app.get('/api/memory/checkpoints/:gameTitle', async (req, res) => {
    try {
        const { gameTitle } = req.params;
        const { limit = 5 } = req.query;

        // Get checkpoint events ordered by most recent
        const result = await pool.query(
            `SELECT DISTINCT ON (entity_name)
             entity_name, context, timestamp
             FROM long_term_memory
             WHERE game_title = $1 AND category = 'checkpoint'
             ORDER BY entity_name, timestamp DESC
             LIMIT $2`,
            [gameTitle, parseInt(limit)]
        );

        // Sort by timestamp descending (most recent first)
        const checkpoints = result.rows.sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        log('[CHECKPOINTS] Retrieved', checkpoints.length, 'unique checkpoints for', gameTitle);
        res.json({
            success: true,
            checkpoints: checkpoints,
            count: checkpoints.length
        });

    } catch (error) {
        console.error('[CHECKPOINTS] Error retrieving checkpoints:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// SAVE FILE WATCHER ENDPOINTS
// ========================================

// Get SaveFileWatcher status
app.get('/api/savewatcher/status', (req, res) => {
    const watcher = req.app.locals.saveWatcher;
    if (!watcher) {
        return res.json({
            success: false,
            error: 'SaveFileWatcher not available (production mode or not initialized)'
        });
    }
    res.json({
        success: true,
        ...watcher.getStatus()
    });
});

// Force refresh/rescan of save file
app.post('/api/savewatcher/refresh', async (req, res) => {
    const watcher = req.app.locals.saveWatcher;
    if (!watcher) {
        return res.json({
            success: false,
            error: 'SaveFileWatcher not available'
        });
    }

    try {
        const status = await watcher.refresh();
        res.json({
            success: true,
            message: 'Save file rescanned',
            ...status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear long-term memory for a game
app.delete('/api/memory/events/:gameTitle', async (req, res) => {
    try {
        const { gameTitle } = req.params;

        const result = await pool.query(
            'DELETE FROM long_term_memory WHERE game_title = $1',
            [gameTitle]
        );

        log('[MEMORY] Cleared', result.rowCount, 'events for', gameTitle);
        res.json({ success: true, deleted: result.rowCount });

    } catch (error) {
        console.error('[MEMORY] Error clearing events:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Delete a single memory event by ID
app.delete('/api/memory/event/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM long_term_memory WHERE id = $1 RETURNING game_title, entity_name',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Memory not found' });
        }

        log('[MEMORY] Deleted event:', result.rows[0].entity_name, 'from', result.rows[0].game_title);
        res.json({ success: true, deleted: result.rows[0] });

    } catch (error) {
        console.error('[MEMORY] Error deleting event:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// MAP VISUALIZATION ENDPOINTS
// ========================================

// Get map data for a game
app.get('/api/map/:gameTitle', async (req, res) => {
    try {
        const { gameTitle } = req.params;
        log('[MAP] Fetching map for:', gameTitle);

        const result = await pool.query(
            `SELECT * FROM game_maps WHERE game_title = $1`,
            [gameTitle]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No map found for this game',
                gameTitle
            });
        }

        res.json({
            success: true,
            map: result.rows[0]
        });

    } catch (error) {
        console.error('[MAP] Error fetching map:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get checkpoint positions for a game
app.get('/api/map/:gameTitle/checkpoints', async (req, res) => {
    try {
        const { gameTitle } = req.params;
        log('[MAP] Fetching checkpoint positions for:', gameTitle);

        const result = await pool.query(
            `SELECT * FROM checkpoint_positions
             WHERE game_title = $1
             ORDER BY sort_order ASC, checkpoint_name ASC`,
            [gameTitle]
        );

        res.json({
            success: true,
            checkpoints: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('[MAP] Error fetching checkpoints:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update checkpoint position (for manual adjustment)
app.put('/api/map/:gameTitle/checkpoint/:checkpointName', async (req, res) => {
    try {
        const { gameTitle, checkpointName } = req.params;
        const { x_position, y_position, adjacent_checkpoints } = req.body;

        log('[MAP] Updating checkpoint position:', checkpointName);

        const result = await pool.query(
            `UPDATE checkpoint_positions
             SET x_position = COALESCE($3, x_position),
                 y_position = COALESCE($4, y_position),
                 adjacent_checkpoints = COALESCE($5, adjacent_checkpoints)
             WHERE game_title = $1 AND checkpoint_name = $2
             RETURNING *`,
            [gameTitle, checkpointName, x_position, y_position, adjacent_checkpoints]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Checkpoint not found'
            });
        }

        res.json({
            success: true,
            checkpoint: result.rows[0]
        });

    } catch (error) {
        console.error('[MAP] Error updating checkpoint:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Add new checkpoint position
app.post('/api/map/:gameTitle/checkpoint', async (req, res) => {
    try {
        const { gameTitle } = req.params;
        const {
            checkpoint_name,
            display_name,
            x_position,
            y_position,
            region,
            checkpoint_type = 'location',
            is_main_story = false,
            sort_order = 100,
            adjacent_checkpoints = []
        } = req.body;

        log('[MAP] Adding checkpoint:', checkpoint_name);

        const result = await pool.query(
            `INSERT INTO checkpoint_positions
             (game_title, checkpoint_name, display_name, x_position, y_position,
              region, checkpoint_type, is_main_story, sort_order, adjacent_checkpoints)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (game_title, checkpoint_name) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                x_position = EXCLUDED.x_position,
                y_position = EXCLUDED.y_position,
                region = EXCLUDED.region,
                checkpoint_type = EXCLUDED.checkpoint_type,
                is_main_story = EXCLUDED.is_main_story,
                sort_order = EXCLUDED.sort_order,
                adjacent_checkpoints = EXCLUDED.adjacent_checkpoints
             RETURNING *`,
            [gameTitle, checkpoint_name, display_name || checkpoint_name,
             x_position, y_position, region, checkpoint_type,
             is_main_story, sort_order, adjacent_checkpoints]
        );

        res.json({
            success: true,
            checkpoint: result.rows[0]
        });

    } catch (error) {
        console.error('[MAP] Error adding checkpoint:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get list of available games with maps
app.get('/api/maps', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT gm.game_title, gm.map_image_url, gm.source_attribution,
                    COUNT(cp.id) as checkpoint_count
             FROM game_maps gm
             LEFT JOIN checkpoint_positions cp ON gm.game_title = cp.game_title
             GROUP BY gm.id, gm.game_title, gm.map_image_url, gm.source_attribution
             ORDER BY gm.game_title`
        );

        res.json({
            success: true,
            maps: result.rows
        });

    } catch (error) {
        console.error('[MAP] Error fetching maps list:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/voice-mode/start', async (req, res) => {
    log('🎤 Voice mode start request received');

    try {
        const { sessionId, gameTitle, guideData, clientMemoryContext } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        log('   📋 Session:', sessionId);
        log('   🎮 Game:', gameTitle || 'General');
        
        // CRITICAL: Check if session already exists and clean it up
        if (activeVoiceSessions.has(sessionId)) {
            log('⚠️ Session already exists - cleaning up duplicate connection');
            const oldSession = activeVoiceSessions.get(sessionId);
            if (oldSession.voiceMode) {
                oldSession.voiceMode.deactivate('duplicate_prevented');
            }
            activeVoiceSessions.delete(sessionId);
            log('✅ Old session cleaned up');
        }
        
        // Also clean up any orphaned sessions (older than 30 minutes)
        const now = Date.now();
        for (const [sid, session] of activeVoiceSessions.entries()) {
            // Keep active or paused sessions for up to 30 minutes
            if (now - session.startTime > 1800000) {
                log('🧹 Cleaning up stale session:', sid);
                if (session.voiceMode) {
                    session.voiceMode.deactivate('timeout');
                }
                activeVoiceSessions.delete(sid);
            }
        }
        
        log('   📊 Active sessions before create:', activeVoiceSessions.size);

        // 🧠 Build memory context (client + Neon long-term)
        let memoryContext = '';

        // Add client-side memory (recent conversations from localStorage)
        if (clientMemoryContext && clientMemoryContext.length > 0) {
            memoryContext += clientMemoryContext;
            log('[MEMORY] Client context:', clientMemoryContext.length, 'chars');
        }

        // Add long-term memory from Neon (boss defeats, checkpoints, items)
        if (gameTitle) {
            try {
                const events = await pool.query(
                    `SELECT category, event_type, entity_name, context, timestamp
                     FROM long_term_memory
                     WHERE game_title = $1
                     ORDER BY timestamp DESC
                     LIMIT 20`,
                    [gameTitle]
                );

                if (events.rows.length > 0) {
                    const longTermMemory = formatLongTermMemory(events.rows);
                    if (memoryContext.length > 0) {
                        memoryContext += '\n\n';
                    }
                    memoryContext += longTermMemory;
                    log('[MEMORY] Long-term events:', events.rows.length, 'loaded from Neon');
                }

                // 🧠 Load conversation history (cross-session persistence)
                const conversationHistory = await loadConversationHistory(gameTitle, 30);
                if (conversationHistory.length > 0) {
                    if (memoryContext.length > 0) {
                        memoryContext += '\n\n';
                    }
                    memoryContext += '═══════════════════════════════════════\n';
                    memoryContext += '💬 RECENT CONVERSATION HISTORY (Last ' + conversationHistory.length + ' turns):\n';
                    memoryContext += '═══════════════════════════════════════\n\n';

                    conversationHistory.forEach((turn, idx) => {
                        const timeAgo = getTimeAgo(new Date(turn.timestamp));
                        memoryContext += `[${timeAgo}]\n`;
                        memoryContext += `User: "${turn.user_message}"\n`;
                        memoryContext += `You: "${turn.ai_response}"\n\n`;
                    });

                    memoryContext += '═══════════════════════════════════════\n';
                    log('[MEMORY] Conversation history:', conversationHistory.length, 'turns loaded');
                }
            } catch (error) {
                console.error('[MEMORY] Failed to fetch long-term events:', error.message);
                // Continue without long-term memory
            }
        }

        // Create voice mode layer
        const voiceMode = new VoiceModeLayer({
            agentId: process.env.ELEVENLABS_AGENT_ID
        });

        // 🧠 Set memory before activating
        if (memoryContext) {
            voiceMode.setPreloadedMemory(memoryContext);
        }

        // Activate voice mode
        await voiceMode.activate(sessionId, { gameTitle }, guideData);

        // Store session
        activeVoiceSessions.set(sessionId, {
            voiceMode,
            gameTitle,
            startTime: Date.now()
        });
        
        log('✅ Voice mode session created:', sessionId);
        log('   📊 Total active sessions:', activeVoiceSessions.size);
        
        res.json({
            success: true,
            sessionId: sessionId,
            conversationId: voiceMode.conversationId,
            memoryLoaded: memoryContext.length > 0  // 🧠 Indicate if memory was loaded
        });
        
    } catch (error) {
        console.error('❌ Error starting voice mode:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/voice-mode/stop', async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    
    log('🛑 Voice mode stop request for session:', sessionId);
    
    const session = activeVoiceSessions.get(sessionId);
    
    if (session) {
        // Deactivate voice mode
        session.voiceMode.deactivate('manual');
        activeVoiceSessions.delete(sessionId);
        log('✅ Voice mode session stopped:', sessionId);
        log('   📊 Remaining sessions:', activeVoiceSessions.size);
    } else {
        console.warn('⚠️ Session not found:', sessionId);
    }
    
    res.json({ success: true });
});

app.post('/api/voice-mode/pause', async (req, res) => {
    const { sessionId, reason } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    
    log(`⏸️ Voice mode pause request for session: ${sessionId} (${reason})`);
    
    const session = activeVoiceSessions.get(sessionId);
    
    if (session && session.voiceMode) {
        const paused = session.voiceMode.pause(reason);
        
        if (paused) {
            log('✅ Voice mode paused:', sessionId);
            log('   💾 Memory preserved');
            log('   💰 Cost savings active');
            res.json({ success: true, paused: true });
        } else {
            res.json({ success: false, error: 'Already paused' });
        }
    } else {
        console.warn('⚠️ Session not found:', sessionId);
        res.status(404).json({ error: 'Session not found' });
    }
});

app.post('/api/voice-mode/resume', async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    
    log(`▶️ Voice mode resume request for session: ${sessionId}`);
    
    const session = activeVoiceSessions.get(sessionId);
    
    if (session && session.voiceMode) {
        const resumed = session.voiceMode.resume();
        
        if (resumed) {
            log('✅ Voice mode resumed:', sessionId);
            log('   ✅ Context restored');
            res.json({ success: true, paused: false });
        } else {
            res.json({ success: false, error: 'Not paused' });
        }
    } else {
        console.warn('⚠️ Session not found:', sessionId);
        res.status(404).json({ error: 'Session not found' });
    }
});

// Voice command endpoint (Enhanced with RAG)
app.post('/api/voice-command', async (req, res) => {
    log('🎤 Voice command request received');
    
    try {
        const { command, context = {} } = req.body;
        log('   🗣️ Command:', command);
        log('   📋 Context keys:', Object.keys(context));

        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }

        // 🎯 Build enhanced AI prompt with game and guide context
        let systemPrompt = 'You are a gaming assistant that provides voice-guided instructions. Respond with brief, clear instructions for the given command. Keep responses under 50 words and focus on actionable guidance.';
        let userPrompt = `Voice command: "${command}".`;

        // If game context is available from primers, enhance the prompt
        if (context.gameContext && Object.keys(context.gameContext).length > 0) {
            const { gameTitle, genre, overview, coreMechanics, terminology, insiderTips } = context.gameContext;
            
            systemPrompt = `You are a gaming assistant specialized in "${gameTitle}" (${genre}). 

Game Overview: ${overview}

Core Mechanics: ${coreMechanics?.slice(0, 5).join(', ')}

Key Terms: ${Object.entries(terminology || {}).slice(0, 5).map(([term, def]) => `${term}: ${def}`).join('; ')}

Pro Tips: ${insiderTips?.slice(0, 3).join('; ')}

Provide specific, actionable advice using proper game terminology. Keep responses under 50 words.`;

            userPrompt = `Player question about ${gameTitle}: "${command}"`;

            log('🎮 Game-aware prompt created for:', gameTitle);
        }

        // If guide context is also available, combine with game context
        if (context.guideContext) {
            const { title, currentStep, relevantSteps, progress } = context.guideContext;
            
            if (context.gameContext && Object.keys(context.gameContext).length > 0) {
                // Combine game and guide context
                systemPrompt += `\n\nCurrently following guide: "${title}" (${progress}% complete)`;
                userPrompt += `\n\nCurrent guide step: ${currentStep ? `${currentStep.step_number}. ${currentStep.title} - ${currentStep.action}` : 'Not started'}`;
            } else {
                // Guide context only (fallback)
                systemPrompt = `You are a gaming assistant helping a player follow the guide "${title}". Provide contextual help that references the guide when relevant. Keep responses under 50 words and be specific.`;
                userPrompt = `Player question: "${command}"

Current Guide: ${title} (${progress}% complete)
Current Step: ${currentStep ? `${currentStep.step_number}. ${currentStep.title} - ${currentStep.action}` : 'Not started'}

${relevantSteps?.length > 0 ? `Relevant Steps:
${relevantSteps.map(step => {
    let stepText = `${step.step_number}. ${step.title}\nAction: ${step.action}`;
    if (step.visual_cues) stepText += `\nVisual Cues: ${step.visual_cues}`;
    if (step.strategic_context) stepText += `\nStrategic Context: ${step.strategic_context}`;
    return stepText;
}).join('\n\n')}` : ''}`;
            }

            log('🎯 Guide+Game context combined:', {
                game: context.gameContext?.gameTitle || 'None',
                guide: title,
                currentStep: currentStep?.step_number,
                progress
            });
        }

        // Process voice command with enhanced context
        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            max_tokens: 100,
            temperature: 0.3
        });

        const response = completion.choices[0].message.content.trim();
        log('   💬 Response:', response);

        res.json({
            success: true,
            command,
            response,
            guideContext: context.guideContext ? {
                title: context.guideContext.title,
                currentStep: context.guideContext.currentStep?.step_number,
                progress: context.guideContext.progress
            } : null,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error processing voice command:', error.message);
        res.status(500).json({ 
            error: 'Failed to process voice command',
            details: error.message
        });
    }
});

// 🧹 ADMIN: Cleanup failed guides
app.post('/api/admin/cleanup-failed-guides', async (req, res) => {
    log('🧹 Admin cleanup request for failed guides');

    if (!pool) {
        return res.status(503).json({ error: 'Database not available' });
    }

    try {
        const { youtubeId } = req.body;

        if (!youtubeId) {
            return res.status(400).json({ error: 'youtubeId is required' });
        }

        // Delete failed or partial guides
        const result = await pool.query(
            'DELETE FROM guides WHERE youtube_id = $1 AND processing_status IN ($2, $3) RETURNING id',
            [youtubeId, 'failed', 'partial']
        );

        log(`🗑️ Cleaned up ${result.rowCount} failed guides for video: ${youtubeId}`);
        res.json({
            success: true,
            message: `Cleaned up ${result.rowCount} failed guides`,
            cleanedIds: result.rows.map(r => r.id)
        });

    } catch (error) {
        console.error('❌ Error cleaning up failed guides:', error);
        res.status(500).json({ error: 'Failed to cleanup guides' });
    }
});

// 🧟‍♂️ EMERGENCY: Force clear all zombie sessions
app.post('/api/gaming/clear-all-sessions', async (req, res) => {
    log('🧹 [EMERGENCY] Force clear all sessions request received');
    
    if (!gamingOrchestrator) {
        return res.status(503).json({ error: 'Gaming assistant not available' });
    }
    
    try {
        const activeSessions = Array.from(gamingOrchestrator.activeSessions.keys());
        log(`🧟‍♂️ Found ${activeSessions.length} sessions to clean up:`, activeSessions);
        
        let cleaned = 0;
        for (const sessionId of activeSessions) {
            try {
                log(`🧹 Force stopping session: ${sessionId}`);
                await gamingOrchestrator.stopGamingSession(sessionId);
                cleaned++;
            } catch (error) {
                console.error(`❌ Error stopping session ${sessionId}:`, error.message);
                // Force remove from map
                gamingOrchestrator.activeSessions.delete(sessionId);
                gamingOrchestrator.sessionStats.delete(sessionId);
                cleaned++;
            }
        }
        
        res.json({
            success: true,
            message: 'All sessions cleared',
            sessionsCleared: cleaned,
            remainingSessions: gamingOrchestrator.activeSessions.size,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error clearing all sessions:', error.message);
        res.status(500).json({ error: 'Failed to clear sessions', details: error.message });
    }
});

// Clear cache endpoint - delete all guides from database
app.delete('/api/clear-cache', async (req, res) => {
    log('🗑️ Clear cache request received');
    
    try {
        // Delete all steps first (due to foreign key constraints)
        const stepsResult = await pool.query('DELETE FROM steps');
        log('   🗑️ Deleted steps:', stepsResult.rowCount);
        
        // Delete all guides
        const guidesResult = await pool.query('DELETE FROM guides');
        log('   🗑️ Deleted guides:', guidesResult.rowCount);
        
        // Delete user progress
        const progressResult = await pool.query('DELETE FROM user_progress');
        log('   🗑️ Deleted user progress:', progressResult.rowCount);
        
        log('✅ Database cache cleared successfully');
        
        res.json({
            success: true,
            message: 'Database cache cleared successfully',
            deleted: {
                guides: guidesResult.rowCount,
                steps: stepsResult.rowCount,
                userProgress: progressResult.rowCount
            }
        });
        
    } catch (error) {
        console.error('❌ Error clearing database cache:', error.message);
        res.status(500).json({
            error: 'Failed to clear database cache',
            details: error.message
        });
    }
});

// List voice conversations endpoint
app.get('/api/voice-conversations', (req, res) => {
    log('📋 Voice conversations list request received');
    
    try {
        const conversationsDir = path.join(__dirname, '..', 'voice_conversations');
        
        if (!fs.existsSync(conversationsDir)) {
            return res.json({
                success: true,
                conversations: [],
                message: 'No voice conversations directory found'
            });
        }
        
        const files = fs.readdirSync(conversationsDir);
        const conversations = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filepath = path.join(conversationsDir, file);
                    const stats = fs.statSync(filepath);
                    const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
                    
                    conversations.push({
                        filename: file,
                        sessionId: content.sessionId,
                        startTime: content.startTime,
                        endTime: content.endTime,
                        messageCount: content.messages.length,
                        toolCallCount: content.toolCalls.length,
                        fileSize: stats.size,
                        created: stats.birthtime
                    });
                } catch (fileError) {
                    console.warn('⚠️ Error reading conversation file:', file, fileError.message);
                }
            }
        }
        
        // Sort by creation time (newest first)
        conversations.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        log('   📊 Found', conversations.length, 'voice conversations');
        
        res.json({
            success: true,
            conversations: conversations,
            total: conversations.length
        });
        
    } catch (error) {
        console.error('❌ Error listing voice conversations:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list voice conversations',
            details: error.message
        });
    }
});

// Get specific voice conversation endpoint
app.get('/api/voice-conversations/:filename', (req, res) => {
    log('📄 Voice conversation detail request for:', req.params.filename);
    
    try {
        const conversationsDir = path.join(__dirname, '..', 'voice_conversations');
        const filepath = path.join(conversationsDir, req.params.filename);
        
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                error: 'Voice conversation not found'
            });
        }
        
        const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        
        log('   📊 Conversation details:', {
            sessionId: content.sessionId,
            messages: content.messages.length,
            toolCalls: content.toolCalls.length
        });
        
        res.json({
            success: true,
            conversation: content
        });
        
    } catch (error) {
        console.error('❌ Error getting voice conversation:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get voice conversation',
            details: error.message
        });
    }
});

// Voice agent WebSocket proxy endpoint
app.get('/voice-agent/ws', (req, res) => {
    log('🎤 Voice agent WebSocket upgrade request received');
    log('   📊 Request details:', {
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin,
        upgrade: req.headers.upgrade,
        connection: req.headers.connection
    });
    
    res.status(400).json({ 
        error: 'This endpoint requires WebSocket upgrade',
        message: 'Use WebSocket connection, not HTTP'
    });
});

// RAG search endpoint for voice agent (works with Gaming Session AND ElevenLabs tools)
// Note: Open-source build uses LocalGameSearch (offline keyword search over game-primers/).
// To plug in semantic search (Vertex AI / Pinecone / pgvector / etc), see docs/RAG.md.
const VertexVectorSearch = require('./services/LocalGameSearch');

app.post('/api/voice-agent/search', async (req, res) => {
    log('🔍 RAG search request received');
    log('   📊 Request body:', JSON.stringify(req.body).substring(0, 200));
    
    try {
        // Support both Gaming Session format AND ElevenLabs tool format
        const query = req.body.query || req.body.user_message;
        const game = req.body.game;
        const isElevenLabsTool = req.body.tool_call_id || req.body.call_id; // ElevenLabs tool format
        
        log('   🔍 Search parameters:');
        log('      Query:', query);
        log('      Game:', game);
        log('      Source:', isElevenLabsTool ? 'ElevenLabs Tool' : 'Gaming Session');
        
        if (!query) {
            console.error('❌ No search query provided');
            if (isElevenLabsTool) {
                return res.json({ result: 'No search query provided' });
            }
            return res.status(400).json({ error: 'Search query is required' });
        }
        
        // Get game title and guide data from voice mode session if not provided
        let gameTitle = game;
        let guideData = null;
        
        if (activeVoiceSessions.size > 0) {
            const sessions = Array.from(activeVoiceSessions.values());
            const session = sessions[sessions.length - 1];
            
            if (!gameTitle && session.voiceMode.gameContext?.gameTitle) {
                gameTitle = session.voiceMode.gameContext.gameTitle;
                log('   🎮 Using game from voice session:', gameTitle);
            }
            
            if (session.voiceMode.guideData) {
                guideData = session.voiceMode.guideData;
                log('   📚 Using guide from voice session:', guideData.metadata?.title);
                log('   📊 Guide has', guideData.steps?.length || 0, 'steps');
            }
        }
        
        // Path A: Check if current loaded guide matches the query
        let guideResults = [];
        
        if (guideData && guideData.steps && guideData.steps.length > 0) {
            log('📚 Searching loaded guide:', guideData.metadata?.title);
            
            // Search within the loaded guide steps
            const matchingSteps = guideData.steps.filter(step => {
                const stepText = `${step.title} ${step.action}`.toLowerCase();
                return stepText.includes(query.toLowerCase());
            });
            
            if (matchingSteps.length > 0) {
                log('   ✅ Found', matchingSteps.length, 'matching steps in loaded guide');

                guideResults.push({
                    type: 'loaded_guide',
                    title: guideData.metadata?.title || 'Loaded Guide',
                    content: matchingSteps.slice(0, 3).map((step, idx) => {
                        let stepText = `Step ${step.step_number}: ${step.title}\nAction: ${step.action}`;
                        if (step.visual_cues) stepText += `\nVisual Cues: ${step.visual_cues}`;
                        if (step.strategic_context) stepText += `\nStrategic Context: ${step.strategic_context}`;
                        return stepText;
                    }).join('\n\n'),
                    relevance: 'exact_match',
                    source: 'loaded_guide'
                });
            } else {
                log('   📋 No specific match in loaded guide - will search ALL guides for this game');
                // Don't return the full loaded guide - let database search find relevant content from OTHER guides
            }
        }
        
        // Path B: Also search database for other guides
        log('🗄️ Searching database for additional guides...');
        const dbResults = await searchGuidesInDatabase(query, gameTitle);
        guideResults = [...guideResults, ...dbResults];
        
        // Path C: Local game-primer search (any game with a primer file in frontend/game-primers/)
        // Originally this was Vertex AI vector search gated to specific games. Now it's offline keyword
        // search via LocalGameSearch — works for any game without setup.
        let vectorResults = [];
        if (gameTitle) {
            log('🧠 Searching local game primer for knowledge...');
            vectorResults = await VertexVectorSearch.search(query, gameTitle);
        }
        
        // Combine results (loaded guide → database guides → vectors)
        const searchResults = [...guideResults, ...vectorResults];
        
        log('   📊 Search completed:');
        log('      Results found:', searchResults.length);
        log('      Result types:', searchResults.map(r => r.type));
        
        // Format response based on caller
        if (isElevenLabsTool) {
            // ElevenLabs tool format - return as single result string
            if (searchResults.length === 0) {
                return res.json({ 
                    result: `No specific guides found for "${query}". I can provide general gaming advice instead.` 
                });
            }
            
            // Format results as readable text for voice agent
            let resultText = `I found ${searchResults.length} relevant guide${searchResults.length > 1 ? 's' : ''}:\n\n`;
            
            searchResults.slice(0, 3).forEach((result, idx) => {
                resultText += `${idx + 1}. ${result.title}\n`;
                if (result.content) {
                    resultText += `   ${result.content.substring(0, 200)}...\n\n`;
                }
            });
            
            log('✅ [TOOL] Returning formatted guide results to ElevenLabs');
            return res.json({ result: resultText });
        }
        
        // Gaming Session format - return as array
        // Log each result for debugging
        searchResults.forEach((result, index) => {
            log(`   📋 Result ${index + 1}:`, {
                type: result.type,
                title: result.title || result.guide_title,
                relevance: result.relevance,
                contentLength: result.content?.length || result.action?.length || 0
            });
        });
        
        const response = {
            success: true,
            query: query,
            results: searchResults,
            resultCount: searchResults.length,
            timestamp: new Date().toISOString()
        };
        
        log('📤 Sending RAG search results to voice agent');
        res.json(response);
        
    } catch (error) {
        console.error('❌ Error in voice agent RAG search:', error.message);
        console.error('   📋 Error stack:', error.stack);
        res.status(500).json({
            error: 'Failed to search guides',
            details: error.message
        });
    }
});

// Memory retrieval endpoint for voice agent (ElevenLabs tool)
app.post('/api/voice-agent/memory', async (req, res) => {
    log('🧠 Memory retrieval request received');
    log('   📊 Request body:', JSON.stringify(req.body).substring(0, 200));

    try {
        // Auto-detect game title and get session from active voice session
        let gameTitle = null;
        let session = null;

        if (activeVoiceSessions.size > 0) {
            const sessions = Array.from(activeVoiceSessions.values());
            session = sessions[sessions.length - 1];

            if (session.voiceMode && session.voiceMode.gameContext?.gameTitle) {
                gameTitle = session.voiceMode.gameContext.gameTitle;
                log('   ✅ Auto-detected game from session:', gameTitle);
            }
        }

        if (!gameTitle || gameTitle === 'Unknown') {
            log('   ⚠️ No active game session found');
            return res.json({
                result: `⚠️ NO ACTIVE GAME DETECTED

I cannot help you without knowing which game you're playing.

Please ensure:
1. A game is running or selected
2. Voice mode is active
3. Game detection is working

Start playing a game and I'll automatically detect it and track your progress.`
            });
        }

        // Build combined memory (short-term + long-term)
        // ✅ ALWAYS start with game title prominently displayed
        let combinedMemory = `🎮 CURRENT GAME: ${gameTitle}
═══════════════════════════════════════════════════════════════════

YOU ARE HELPING THE PLAYER WITH: ${gameTitle.toUpperCase()}

All information below relates to this game. Remember this game name for the entire conversation.
═══════════════════════════════════════════════════════════════════

`;

        // 1. SHORT-TERM MEMORY (recent conversations from localStorage)
        if (session && session.voiceMode && session.voiceMode.preloadedMemory) {
            combinedMemory += session.voiceMode.preloadedMemory;
            log('   💭 Included short-term memory:', session.voiceMode.preloadedMemory.length, 'chars');
        }

        // 2. LONG-TERM MEMORY (checkpoints, bosses, items from database)
        log('   🗄️ Fetching long-term memories for:', gameTitle);
        const result = await pool.query(
            `SELECT * FROM long_term_memory
             WHERE game_title = $1
             ORDER BY timestamp DESC
             LIMIT 50`,
            [gameTitle]
        );

        const events = result.rows;
        log('   📊 Retrieved', events.length, 'long-term memory events');

        if (events.length > 0) {
            // Format long-term memories
            const formattedLongTermMemory = formatLongTermMemory(events);

            // Combine with short-term memory
            if (combinedMemory.length > 0) {
                combinedMemory += '\n\n' + formattedLongTermMemory;
            } else {
                combinedMemory = formattedLongTermMemory;
            }
        }

        // Check if we have any memory beyond the game title header (need at least some content)
        const hasActualMemory = combinedMemory.trim().split('\n').length > 8; // More than just the header

        if (!hasActualMemory) {
            return res.json({
                result: `🎮 CURRENT GAME: ${gameTitle}
═══════════════════════════════════════════════════════════════════

YOU ARE HELPING THE PLAYER WITH: ${gameTitle.toUpperCase()}

═══════════════════════════════════════════════════════════════════

📝 STATUS: No progress recorded yet for ${gameTitle}.

As you play, I'll automatically track your checkpoints, bosses defeated, and items obtained. Start a conversation to build short-term memory.`
            });
        }

        log('   ✅ Memory formatted successfully');
        log('   📏 Total memory length:', combinedMemory.length, 'chars');
        log('   🧠 Includes both short-term (conversations) and long-term (checkpoints/bosses) memory');
        log('   🎮 Game title included at top:', gameTitle);
        log('   📝 First 200 chars of response:', combinedMemory.substring(0, 200));

        // Return in ElevenLabs tool format
        res.json({ result: combinedMemory });

    } catch (error) {
        console.error('❌ Error retrieving memory:', error.message);
        console.error('   📋 Error stack:', error.stack);
        res.json({
            result: 'Unable to retrieve memory at this time. Please try again.'
        });
    }
});

// Helper function to search guides in database for RAG
async function searchGuidesInDatabase(query, gameTitle = null) {
    log('🗄️ Starting database search for RAG');
    log('   🔍 Query:', query);
    log('   🎮 Game Filter:', gameTitle || 'None');
    
    try {
        const queryLower = query.toLowerCase();
        log('   📝 Normalized query:', queryLower);
        
        // Prepare game filter
        let guideGameFilter = '';
        let stepGameFilter = '';
        const guideParams = [`%${queryLower}%`];
        const stepParams = [`%${queryLower}%`];
        
        if (gameTitle) {
            const simplifiedGame = gameTitle.toLowerCase().split(':')[0].trim();
            
            // Game Aliases for better matching (e.g. EU5 vs Europa Universalis V)
            const aliases = {
                'europa universalis v': 'eu5',
                'europa universalis 5': 'eu5',
                'age of empires 2': 'aoe2',
                'age of empires 4': 'aoe4',
                'league of legends': 'lol'
            };
            
            const alias = aliases[simplifiedGame];
            
            if (alias) {
                log(`   🔄 Applying game alias: "${simplifiedGame}" OR "${alias}"`);
                // Search for EITHER name OR alias
                // Param indices: $1=query, $2=name, $3=alias
                guideGameFilter = ` AND (LOWER(title) LIKE $2 OR LOWER(title) LIKE $3)`;
                stepGameFilter = ` AND (LOWER(g.title) LIKE $2 OR LOWER(g.title) LIKE $3)`;
                
                const nameParam = `%${simplifiedGame}%`;
                const aliasParam = `%${alias}%`;
                
                guideParams.push(nameParam, aliasParam);
                stepParams.push(nameParam, aliasParam);
            } else {
                // Standard search
                guideGameFilter = ` AND LOWER(title) LIKE $2`;
                stepGameFilter = ` AND LOWER(g.title) LIKE $2`;
                
                guideParams.push(`%${simplifiedGame}%`);
                stepParams.push(`%${simplifiedGame}%`);
            }
        }
        
        // Search in guide titles and transcripts
        log('🔍 Searching guide titles and transcripts...');
        const guideSql = `
            SELECT id, title, transcript, channel_title
            FROM guides
            WHERE (LOWER(title) LIKE $1
               OR LOWER(transcript) LIKE $1
               OR LOWER(channel_title) LIKE $1)
            ${guideGameFilter}
            LIMIT 10
        `;
        
        const guideResults = await pool.query(guideSql, guideParams);
        
        log('   📊 Guide search results:', guideResults.rows.length);
        guideResults.rows.forEach((guide, index) => {
            log(`      📖 Guide ${index + 1}:`, {
                id: guide.id,
                title: guide.title,
                channel: guide.channel_title,
                transcriptLength: guide.transcript?.length || 0
            });
        });
        
        // Search in step content
        log('🔍 Searching step content...');
        const stepSql = `
            SELECT s.*, g.title as guide_title, g.channel_title
            FROM steps s
            JOIN guides g ON s.guide_id = g.id
            WHERE (LOWER(s.title) LIKE $1
               OR LOWER(s.action) LIKE $1
               OR LOWER(s.observe) LIKE $1
               OR LOWER(s.resources) LIKE $1
               OR LOWER(s.strategic_context) LIKE $1)
            ${stepGameFilter}
            ORDER BY s.step_number
            LIMIT 15
        `;
        
        const stepResults = await pool.query(stepSql, stepParams);
        
        log('   📊 Step search results:', stepResults.rows.length);
        stepResults.rows.forEach((step, index) => {
            log(`      📋 Step ${index + 1}:`, {
                guide: step.guide_title,
                stepNumber: step.step_number,
                title: step.title,
                actionLength: step.action?.length || 0
            });
        });
        
        const results = [];
        
        // Add guide-level results with context-aware snippets
        for (const guide of guideResults.rows) {
            let contentSnippet = 'No transcript available';
            
            if (guide.transcript) {
                const lowerTranscript = guide.transcript.toLowerCase();
                const matchIndex = lowerTranscript.indexOf(queryLower);
                
                if (matchIndex !== -1) {
                    // Found keyword! Extract window around it
                    const start = Math.max(0, matchIndex - 200);
                    const end = Math.min(guide.transcript.length, matchIndex + 800);
                    contentSnippet = `...${guide.transcript.substring(start, end)}...`;
                    log(`   🎯 Found keyword match at index ${matchIndex} in guide "${guide.title}"`);
                } else {
                    // No keyword match (likely title match), return extended intro
                    contentSnippet = guide.transcript.substring(0, 1000);
                }
            }

            const result = {
                type: 'guide',
                title: guide.title,
                channel: guide.channel_title,
                relevance: 'guide_match',
                content: contentSnippet
            };
            results.push(result);
            log('   ➕ Added guide result:', guide.title);
        }
        
        // Add step-level results
        for (const step of stepResults.rows) {
            const result = {
                type: 'step',
                guide_title: step.guide_title,
                step_number: step.step_number,
                step_title: step.title,
                action: step.action,
                visual_cues: step.visual_cues,
                observe: step.observe,
                fallback: step.fallback,
                resources: step.resources,
                strategic_context: step.strategic_context,
                estimated_time: step.estimated_time,
                relevance: 'step_content'
            };
            results.push(result);
            log('   ➕ Added step result:', step.guide_title, '-', step.title);
        }
        
        log('✅ Database search completed');
        log('   📊 Total results:', results.length);
        log('   📋 Result summary:', results.map(r => `${r.type}: ${r.title || r.guide_title}`));
        
        return results;
        
    } catch (error) {
        console.error('❌ Error searching database for RAG:', error.message);
        console.error('   📋 Error details:', {
            stack: error.stack,
            query: query
        });
        return [];
    }
}

// Helper function to save voice conversation to JSON file
function saveVoiceConversation(conversationData) {
    try {
        // Create conversations directory if it doesn't exist
        const conversationsDir = path.join(__dirname, '..', 'voice_conversations');
        if (!fs.existsSync(conversationsDir)) {
            fs.mkdirSync(conversationsDir, { recursive: true });
            log('📁 Created voice_conversations directory');
        }
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `voice_conversation_${timestamp}.json`;
        const filepath = path.join(conversationsDir, filename);
        
        // Save conversation data
        fs.writeFileSync(filepath, JSON.stringify(conversationData, null, 2));
        log('💾 Voice conversation saved to:', filepath);
        
        return filepath;
    } catch (error) {
        console.error('❌ Error saving voice conversation:', error);
        return null;
    }
}

// NEW CLUELY-STYLE GAMING ASSISTANT API ENDPOINTS

// Start a new gaming session with real-time assistance
app.post('/api/gaming/validate-session', async (req, res) => {
    try {
        const { sessionId } = req.body;
        log('🔍 Validating session:', sessionId);
        
        const isValid = gamingOrchestrator.isSessionActive(sessionId);
        
        if (isValid) {
            log('✅ Session is valid:', sessionId);
            res.json({ valid: true });
        } else {
            log('❌ Session not found:', sessionId);
            res.status(404).json({ valid: false, error: 'Session not found' });
        }
    } catch (error) {
        console.error('❌ Error validating session:', error);
        res.status(500).json({ valid: false, error: error.message });
    }
});

app.post('/api/gaming/start-session', async (req, res) => {
    log('🎮 Gaming session start request received');
    log('   📊 Request body:', JSON.stringify(req.body));
    log('   🔌 Orchestrator available:', !!gamingOrchestrator);
    
    // Check if gaming orchestrator is available
    if (!gamingOrchestrator) {
        console.error('❌ Gaming orchestrator not available!');
        return res.status(503).json({ 
            error: 'Gaming assistant not available',
            details: 'Gaming orchestrator failed to initialize - check server logs'
        });
    }
    
    try {
        const { sessionId, gameTitle, gameProcess } = req.body;
        
        if (!sessionId) {
            console.error('❌ No sessionId provided in request');
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        log('   🆔 Session ID:', sessionId);
        log('   🎯 Game:', gameTitle || 'Unknown');
        log('   💻 Process:', gameProcess || 'Any');
        
        const success = await gamingOrchestrator.startGamingSession(
            sessionId, 
            gameTitle, 
            gameProcess
        );
        
        if (success) {
            res.json({
                success: true,
                sessionId,
                gameTitle,
                gameProcess,
                message: 'Gaming session started successfully',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(409).json({
                error: 'Failed to start gaming session',
                details: 'Session may already exist or max capacity reached'
            });
        }
        
    } catch (error) {
        console.error('❌ Error starting gaming session:', error.message);
        res.status(500).json({
            error: 'Failed to start gaming session',
            details: error.message
        });
    }
});

// Stop a gaming session
app.post('/api/gaming/stop-session', async (req, res) => {
    log('🛑 Gaming session stop request received');
    
    if (!gamingOrchestrator) {
        return res.status(503).json({ error: 'Gaming assistant not available' });
    }
    
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        log('   🆔 Session ID:', sessionId);
        
        const success = await gamingOrchestrator.stopGamingSession(sessionId);
        
        if (success) {
            res.json({
                success: true,
                sessionId,
                message: 'Gaming session stopped successfully',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({
                error: 'Session not found or already stopped',
                sessionId
            });
        }
        
    } catch (error) {
        console.error('❌ Error stopping gaming session:', error.message);
        res.status(500).json({
            error: 'Failed to stop gaming session',
            details: error.message
        });
    }
});

// Get active gaming sessions
app.get('/api/gaming/sessions', (req, res) => {
    log('📋 Active gaming sessions request received');
    
    if (!gamingOrchestrator) {
        return res.json({ success: true, activeSessions: [], totalSessions: 0, message: 'Gaming assistant not available' });
    }
    
    try {
        const activeSessions = gamingOrchestrator.getActiveSessions();
        
        res.json({
            success: true,
            activeSessions,
            totalSessions: activeSessions.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error fetching active sessions:', error.message);
        res.status(500).json({
            error: 'Failed to fetch active sessions',
            details: error.message
        });
    }
});

// Get performance metrics for the gaming assistant
app.get('/api/gaming/metrics', (req, res) => {
    log('📊 Gaming assistant metrics request received');
    
    if (!gamingOrchestrator) {
        return res.json({ success: true, metrics: { available: false }, message: 'Gaming assistant not available' });
    }
    
    try {
        const performanceStats = gamingOrchestrator.getPerformanceStats();
        
        res.json({
            success: true,
            metrics: performanceStats,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error fetching performance metrics:', error.message);
        res.status(500).json({
            error: 'Failed to fetch performance metrics',
            details: error.message
        });
    }
});

// Get memories for all games (long-term and short-term)
app.get('/api/gaming/memories', async (req, res) => {
    log('🧠 Memory retrieval request received');
    
    try {
        // Lazy-load memory manager only when this endpoint is called (SAFE - no startup impact)
        let memoryManager = null;
        
        // Try to get from gaming orchestrator first (if available)
        if (gamingOrchestrator && gamingOrchestrator.memoryManager) {
            memoryManager = gamingOrchestrator.memoryManager;
            log('✅ Using memory manager from gaming orchestrator');
        } else {
            // Fallback: Create temporary instance just for this request
            try {
                const MemoryManager = require('./services/MemoryManager');
                memoryManager = new MemoryManager();
                log('✅ Created temporary memory manager instance');
                
                // Wait for database to be ready (async initialization)
                await new Promise((resolve, reject) => {
                    const checkDb = setInterval(() => {
                        if (memoryManager.db) {
                            clearInterval(checkDb);
                            resolve();
                        }
                    }, 50);
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        clearInterval(checkDb);
                        if (!memoryManager.db) {
                            reject(new Error('Database initialization timeout'));
                        }
                    }, 5000);
                });
                
                log('✅ Memory database ready');
            } catch (error) {
                console.error('❌ Failed to create memory manager:', error.message);
                return res.status(503).json({ 
                    success: false,
                    error: 'Memory system not available',
                    details: 'Unable to initialize memory database: ' + error.message
                });
            }
        }
        
        if (!memoryManager || !memoryManager.db) {
            return res.status(503).json({ 
                success: false,
                error: 'Memory system not available',
                details: 'Memory database is not initialized'
            });
        }
        
        // Get all unique games from long_term_events
        // Query both long_term_events AND short_term_memory tables
        const games = await new Promise((resolve, reject) => {
            memoryManager.db.all(`
                SELECT DISTINCT game_title FROM (
                    SELECT game_title FROM long_term_events WHERE is_active = 1
                    UNION
                    SELECT game_title FROM short_term_memory
                )
                ORDER BY game_title
            `, [], (err, rows) => {
                if (err) {
                    console.error('❌ Database query error:', err);
                    reject(err);
                } else {
                    log('✅ Found games:', rows.length);
                    log('   📋 Games with memories:', rows.map(r => r.game_title).join(', '));
                    resolve(rows.map(r => r.game_title));
                }
            });
        });
        
        // For each game, get long-term events and short-term messages
        const memoriesByGame = {};
        
        for (const gameTitle of games) {
            log(`📋 Fetching memories for: ${gameTitle}`);
            const longTermEvents = await memoryManager.getRecentEvents(gameTitle, 50);
            const shortTermMessages = await memoryManager.getLastSessionMessages(gameTitle, 20);
            
            memoriesByGame[gameTitle] = {
                longTermEvents,
                shortTermMessages,
                totalEvents: longTermEvents.length,
                totalMessages: shortTermMessages.length
            };
        }
        
        log('✅ Memory retrieval successful:', {
            totalGames: games.length,
            games: games
        });
        
        res.json({
            success: true,
            games: games,
            memories: memoriesByGame,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error fetching memories:', error);
        console.error('   Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch memories',
            details: error.message
        });
    }
});

// ✅ NEW: Set guide context for RAG integration
app.post('/api/gaming/set-guide', async (req, res) => {
    log('🎯 Set guide context request received');
    
    if (!gamingOrchestrator) {
        return res.status(503).json({ error: 'Gaming assistant not available' });
    }
    
    try {
        const { sessionId, guideData } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        if (!guideData || !guideData.steps) {
            return res.status(400).json({ error: 'guideData with steps is required' });
        }
        
        log('🎯 Setting guide context for session:', sessionId);
        log('   📖 Guide:', guideData.metadata?.title);
        log('   📋 Steps:', guideData.steps?.length);
        
        // Get the session and update its RAG context
        const session = gamingOrchestrator.activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Gaming session not found' });
        }
        
        // Set the guide context in the ContextFusion layer (DUAL PATH RAG)
        if (gamingOrchestrator.layers && gamingOrchestrator.layers.context) {
            // PATH B: Set session.rag for low-latency smart filtering
            const contextSession = gamingOrchestrator.layers.context.getSession(sessionId);
            if (contextSession) {
                contextSession.rag = {
                    active: true,
                    guideId: guideData.guideId,
                    guideTitle: guideData.metadata?.title || 'Unknown Guide',
                    currentStep: guideData.steps[0] || null,
                    stepNumber: 0,
                    totalSteps: guideData.steps.length,
                    allSteps: guideData.steps
                };
                log('✅ RAG Path B (session.rag) activated for session:', sessionId);
                log('   🎯 Guide title:', contextSession.rag.guideTitle);
                log('   📊 Total steps:', contextSession.rag.totalSteps);
            } else {
                console.warn('⚠️ Context session not found, creating one...');
                gamingOrchestrator.layers.context.createSession(sessionId, session.gameContext);
                const newSession = gamingOrchestrator.layers.context.getSession(sessionId);
                newSession.rag = {
                    active: true,
                    guideId: guideData.guideId,
                    guideTitle: guideData.metadata?.title || 'Unknown Guide',
                    currentStep: guideData.steps[0] || null,
                    stepNumber: 0,
                    totalSteps: guideData.steps.length,
                    allSteps: guideData.steps
                };
            }
            
            // PATH A: Set currentGuideContext for direct guide questions (high accuracy)
            // Build structured guide context with current step + relevant nearby steps
            const guideContextForPathA = {
                title: guideData.metadata?.title || 'Unknown Guide',
                guideId: guideData.guideId,
                progress: 0, // Starting at step 0
                currentStep: guideData.steps[0] || null,
                totalSteps: guideData.steps.length,
                stepNumber: 0,
                // Include first 3 steps as relevant context
                relevantSteps: guideData.steps.slice(0, Math.min(3, guideData.steps.length))
            };
            
            gamingOrchestrator.layers.context.setGuideContext(guideContextForPathA);
            log('✅ RAG Path A (currentGuideContext) activated for direct guide questions');
            log('   📍 Current step:', guideContextForPathA.currentStep?.title);
            log('   📋 Relevant steps loaded:', guideContextForPathA.relevantSteps?.length);
        }
        
        res.json({
            success: true,
            message: 'Guide context set successfully',
            sessionId,
            guideTitle: guideData.metadata?.title,
            stepsCount: guideData.steps?.length,
            ragActive: true,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error setting guide context:', error.message);
        res.status(500).json({
            error: 'Failed to set guide context',
            details: error.message
        });
    }
});

// ✅ NEW: Update game context for session
app.post('/api/gaming/set-game', async (req, res) => {
    log('🎮 Set game context request received');
    
    try {
        const { sessionId, gameTitle, gameType } = req.body;
        
        if (!sessionId || !gameTitle) {
            return res.status(400).json({ error: 'sessionId and gameTitle are required' });
        }
        
        // Get the session and update its game context
        const session = gamingOrchestrator.activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Gaming session not found' });
        }
        
        log(`🎮 Updating game context for session: ${sessionId}`);
        log(`   🎯 New game: ${gameTitle} (${gameType || 'action'})`);
        
        // Update the game context in the ContextFusion layer
        if (gamingOrchestrator.layers && gamingOrchestrator.layers.context) {
            const contextSession = gamingOrchestrator.layers.context.getSession(sessionId);
            if (contextSession) {
                // Update session game context
                contextSession.game = {
                    title: gameTitle,
                    type: gameType || 'action'
                };
                log('✅ Session game context updated');
                
                // Also update the global game context in the AI layer
                if (gamingOrchestrator.layers.ai) {
                    gamingOrchestrator.layers.ai.gameContext = {
                        gameTitle: gameTitle,
                        gameType: gameType || 'action'
                    };
                    log('✅ AI layer game context updated');
                }
            }
        }
        
        res.json({
            success: true,
            message: 'Game context updated successfully',
            sessionId,
            gameTitle,
            gameType,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error updating game context:', error.message);
        res.status(500).json({ error: 'Failed to update game context' });
    }
});

// ✅ Clear guide context (deactivate RAG)
app.post('/api/gaming/clear-guide', async (req, res) => {
    log('🧹 Clear guide context request received');
    
    if (!gamingOrchestrator) {
        return res.status(503).json({ error: 'Gaming assistant not available' });
    }
    
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        log('🧹 Clearing guide context for session:', sessionId);
        
        // Get the session and clear its RAG context
        const session = gamingOrchestrator.activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Gaming session not found' });
        }
        
        // Clear the guide context in the ContextFusion layer (DUAL PATH)
        if (gamingOrchestrator.layers && gamingOrchestrator.layers.context) {
            // Clear Path B (session.rag)
            const contextSession = gamingOrchestrator.layers.context.getSession(sessionId);
            if (contextSession && contextSession.rag) {
                contextSession.rag = {
                    active: false,
                    guideId: null,
                    guideTitle: null,
                    currentStep: null,
                    stepNumber: 0,
                    totalSteps: 0,
                    allSteps: []
                };
                log('✅ RAG Path B deactivated for session:', sessionId);
            }
            
            // Clear Path A (currentGuideContext)
            gamingOrchestrator.layers.context.setGuideContext(null);
            log('✅ RAG Path A deactivated (currentGuideContext cleared)');
        }
        
        res.json({
            success: true,
            message: 'Guide context cleared successfully',
            sessionId,
            ragActive: false,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error clearing guide context:', error.message);
        res.status(500).json({
            error: 'Failed to clear guide context',
            details: error.message
        });
    }
});

// ✅ NEW: Update current guide step (keep BOTH RAG paths synchronized)
app.post('/api/gaming/update-step', async (req, res) => {
    log('🎯 Update guide step request received');
    
    if (!gamingOrchestrator) {
        return res.status(503).json({ error: 'Gaming assistant not available' });
    }
    
    try {
        const { sessionId, stepNumber } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        
        if (typeof stepNumber !== 'number' || stepNumber < 0) {
            return res.status(400).json({ error: 'Valid stepNumber (0-based index) is required' });
        }
        
        log('🎯 Updating guide step for session:', sessionId);
        log('   📍 New step:', stepNumber + 1);
        
        // Get the session and update its RAG context
        const session = gamingOrchestrator.activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Gaming session not found' });
        }
        
        // Update BOTH Path A and Path B using updateGuideStep()
        if (gamingOrchestrator.layers && gamingOrchestrator.layers.context) {
            const updated = gamingOrchestrator.layers.context.updateGuideStep(sessionId, stepNumber);
            
            if (!updated) {
                return res.status(400).json({ 
                    error: 'Failed to update guide step',
                    details: 'No active RAG context or invalid step number'
                });
            }
            
            const contextSession = gamingOrchestrator.layers.context.getSession(sessionId);
            const currentStep = contextSession?.rag?.currentStep;
            const progress = Math.round((stepNumber / contextSession.rag.totalSteps) * 100);
            
            log('✅ DUAL RAG paths updated:', {
                step: stepNumber + 1,
                title: currentStep?.title,
                progress: progress + '%',
                pathASync: true,
                pathBSync: true
            });
            
            res.json({
                success: true,
                message: 'Guide step updated successfully (both paths)',
                sessionId,
                stepNumber,
                currentStep,
                progress,
                ragActive: true,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).json({ error: 'Context layer not available' });
        }
        
    } catch (error) {
        console.error('❌ Error updating guide step:', error.message);
        res.status(500).json({
            error: 'Failed to update guide step',
            details: error.message
        });
    }
});

// Gaming WebSocket endpoint - handled by WebSocket server, not Express
// No HTTP route needed - WebSocket server handles the upgrade directly
// Gaming WebSocket handlers are defined after server initialization

// ========================================
// 🎮 GAMING MESSAGE HANDLER
// ========================================
// ⚠️ DO NOT add 'cache_screenshot' case handler!
//
// PROVEN WORKING APPROACH:
// - Screenshots are captured ON-DEMAND by frontend when backend requests
// - NO backend screenshot caching
// - NO periodic screenshot messages from frontend
//
// REGRESSION TO AVOID:
// ❌ Don't add: case 'cache_screenshot' (causes WebSocket flooding)
// ❌ Don't add: screenshotCache Map on backend
// ❌ Don't add: global.screenshotCache
//
// WHY: Periodic screenshot messages (200KB every 333ms) congest WebSocket
//      Audio chunks get delayed → Deepgram breaks → Empty transcripts
// ========================================
function handleGameMessage(message, clientWS, sessionId) {
    switch (message.type) {
        case 'ping':
            clientWS.send(JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString()
            }));
            break;
            
        case 'get_status':
            const sessions = gamingOrchestrator.getActiveSessions();
            const currentSession = sessions.find(s => s.id === sessionId);
            
            clientWS.send(JSON.stringify({
                type: 'status',
                sessionId: sessionId,
                session: currentSession,
                timestamp: new Date().toISOString()
            }));
            break;
            
        case 'screen_frame':
            log('📸 [GAMING SESSION] Screen frame received for vision analysis');
            log('   📏 Image size:', Math.round(message.image?.length / 1024) || 0, 'KB');
            log('   ❓ Question:', message.question);
            log('   ⚡ From cache:', message.fromCache ? 'YES (instant!)' : 'NO (fresh capture)');
            
            // ✅ STORE SCREENSHOT IN ORCHESTRATOR SESSION (Just-in-Time Capture)
            if (gamingOrchestrator && gamingOrchestrator.activeSessions.has(sessionId)) {
                const session = gamingOrchestrator.activeSessions.get(sessionId);
                session.pendingScreenshot = {
                    image: message.image,
                    timestamp: message.timestamp,
                    fromCache: message.fromCache
                };
                log('✅ Screenshot stored in session buffer for next AI request');
            }

            // Process screen frame with vision analysis
            // Skip legacy path if it's a proactive capture (fromCache=true)
            if (!message.fromCache) {
                if (gamingOrchestrator && gamingOrchestrator.layers && gamingOrchestrator.layers.vision) {
                    log('✅ Calling vision layer processScreenFrame...');
                    gamingOrchestrator.layers.vision.processScreenFrame({
                        sessionId: sessionId,
                        image: message.image,
                        question: message.question,
                        timestamp: message.timestamp,
                        fromCache: message.fromCache
                    });
                    log('📤 Screen frame passed to vision layer');
                } else {
                    console.error('❌ Vision layer not available:', {
                        hasOrchestrator: !!gamingOrchestrator,
                        hasLayers: !!gamingOrchestrator?.layers,
                        hasVision: !!gamingOrchestrator?.layers?.vision
                    });
                }
            }
            break;
            
        default:
            console.warn('⚠️ Unknown message type:', message.type);
    }
}

// Function to setup gaming WebSocket handlers
function setupGamingWebSocket(gamingWSS) {
log('🔧 Setting up gaming WebSocket handlers...');
log('   📍 Path: /gaming-assistant/ws');
log('   🔌 Server ready:', !!gamingWSS);

// Handle gaming assistant WebSocket connections
gamingWSS.on('connection', async (clientWS, req) => {
    log('🔗 New gaming assistant WebSocket connection');
    log('   📍 URL:', req.url);
    log('   🌐 Host:', req.headers.host);
    
    let sessionId;
    
    try {
        log('🔍 [DEBUG] Parsing URL for sessionId...');
        const url = new URL(req.url, `http://${req.headers.host}`);
        sessionId = url.searchParams.get('sessionId');
        log('🔍 [DEBUG] Extracted sessionId:', sessionId);
        
        if (!sessionId) {
            console.error('❌ No sessionId provided in WebSocket connection');
            clientWS.close(4000, 'sessionId required');
            return;
        }
        
        log('   🆔 Session ID:', sessionId);
        
        // Check if gaming orchestrator is available
        if (!gamingOrchestrator) {
            console.error('❌ Gaming orchestrator not available');
            clientWS.close(4503, 'Gaming assistant service unavailable');
            return;
        }
        
        log('🔍 [DEBUG] About to call connectClient...');
        
        // Connect client to the orchestrator's display layer
        const connected = gamingOrchestrator.connectClient(sessionId, clientWS);
        
        log('🔍 [DEBUG] connectClient returned:', connected);
        
        if (!connected) {
            console.error('❌ Failed to connect client to session:', sessionId);
            clientWS.close(4004, 'Session not found');
            return;
        }
        
    } catch (urlError) {
        console.error('❌ [DEBUG] Error in WebSocket connection handler:', urlError.message);
        console.error('❌ [DEBUG] Stack:', urlError.stack);
        clientWS.close(4500, 'WebSocket handler error');
        return;
    }
    
    try {
        
        // Send welcome message
        clientWS.send(JSON.stringify({
            type: 'welcome',
            sessionId: sessionId,
            message: 'Connected to gaming assistant',
            timestamp: new Date().toISOString()
        }));
        
        // Audio chunk counter for this connection
        let audioBinaryChunkCount = 0;
        
        // Handle client messages
        clientWS.on('message', (data) => {
            try {
                // ✅ FIX: Check if it's binary audio or string JSON first
                if (data instanceof Buffer || data instanceof ArrayBuffer) {
                    // Binary audio data - forward to transcription layer
                    if (gamingOrchestrator && gamingOrchestrator.layers && gamingOrchestrator.layers.transcription) {
                        gamingOrchestrator.layers.transcription.processAudioChunk(data);
                    }
                } else {
                    // JSON message
                    const message = JSON.parse(data.toString());

                    // Handle session_ready message to ensure transcription layer is initialized
                    if (message.type === 'session_ready') {
                        log('🔄 Received session_ready message for session:', message.sessionId);

                        // Ensure transcription layer is properly initialized with session context
                        if (gamingOrchestrator && gamingOrchestrator.layers && gamingOrchestrator.layers.transcription) {
                            if (!gamingOrchestrator.layers.transcription.isTranscribing) {
                                log('🚀 Restarting transcription layer with session:', message.sessionId);
                                gamingOrchestrator.layers.transcription.startTranscription(message.sessionId).catch(err => {
                                    console.error('❌ Failed to restart transcription:', err.message);
                                });
                            } else {
                                log('✅ Transcription layer already active for session:', message.sessionId);
                            }
                        }

                        // Send confirmation back to client
                        clientWS.send(JSON.stringify({
                            type: 'session_ready_confirmed',
                            sessionId: message.sessionId,
                            transcriptionActive: gamingOrchestrator?.layers?.transcription?.isTranscribing || false,
                            timestamp: new Date().toISOString()
                        }));

                        return; // Don't process as regular message
                    }
                    // First try to parse as JSON (for large messages like screen_frame)
                    try {
                        const str = data.toString('utf8');
                        if (str.startsWith('{')) {
                            // It's JSON, not audio!
                            const message = JSON.parse(str);
                            log('📥 Gaming assistant message (from buffer):', message.type);
                            handleGameMessage(message, clientWS, sessionId);
                            return;
                        }
                    } catch (parseError) {
                        // Not JSON, must be binary audio
                    }
                    
                    // It's actual binary audio
                    const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
                    
                    audioBinaryChunkCount++;
                    
                    if (audioBinaryChunkCount === 1 || audioBinaryChunkCount % 100 === 0) {
                        log(`🎤 [${sessionId}] Received ${audioBinaryChunkCount} binary audio chunks (${audioBuffer.length} bytes each)`);
                    }
                    
                    // Forward directly to Deepgram
                    if (gamingOrchestrator && gamingOrchestrator.layers && gamingOrchestrator.layers.transcription) {
                        gamingOrchestrator.layers.transcription.processAudioChunk(audioBuffer, Date.now());
                        
                        // Log transcription layer status on first chunk after reconnect
                        if (audioBinaryChunkCount === 1) {
                            log(`🔍 [${sessionId}] Transcription layer status:`, {
                                isTranscribing: gamingOrchestrator.layers.transcription.isTranscribing,
                                hasConnection: !!gamingOrchestrator.layers.transcription.currentConnection,
                                sessionId: gamingOrchestrator.layers.transcription.sessionId
                            });
                        }
                    } else {
                        console.error(`❌ [${sessionId}] Cannot forward audio - transcription layer not available`);
                    }
                    return;
                }
                
                // String JSON message
                try {
                    const message = JSON.parse(data);
                    log('📥 Gaming assistant message (string):', message.type);
                    handleGameMessage(message, clientWS, sessionId);
                } catch (jsonError) {
                    // 🎤 AUDIO CHUNKS: If JSON parsing fails, it's likely audio data
                    // Silently forward to transcription layer instead of logging error
                    if (Buffer.byteLength(data) < 10000) {  // Audio chunks are typically small
                        const audioBuffer = Buffer.from(data);
                        if (gamingOrchestrator?.layers?.transcription) {
                            gamingOrchestrator.layers.transcription.processAudioChunk(audioBuffer, Date.now());
                        }
                    } else {
                        // Only log if it's a large non-JSON message (likely a real error)
                        console.error('❌ Error processing gaming assistant message:', jsonError.message);
                    }
                }
                
            } catch (error) {
                console.error('❌ Error in gaming assistant message handler:', error.message);
            }
        });
        
        clientWS.on('close', (code, reason) => {
            log('🔌 Gaming assistant client disconnected:', {
                sessionId,
                code,
                reason: reason.toString(),
                timestamp: new Date().toISOString()
            });
            
            // ✅ Clear the connection from the session when it closes
            const session = gamingOrchestrator?.activeSessions?.get(sessionId);
            if (session && session.clientConnection === clientWS) {
                log('🧹 Clearing closed connection from session');
                session.clientConnection = null;
            }
        });
        
        clientWS.on('error', (error) => {
            console.error('❌ Gaming assistant WebSocket error:', error.message);
            console.error('   Session:', sessionId);
            console.error('   Timestamp:', new Date().toISOString());
        });
        
    } catch (error) {
        console.error('❌ Error setting up gaming assistant connection:', error.message);
        clientWS.close(4500, 'Internal server error');
    }
});

gamingWSS.on('error', (error) => {
    console.error('❌ Gaming Assistant WebSocket server error:', error);
});
}
// End of setupGamingWebSocket function

// Orchestrator event handlers will be set up after orchestrator is initialized (see below)

// Graceful shutdown handler
process.on('SIGINT', async () => {
    log('🛑 Received SIGINT, shutting down gracefully...');
    
    try {
        if (gamingOrchestrator) {
            await gamingOrchestrator.shutdown();
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error.message);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    log('🛑 Received SIGTERM, shutting down gracefully...');
    
    try {
        if (gamingOrchestrator) {
            await gamingOrchestrator.shutdown();
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error.message);
        process.exit(1);
    }
});

// Text-to-speech endpoint
app.post('/api/text-to-speech', async (req, res) => {
    log('🔊 Text-to-speech request received');
    
    try {
        const { text } = req.body;
        log('   📝 Text to speak:', text);

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Use OpenAI's text-to-speech API
        const mp3 = await openai.audio.speech.create({
            model: 'tts-1',
            voice: 'alloy', // You can change this to 'echo', 'fable', 'onyx', 'nova', or 'shimmer'
            input: text,
        });

        log('   ✅ Audio generated successfully');

        // Convert the response to a buffer
        const buffer = Buffer.from(await mp3.arrayBuffer());

        // Set appropriate headers for audio response
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);

    } catch (error) {
        console.error('❌ Error generating speech:', error.message);
        res.status(500).json({ 
            error: 'Failed to generate speech',
            details: error.message
        });
    }
});

// Helper function to check if guide already exists in database
async function checkExistingGuide(videoId) {
    try {
        // First get the guide, but only if it's completed or explicitly failed
        // For backward compatibility, also accept guides without processing_status (treat as completed)
        const guideResult = await pool.query(
            'SELECT * FROM guides WHERE youtube_id = $1 AND (processing_status IS NULL OR processing_status IN ($2, $3))',
            [videoId, 'completed', 'failed']
        );

        if (guideResult.rows.length === 0) {
            return null;
        }

        const guide = guideResult.rows[0];

        // Then get the steps separately
        const stepsResult = await pool.query(
            'SELECT * FROM steps WHERE guide_id = $1 ORDER BY step_number',
            [guide.id]
        );

        // If guide exists but has no steps, treat it as incomplete/failed and re-process
        if (stepsResult.rows.length === 0) {
            log(`⚠️ Found guide ${guide.id} but it has 0 steps - treating as incomplete`);
            // Delete it to clean up zombie entry and force reprocessing
            await pool.query('DELETE FROM guides WHERE id = $1', [guide.id]);
            log(`🧹 Deleted incomplete guide ${guide.id}`);
            return null;
        }

        return {
            id: guide.id,
            title: guide.title,
            channel_title: guide.channel_title,
            duration: guide.duration,
            transcript: guide.transcript,
            steps: stepsResult.rows
        };
        
    } catch (error) {
        console.error('❌ Error checking existing guide:', error.message);
        return null;
    }
}

// Helper function to parse video duration from ISO 8601 or seconds
function parseVideoDuration(duration) {
    if (typeof duration === 'string') {
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
            const hours = parseInt(match[1] || 0);
            const minutes = parseInt(match[2] || 0);
            const seconds = parseInt(match[3] || 0);
            return hours * 3600 + minutes * 60 + seconds;
        }
    }
    return Number(duration) || 0;
}

// Detect guide type: walkthrough vs tips/builds/info
async function detectGuideType(youtubeUrl, videoData) {
    const classificationPrompt = `Analyze this YouTube gaming video and determine its type based on title and first 2 minutes of content.

Video Title: "${videoData.title}"
Channel: ${videoData.channelTitle}

Classify as ONE of these types:
1. "walkthrough" - Sequential step-by-step progression through game content (main story, quest lines, missions)
2. "tips" - General gameplay tips, tricks, best practices, beginner guides
3. "builds" - Character builds, skill trees, stat allocation, equipment loadouts
4. "locations" - Item locations, secret areas, collectibles, map guides
5. "bosses" - Boss strategies, boss fight guides, specific enemy tactics
6. "summary" - Mixed content, review, lore discussion, or unclear structure (use when video doesn't fit other categories)

Respond with ONLY the type word (walkthrough/tips/builds/locations/bosses/summary).`;

    try {
        const result = await geminiModel.generateContent([
            {
                fileData: {
                    fileUri: youtubeUrl,
                    mimeType: "video/mp4"
                }
            },
            { text: classificationPrompt }
        ]);

        const type = result.response.text().trim().toLowerCase();
        const validTypes = ['walkthrough', 'tips', 'builds', 'locations', 'bosses', 'summary'];

        if (validTypes.includes(type)) {
            return type;
        }

        // Default to summary if completely unclear
        console.warn('   ⚠️ Unclear guide type, defaulting to "summary" (bullet-point extraction)');
        return 'summary';

    } catch (error) {
        console.error('❌ Guide type detection failed:', error.message);
        // Default to summary on error
        return 'summary';
    }
}

// Build walkthrough extraction prompt (sequential steps)
function buildWalkthroughPrompt(videoData) {
    return `Analyze this gaming WALKTHROUGH video and provide:

1. FULL TRANSCRIPT: Transcribe all the spoken content.

2. STEP-BY-STEP GUIDE: Extract sequential, actionable steps. Each step:
   - step_number: Sequential number (1, 2, 3...)
   - title: Brief step title
   - action: Detailed instructions (100-200 words)
   - visual_cues: What player will see (80-150 words)
   - observe: Success indicators
   - fallback: Troubleshooting alternatives
   - resources: Required items/prerequisites
   - strategic_context: Why it matters (60-120 words)
   - estimated_time: Time in minutes

Video: ${videoData.title}

Format response as:
TRANSCRIPT:
[Full transcript]

GUIDE_STEPS:
[
  {step_number: 1, title: "...", action: "...", ...}
]`;
}

// Build tips/info extraction prompt (thematic chunks, not sequential)
function buildTipsPrompt(videoData, guideType) {
    const typeDescriptions = {
        tips: 'gameplay tips, tricks, and best practices',
        builds: 'character builds, skill trees, stat allocations, equipment recommendations',
        locations: 'item locations, secret areas, collectibles, map information',
        bosses: 'boss strategies, attack patterns, weaknesses, phase transitions'
    };

    const typeDescription = typeDescriptions[guideType] || 'useful information';

    return `Analyze this gaming ${guideType.toUpperCase()} video and extract ${typeDescription}.

Video: ${videoData.title}

1. FULL TRANSCRIPT: Transcribe all spoken content.

2. INFORMATION CHUNKS: Extract as separate, searchable chunks (NOT sequential steps).
   Each chunk represents ONE complete tip/build/location/strategy.

   Format each chunk as:
   {
     "step_number": N (just for ordering, not actual "steps"),
     "title": "Descriptive title (e.g., 'Strength Build for Early Game', 'Hidden Chest in Cathedral')",
     "action": "COMPLETE detailed description (150-300 words). For tips: full explanation with examples. For builds: complete stat allocation, equipment, playstyle. For locations: exact location, how to get there, what you find. For bosses: full strategy with attack patterns.",
     "visual_cues": "Visual identifiers to recognize this tip/build/location (80-120 words)",
     "observe": "How to know if you're doing it right / what confirms you found it",
     "fallback": "Alternatives if this doesn't work for your situation",
     "resources": "Requirements (level, stats, items, prerequisites)",
     "strategic_context": "When/why to use this (80-120 words)",
     "estimated_time": "N/A for tips, or time estimate for locations"
   }

CRITICAL: Each chunk should be SELF-CONTAINED and COMPLETE. Don't reference "Step 1" or "previous step" - each is independent.

Format response as:
TRANSCRIPT:
[Full transcript]

GUIDE_STEPS:
[
  {step_number: 1, title: "Tip/Build/Location 1", action: "Complete description...", ...},
  {step_number: 2, title: "Tip/Build/Location 2", action: "Complete description...", ...}
]`;
}

// Build summary extraction prompt (fallback for unclear/mixed content)
function buildSummaryPrompt(videoData) {
    return `Analyze this gaming video and extract ALL useful facts as bullet points.

Video: ${videoData.title}

1. FULL TRANSCRIPT: Transcribe all spoken content.

2. KEY FACTS SUMMARY: Extract ALL useful game information as bullet points.
   Group by topic when possible (Combat, Items, Locations, Strategy, etc.)

   Format as a SINGLE entry:
   {
     "step_number": 1,
     "title": "Video Summary: ${videoData.title}",
     "action": "FORMAT AS BULLET POINTS:\n\n**Main Topics Covered:**\n• Topic 1\n• Topic 2\n\n**Key Information:**\n• Fact 1 with full details\n• Fact 2 with full details\n• Fact 3 with full details\n\n**Important Details:**\n• Detail 1\n• Detail 2\n\n**Gameplay Tips Mentioned:**\n• Tip 1\n• Tip 2\n\nInclude ALL factual information: item names, locations, stats, strategies, enemy details, quest info, character names, etc. Be COMPREHENSIVE - extract everything useful.",
     "visual_cues": "Key visual elements mentioned in video",
     "observe": "N/A",
     "fallback": "N/A",
     "resources": "N/A",
     "strategic_context": "Context: This is a mixed-content video covering multiple topics. Use bullet points above to answer specific questions.",
     "estimated_time": "N/A"
   }

CRITICAL: Extract EVERYTHING factual from the video. Don't summarize or skip details - list ALL:
- Item names and locations
- Character names and stats
- Enemy types and strategies
- Quest steps and objectives
- Location names and directions
- Combat tips and mechanics
- Lore and story details

Format response as:
TRANSCRIPT:
[Full transcript]

GUIDE_STEPS:
[
  {step_number: 1, title: "Video Summary: ...", action: "**Main Topics:**\n• ...", ...}
]`;
}

// Helper function to process video with Gemini AI (transcript + guide steps in one call)
async function processVideoWithGemini(youtubeUrl, videoData, guideId = null) {
    log('🤖 Processing video with Gemini AI...');
    log('   🔗 YouTube URL:', youtubeUrl);
    log('   📹 Video:', videoData.title);
    log('   ⏱️ Video duration:', videoData.duration);

    try {
        // Parse duration using helper
        const durationSeconds = parseVideoDuration(videoData.duration);

        // Check if video is very long (>15 minutes) and needs chunking
        const durationMinutes = Math.floor(durationSeconds / 60);
        const shouldChunk = durationMinutes > 15;

        if (shouldChunk) {
            log(`🎬 Long video detected (${durationMinutes}min) - using chunked processing`);
            return await processVideoInChunks(youtubeUrl, videoData, guideId);
        }

        // STEP 1: Detect guide type first
        log('🔍 Detecting guide type (walkthrough vs tips/info)...');
        const guideType = await detectGuideType(youtubeUrl, videoData);
        log('   ✅ Guide type detected:', guideType);

        // STEP 2: Use appropriate extraction prompt based on type
        let prompt;
        if (guideType === 'walkthrough') {
            prompt = buildWalkthroughPrompt(videoData);
        } else if (guideType === 'summary') {
            prompt = buildSummaryPrompt(videoData);
        } else {
            // tips, builds, locations, bosses
            prompt = buildTipsPrompt(videoData, guideType);
        }

        log('📤 Sending request to Gemini with', guideType, 'extraction prompt...');

        // Add timeout and retry logic for Gemini requests
        const maxRetries = 3;
        const timeoutMs = 600000; // 10 minutes for video processing (supports up to 60min videos)

        let lastError;
        let text; // Declare text variable outside the loop

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                log(`🔄 Gemini attempt ${attempt}/${maxRetries}...`);

                // Create timeout promise
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Gemini request timeout after ${timeoutMs}ms (attempt ${attempt})`));
                    }, timeoutMs);
                });

                // Create Gemini request promise
                const geminiPromise = geminiModel.generateContent([
                    {
                        fileData: {
                            fileUri: youtubeUrl,
                            mimeType: "video/mp4" // Gemini will handle YouTube URLs
                        }
                    },
                    { text: prompt }
                ]);

                // Race between Gemini request and timeout
                const result = await Promise.race([geminiPromise, timeoutPromise]);
                const response = result.response;
                text = response.text(); // Assign to outer variable

                log(`✅ Gemini response received on attempt ${attempt}`);
                break; // Success, exit retry loop

            } catch (error) {
                lastError = error;
                console.error(`❌ Gemini attempt ${attempt} failed:`, error.message);

                // If this is the last attempt, throw the error
                if (attempt === maxRetries) {
                    throw error;
                }

                // Wait before retry (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                log(`⏳ Retrying Gemini request in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        log('📥 Gemini response received');
        log('   📊 Response length:', text.length);
        log('   🔤 First 200 chars:', text.substring(0, 200));
        
        // Parse the response to extract transcript and steps
        const { transcript, guideSteps } = parseGeminiResponse(text);
        
        log('✅ Gemini processing successful');
        log('   📝 Transcript length:', transcript.length);
        log('   📋 Steps extracted:', guideSteps.length);
        log('   🏷️ Guide type:', guideType);

        return { transcript, guideSteps, guideType };
        
    } catch (error) {
        console.error('❌ Gemini processing failed after all retries:', error.message);
        console.error('   Stack trace:', error.stack);

        // Don't waste money on OpenAI with description data
        log('⚠️ Gemini failed - returning minimal fallback data');

        // Provide more specific error feedback based on error type
        let fallbackTranscript = videoData.description || '';
        let errorMessage = 'Video processing failed';

        if (error.message.includes('timeout')) {
            errorMessage = 'Video processing timed out - the video may be too long or complex';
            fallbackTranscript = `Unable to process video automatically. ${fallbackTranscript}`;
        } else if (error.message.includes('503') || error.message.includes('Service Unavailable')) {
            errorMessage = 'Gemini AI service is temporarily unavailable - please try again later';
            fallbackTranscript = `Unable to process video automatically. ${fallbackTranscript}`;
        } else {
            errorMessage = 'Video processing failed - please try a different video or try again later';
            fallbackTranscript = `Unable to process video automatically. ${fallbackTranscript}`;
        }

        log(`   🚨 Error type: ${errorMessage}`);

        return {
            transcript: fallbackTranscript,
            guideSteps: [{
                step_number: 1,
                title: "Video Processing Failed",
                action: `Unable to process "${videoData.title}". The video analysis service encountered an error.`,
                observe: "Video processing error",
                fallback: "Try a different video or contact support",
                resources: "None",
                estimated_time: "0"
            }],
            guideType: 'tips' // Default to tips on error
        };
    }
}

// Helper function to process long videos in chunks
async function processVideoInChunks(youtubeUrl, videoData, guideId = null) {
    log('🎬 Starting chunked video processing...');

    const durationSeconds = parseVideoDuration(videoData.duration);
    const durationMinutes = Math.floor(durationSeconds / 60);
    const chunkSizeMinutes = 10; // Process in 10-minute chunks
    const totalChunks = Math.ceil(durationMinutes / chunkSizeMinutes);

    log(`📊 Video breakdown: ${durationMinutes}min total, ${chunkSizeMinutes}min chunks, ${totalChunks} total chunks`);

    // Initialize segment tracking in database
    if (guideId) {
        try {
            await pool.query(
                'UPDATE guides SET total_segments = $1, processed_segments = 0 WHERE id = $2',
                [totalChunks, guideId]
            );
            log(`📊 Initialized progress tracking: 0/${totalChunks} segments`);
        } catch (err) {
            console.warn('⚠️ Could not initialize segment tracking:', err.message);
        }
    }

    const allTranscripts = [];
    const allSteps = [];

    for (let chunk = 0; chunk < totalChunks; chunk++) {
        const startTime = chunk * chunkSizeMinutes * 60; // Convert to seconds
        const endTime = Math.min((chunk + 1) * chunkSizeMinutes * 60, durationSeconds || 3600);

        log(`🔄 Processing chunk ${chunk + 1}/${totalChunks} (${startTime}s - ${endTime}s)`);

        try {
            const chunkPrompt = `Analyze this ${chunkSizeMinutes}-minute segment of a gaming guide YouTube video (segment ${chunk + 1} of ${totalChunks}) and provide:

1. TRANSCRIPT: Transcribe all the spoken content from this video segment with timestamps where relevant.

2. STEP-BY-STEP GUIDE: Extract DEEPLY DETAILED, knowledge-rich, actionable steps that a player should follow for THIS SEGMENT ONLY. Each step should include:

REQUIRED FIELDS (all must be detailed and specific):
- Action: GRANULAR step-by-step instructions with specific button presses, movements, sequences, and exact actions (100-200 words)
- Visual_Cues: RICH visual descriptions of UI elements, landmarks, colors, screen positions, animations (80-150 words)
- Observe: Specific indicators of success/progress - notifications, quest updates, dialogue triggers
- Fallback: Detailed troubleshooting with multiple alternatives if the step fails
- Resources: Comprehensive list of required items, equipment, abilities, stats, prerequisites
- Strategic_Context: WHY this step matters - what it unlocks, strategic implications, connections to progression (60-120 words)
- Estimated_time: Realistic time estimate in minutes

DEPTH REQUIREMENTS:
- Be SPECIFIC with button prompts: "Press Y to mount", "Hold B to sprint"
- Include exact directions: "north-east for 300 meters past the stone archway"
- Describe visual feedback: "golden quest marker appears in top-right minimap"
- Explain strategic importance: "essential for unlocking crafting system"

IMPORTANT: This is segment ${chunk + 1} of ${totalChunks}. Focus only on content from ${Math.floor(startTime/60)}:${(startTime%60).toString().padStart(2,'0')} to ${Math.floor(endTime/60)}:${(endTime%60).toString().padStart(2,'0')}.

Video Title: ${videoData.title} (Segment ${chunk + 1}/${totalChunks})
Channel: ${videoData.channelTitle}

Please format your response as follows:

TRANSCRIPT:
[Full transcript of spoken content in this segment]

GUIDE_STEPS:
[
  {
    "step_number": ${(chunk * 100) + 1},
    "title": "Brief step title",
    "action": "GRANULAR, detailed action description with specific button presses, movements, and sequences (100-200 words)",
    "visual_cues": "RICH visual descriptions of what player sees on screen - UI elements, landmarks, colors, positions (80-150 words)",
    "observe": "Specific indicators of success/progress",
    "fallback": "Detailed troubleshooting with multiple alternatives",
    "resources": "Comprehensive list of required items, equipment, abilities, prerequisites",
    "strategic_context": "WHY this step matters - what it unlocks, strategic implications, progression impact (60-120 words)",
    "estimated_time": "Time estimate in minutes"
  }
]

Extract EVERY piece of useful information from this segment - button prompts, visual landmarks, strategic tips, exact locations, timing details. The AI needs RICH, KNOWLEDGE-DENSE steps.`;

            const chunkResult = await processVideoChunk(youtubeUrl, chunkPrompt, chunk + 1, totalChunks);

            if (chunkResult.transcript) {
                // Add segment marker to transcript
                const segmentTranscript = `[SEGMENT ${chunk + 1}/${totalChunks}]\n${chunkResult.transcript}`;
                allTranscripts.push(segmentTranscript);
            }

            if (chunkResult.guideSteps && chunkResult.guideSteps.length > 0) {
                // Adjust step numbers for this chunk
                const adjustedSteps = chunkResult.guideSteps.map(step => ({
                    ...step,
                    step_number: (chunk * 100) + step.step_number
                }));
                allSteps.push(...adjustedSteps);
                log(`   ➕ Added ${adjustedSteps.length} steps from chunk ${chunk + 1} (total now: ${allSteps.length})`);
            } else {
                console.warn(`   ⚠️ Chunk ${chunk + 1} returned NO steps!`);
            }

            log(`✅ Chunk ${chunk + 1}/${totalChunks} processed successfully`);
            
            // Update segment progress in database
            if (guideId) {
                try {
                    await pool.query(
                        'UPDATE guides SET processed_segments = $1 WHERE id = $2',
                        [chunk + 1, guideId]
                    );
                    log(`📊 Progress updated: ${chunk + 1}/${totalChunks} segments (${Math.floor((chunk + 1) / totalChunks * 100)}%)`);
                } catch (err) {
                    console.warn('⚠️ Could not update segment progress:', err.message);
                }
            }

        } catch (chunkError) {
            console.error(`❌ Failed to process chunk ${chunk + 1}/${totalChunks}:`, chunkError.message);

            // For long videos, we can continue with other chunks even if one fails
            if (totalChunks <= 3) {
                throw chunkError; // For short videos, fail fast
            }

            log(`⏭️ Continuing with remaining chunks despite chunk ${chunk + 1} failure`);
        }
    }

    // Combine all transcripts and steps
    const combinedTranscript = allTranscripts.join('\n\n');
    const sortedSteps = allSteps.sort((a, b) => a.step_number - b.step_number);

    log(`🎉 Chunked processing complete:`);
    log(`   📝 Combined transcript length: ${combinedTranscript.length}`);
    log(`   📋 Total steps accumulated: ${sortedSteps.length}`);
    log(`   🔍 Steps array details:`, JSON.stringify(sortedSteps.slice(0, 2), null, 2));

    // Default to 'walkthrough' for chunked videos (they use walkthrough-style prompts)
    const guideType = 'walkthrough';
    log(`   🏷️ Guide type (chunked): ${guideType}`);

    return {
        transcript: combinedTranscript,
        guideSteps: sortedSteps,
        guideType // FIX: Include guideType in return
    };
}

// Helper function to process a single video chunk
async function processVideoChunk(youtubeUrl, prompt, chunkNumber, totalChunks) {
    const maxRetries = 3;
    const timeoutMs = 600000; // 10 minutes per chunk

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log(`🔄 Processing chunk ${chunkNumber}/${totalChunks}, attempt ${attempt}/${maxRetries}...`);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Chunk ${chunkNumber} timeout after ${timeoutMs}ms (attempt ${attempt})`));
                }, timeoutMs);
            });

            const geminiPromise = geminiModel.generateContent([
                {
                    fileData: {
                        fileUri: youtubeUrl,
                        mimeType: "video/mp4"
                    }
                },
                { text: prompt }
            ]);

            const result = await Promise.race([geminiPromise, timeoutPromise]);
            const response = result.response;
            const text = response.text();

            const { transcript, guideSteps } = parseGeminiResponse(text);

            log(`✅ Chunk ${chunkNumber}/${totalChunks} processed on attempt ${attempt}`);

            return { transcript, guideSteps };

        } catch (error) {
            console.error(`❌ Chunk ${chunkNumber} attempt ${attempt} failed:`, error.message);

            if (attempt === maxRetries) {
                throw error;
            }

            const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            log(`⏳ Retrying chunk ${chunkNumber} in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Helper function to parse Gemini's response into transcript and steps
function parseGeminiResponse(text) {
    try {
        // Split response into transcript and steps sections
        const transcriptMatch = text.match(/TRANSCRIPT:\s*([\s\S]*?)\s*GUIDE_STEPS:/);
        const stepsMatch = text.match(/GUIDE_STEPS:\s*([\s\S]*?)$/);
        
        let transcript = '';
        let guideSteps = [];
        
        if (transcriptMatch && transcriptMatch[1]) {
            transcript = transcriptMatch[1].trim();
            log('📝 Extracted transcript section');
        }
        
        if (stepsMatch && stepsMatch[1]) {
            try {
                // Try to parse the JSON steps
                let stepsText = stepsMatch[1].trim();
                
                // ✅ Fix incomplete JSON from Gemini
                log('🧹 Fixing incomplete JSON response...');
                log('   📏 Raw JSON length:', stepsText.length);
                log('   🔤 Last 50 chars:', stepsText.substring(stepsText.length - 50));
                
                // Replace backticks that cause parsing issues
                stepsText = stepsText.replace(/`/g, "'");
                
                // Remove trailing commas
                stepsText = stepsText.replace(/,(\s*[}\]])/g, '$1');
                
                // Check for incomplete JSON objects
                const lastCompleteObjectEnd = stepsText.lastIndexOf('}');
                const arrayEnd = stepsText.lastIndexOf(']');
                
                if (lastCompleteObjectEnd > arrayEnd) {
                    // We have a complete object after the last ], so array is incomplete
                    log('🔧 Found incomplete JSON - truncating at last complete object');
                    stepsText = stepsText.substring(0, lastCompleteObjectEnd + 1) + ']';
                    log('   ✂️ Truncated to:', stepsText.substring(stepsText.length - 20));
                }
                
                log('🧹 JSON fixed and ready for parsing');
                
                guideSteps = JSON.parse(stepsText);
                log('📋 Parsed JSON steps successfully');
            } catch (parseError) {
                log('⚠️ JSON parse failed, trying to extract JSON array...');
                log('   Error:', parseError.message);
                
                // Try to find JSON array in the text
                const jsonMatch = stepsMatch[1].match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    try {
                        let cleanJson = jsonMatch[0];
                        log('🧹 Applying enhanced JSON cleaning to extracted array...');
                        
                        // Apply same cleaning to extracted JSON
                        log('🧹 Cleaning extracted JSON...');
                        
                        cleanJson = cleanJson.replace(/,(\s*[}\]])/g, '$1');
                        cleanJson = cleanJson.replace(/`/g, "'");
                        
                        // Fix incomplete objects in extracted JSON
                        const openBraces = (cleanJson.match(/\{/g) || []).length;
                        const closeBraces = (cleanJson.match(/\}/g) || []).length;
                        
                        if (openBraces > closeBraces) {
                            log('🔧 Extracted JSON incomplete, truncating at last complete object');
                            const lastCompleteEnd = cleanJson.lastIndexOf('}');
                            if (lastCompleteEnd > -1) {
                                cleanJson = cleanJson.substring(0, lastCompleteEnd + 1) + ']';
                            }
                        }
                        
                        log('🧹 Extracted JSON structure fixed');
                        
                        guideSteps = JSON.parse(cleanJson);
                        log('✅ Extracted JSON array successfully');
                    } catch (extractError) {
                        console.error('❌ Failed to parse extracted JSON:', extractError.message);
                        log('   Problematic JSON:', jsonMatch[0].substring(0, 200));
                        guideSteps = [];
                    }
                }
            }
        }
        
        // Fallback if no steps were parsed
        if (!guideSteps || guideSteps.length === 0) {
            log('⚠️ No steps parsed, creating fallback step');
            guideSteps = [{
                step_number: 1,
                title: "Guide Analysis",
                action: "Review the video content and follow the instructions provided",
                observe: "Video content and spoken instructions",
                fallback: "Rewatch the video if unclear",
                resources: "None specified",
                estimated_time: "Variable"
            }];
        }
        
        return { transcript, guideSteps };
        
    } catch (error) {
        console.error('❌ Error parsing Gemini response:', error.message);
        return { 
            transcript: text, // Return full response as transcript
            guideSteps: [{
                step_number: 1,
                title: "Processing Error",
                action: "Unable to parse guide steps from video",
                observe: "Video content",
                fallback: "Try processing the video again",
                resources: "None",
                estimated_time: "0"
            }]
        };
    }
}

// Helper function to extract video ID from YouTube URL
function extractVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// Helper function to fetch video data from YouTube API
async function fetchVideoData(videoId) {
    try {
        const response = await youtube.videos.list({
            part: 'snippet,contentDetails',
            id: videoId
        });

        if (response.data.items.length === 0) {
            throw new Error('Video not found');
        }

        const video = response.data.items[0];
        return {
            title: video.snippet.title,
            description: video.snippet.description,
            duration: video.contentDetails.duration,
            channelTitle: video.snippet.channelTitle,
            publishedAt: video.snippet.publishedAt
        };
    } catch (error) {
        console.error('Error fetching video data:', error);
        throw error;
    }
}





// Helper function to process video data with OpenAI
async function processWithOpenAI(videoData, transcript) {
    log('🤖 Processing with OpenAI...');
    log('   📹 Video:', videoData.title);
    log('   📝 Description length:', videoData.description?.length || 0);
    log('   📄 Transcript length:', transcript?.length || 0);

    try {
        const contentSource = transcript || videoData.description || '';
        
        if (!contentSource.trim()) {
            console.warn('⚠️ No content available for processing');
            return [{
                step_number: 1,
                title: "No detailed steps available",
                action: "This video doesn't have accessible captions or description content. Please try a different video or check if captions are available.",
                observe: "Video content not accessible",
                fallback: "Try finding an alternative guide with captions",
                resources: "None",
                estimated_time: "0"
            }];
        }

        const prompt = `Analyze this gaming guide video and extract DEEPLY DETAILED, knowledge-rich, structured step-by-step instructions.

Video Title: ${videoData.title}
Channel: ${videoData.channelTitle}
Content: ${contentSource.substring(0, 4000)} ${contentSource.length > 4000 ? '...' : ''}

Extract COMPREHENSIVE, actionable steps that a player should follow. Each step MUST include:

REQUIRED FIELDS (all must be detailed and specific):
- Action: GRANULAR step-by-step instructions with specific button presses, movements, sequences (100-200 words). Include exact directions, button prompts, precise actions.
- Visual_Cues: RICH visual descriptions - UI elements, landmarks, colors, screen positions, animations, environmental features (80-150 words)
- Observe: Specific indicators of success/progress - quest updates, notifications, dialogue triggers, sound cues
- Fallback: Detailed troubleshooting with multiple alternatives if the step fails
- Resources: Comprehensive list of required items, equipment, abilities, stats, prerequisites, recommended gear
- Strategic_Context: WHY this step matters - what it unlocks, strategic implications, progression connections, difficulty warnings (60-120 words)
- Estimated_time: Realistic time estimate in minutes

DEPTH REQUIREMENTS:
- Be SPECIFIC: "Press Y to mount Torrent, hold B to sprint north-east for 300 meters past the stone archway"
- Describe visuals: "golden quest marker in top-right minimap, blue glow on interactable door"
- Explain importance: "essential for unlocking crafting system needed for mid-game bosses"

If the content doesn't contain specific gameplay instructions, create detailed general guide steps based on the video title and what you can infer about the game/walkthrough. Still provide rich detail and strategic context.

Format the response as a JSON array of step objects with the following structure:
[
  {
    "step_number": 1,
    "title": "Brief step title",
    "action": "GRANULAR detailed action with button presses and exact movements (100-200 words)",
    "visual_cues": "RICH visual descriptions of UI, landmarks, colors, positions (80-150 words)",
    "observe": "Specific success indicators",
    "fallback": "Detailed troubleshooting alternatives",
    "resources": "Comprehensive required items and prerequisites",
    "strategic_context": "WHY this matters - unlocks, implications, connections (60-120 words)",
    "estimated_time": "Time estimate in minutes"
  }
]

Make the steps as DETAILED and KNOWLEDGE-RICH as possible. Extract EVERY useful piece of information. The AI needs comprehensive, granular steps to provide truly helpful real-time guidance.

IMPORTANT: Always return a valid JSON array, even if you have to create general steps based on the video title. Never return plain text explanations.`;

        log('📤 Sending request to OpenAI...');
        const completion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert gaming guide analyzer. Extract detailed, step-by-step instructions from gaming videos that players can follow in real-time during gameplay. Always respond with valid JSON only.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 2000
        });

        const response = completion.choices[0].message.content.trim();
        log('📥 OpenAI response received');
        log('   📊 Response length:', response.length);
        log('   🔤 First 100 chars:', response.substring(0, 100));

        let steps;
        try {
            steps = JSON.parse(response);
            log('✅ Successfully parsed JSON');
            log('   📋 Steps extracted:', steps.length);
        } catch (parseError) {
            console.error('❌ JSON parse error:', parseError.message);
            log('🔧 Attempting to clean response...');
            
            // Try to extract JSON from the response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try {
                    steps = JSON.parse(jsonMatch[0]);
                    log('✅ Successfully parsed cleaned JSON');
                } catch (cleanParseError) {
                    console.error('❌ Failed to parse cleaned JSON:', cleanParseError.message);
                    throw new Error('OpenAI returned invalid JSON format');
                }
            } else {
                throw new Error('No JSON array found in OpenAI response');
            }
        }

        if (!Array.isArray(steps) || steps.length === 0) {
            throw new Error('OpenAI returned empty or invalid steps array');
        }

        return steps;
    } catch (error) {
        console.error('❌ Error processing with OpenAI:', error.message);
        console.error('   Stack trace:', error.stack);
        throw error;
    }
}

// Helper function to create/update guide with processing status
async function createProcessingGuide(videoId, videoData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const existing = await client.query('SELECT id FROM guides WHERE youtube_id = $1', [videoId]);
        let guideId;
        
        if (existing.rows.length > 0) {
            guideId = existing.rows[0].id;
            log('📝 Updating existing guide status to processing:', guideId);
            await client.query(
                'UPDATE guides SET processing_status = $2, updated_at = NOW() WHERE id = $1',
                [guideId, 'processing']
            );
        } else {
            log('➕ Creating new guide placeholder for:', videoId);
            const res = await client.query(
                'INSERT INTO guides (youtube_id, title, description, channel_title, duration, processing_status, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id',
                [videoId, videoData.title, videoData.description, videoData.channelTitle, videoData.duration, 'processing']
            );
            guideId = res.rows[0].id;
        }
        
        await client.query('COMMIT');
        return guideId;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error creating processing guide:', e.message);
        throw e;
    } finally {
        client.release();
    }
}

// Helper function to store guide in database with transcript
async function storeGuide(videoId, videoData, steps, transcript = '', guideType = 'tips') {
    log('💾 storeGuide called with:');
    log(`   🎥 Video ID: ${videoId}`);
    log(`   📋 Steps array length: ${steps?.length || 0}`);
    log(`   📝 Transcript length: ${transcript?.length || 0}`);
    log(`   🏷️ Guide type: ${guideType}`);

    if (!steps || steps.length === 0) {
        console.error('❌ CRITICAL: storeGuide received EMPTY steps array!');
        console.error('   This will result in a guide with 0 steps.');
    }

    const client = await pool.connect();
    let guideId; // ✅ FIX: Declare outside try block so it's accessible in catch block

    try {
        await client.query('BEGIN');

        // Check if guide already exists
        const existingGuide = await client.query(
            'SELECT id FROM guides WHERE youtube_id = $1',
            [videoId]
        );

        if (existingGuide.rows.length > 0) {
            // Guide exists, update it
            guideId = existingGuide.rows[0].id;
            log('📝 Guide already exists, updating with ID:', guideId);

            await client.query(
                'UPDATE guides SET title = $2, description = $3, channel_title = $4, duration = $5, transcript = $6, guide_type = $7, updated_at = NOW() WHERE id = $1',
                [guideId, videoData.title, videoData.description, videoData.channelTitle, videoData.duration, transcript, guideType]
            );

            // Delete existing steps
            await client.query('DELETE FROM steps WHERE guide_id = $1', [guideId]);
        } else {
            // Create new guide
            log('➕ Creating new guide for video:', videoId);

            // Set status to 'processing' before starting
            const statusResult = await client.query(
                'INSERT INTO guides (youtube_id, title, description, channel_title, duration, transcript, guide_type, processing_status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id',
                [videoId, videoData.title, videoData.description, videoData.channelTitle, videoData.duration, transcript, guideType, 'processing']
            );

            guideId = statusResult.rows[0].id;
        }

        // Insert new steps
        log('📋 Inserting', steps.length, 'steps for guide:', guideId);
        
        // ✅ FIX: Renumber steps sequentially to avoid duplicates from decimals like "2.1", "2.2"
        let stepIndex = 1;
        for (const step of steps) {
            log(`   📝 Step ${stepIndex}: ${step.title} (original: ${step.step_number})`);
            
            await client.query(
                'INSERT INTO steps (guide_id, step_number, title, action, visual_cues, observe, fallback, resources, strategic_context, estimated_time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [guideId, stepIndex, step.title, step.action, step.visual_cues || step.observe, step.observe, step.fallback, step.resources, step.strategic_context || '', step.estimated_time]
            );
            
            stepIndex++;
        }

        // Update status to completed on success
        await client.query('UPDATE guides SET processing_status = $1 WHERE id = $2', ['completed', guideId]);

        await client.query('COMMIT');
        log('✅ Guide stored successfully with ID:', guideId);
        return guideId;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error storing guide:', error.message);
        console.error('   Stack trace:', error.stack);

        // Update status to failed only if guideId was assigned
        if (guideId) {
            try {
                await client.query('UPDATE guides SET processing_status = $1 WHERE id = $2', ['failed', guideId]);
                log('   ⚠️ Guide status updated to failed');
            } catch (updateError) {
                console.error('   ❌ Failed to update error status:', updateError.message);
            }
        } else {
            console.warn('   ⚠️ guideId was undefined, skipping status update');
        }

        throw error;
    } finally {
        client.release();
    }
}

// Start HTTP server
const server = app.listen(PORT, () => {
    log(`✅ EarlyGod.ai backend running successfully on port ${PORT}`);
    log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    log(`🗄️  Database: Connected to Neon Postgres`);
    log(`🤖 OpenAI: API configured`);
    log(`📺 YouTube: API configured`);

    // Start SaveFileWatcher for automatic checkpoint detection (local dev only)
    if (process.env.NODE_ENV !== 'production') {
        const saveWatcher = new SaveFileWatcher({
            gameTitle: 'Clair Obscur: Expedition 33',
            pollInterval: 5000, // Check every 5 seconds
            onCheckpoint: (checkpointName, source) => {
                log(`🎮 [SaveWatcher] New checkpoint completed: ${checkpointName}`);
            }
        });

        saveWatcher.start().then(started => {
            if (started) {
                log(`🎮 SaveFileWatcher: Monitoring game progress`);
            } else {
                log(`⚠️ SaveFileWatcher: Could not start (save file not found)`);
            }
        });

        // Make watcher accessible for API endpoints
        app.locals.saveWatcher = saveWatcher;
    }
});

// Set server timeout to 20 minutes to support long video processing (default is often 2 minutes)
server.timeout = 1200000; // 20 minutes
server.keepAliveTimeout = 1200000; // 20 minutes
server.headersTimeout = 1200005; // Slightly higher than keepAliveTimeout

// WebSocket upgrade handling will be configured after orchestrator initializes

// Create WebSocket server for voice agent using noServer mode
const wss = new WebSocket.Server({ noServer: true });

log('🎤 WebSocket server created for voice agent (noServer mode)');

// Create voice mode WebSocket server
const wssVoiceMode = new WebSocket.Server({ noServer: true });
log('🎤 Voice mode WebSocket server created (noServer mode)');

// Import and initialize the new Cluely-style Gaming Assistant Orchestrator FIRST
let GamingAssistantOrchestrator, gamingOrchestrator, gamingWSS;
try {
    GamingAssistantOrchestrator = require('./GamingAssistantOrchestrator');
    
    // Initialize the orchestrator with optimized configuration
    gamingOrchestrator = new GamingAssistantOrchestrator({
    capture: {
        fps: 3, // 3 FPS as per Cluely architecture
        width: 1280,
        height: 720,
        quality: 80
    },
    transcription: {
        sampleRate: 16000, // 16kHz
        chunkSizeMs: 200,   // 200ms chunks (reduced from 100ms to fix fragmentation)
        interimResults: true
    },
    vision: {
        model: 'gpt-4o',
        maxTokens: 150,
        analysisRate: 1 // Analyze every frame
    },
    context: {
        maxHistoryItems: 20,
        urgencyTimeWindow: 5000 // 5 seconds
    },
    ai: {
        // ====================================
        // 🚫 VERTEX AI FINE-TUNED MODEL CONFIG - COMMENTED OUT
        // ====================================
        // To re-enable custom model: Set useFineTunedModel to true and provide credentials
        // ====================================
        useFineTunedModel: false,  // FORCED FALSE - Using standard gemini-2.5-flash
        // projectId: process.env.GCP_PROJECT_ID,
        // location: process.env.GCP_LOCATION,
        // tunedModelId: process.env.TUNED_GEMINI_MODEL_ID,
        // credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
        
        // Standard Gemini 3 Pro Preview configuration (ACTIVE)
        model: 'gemini-3-pro-preview', // Upgraded to Gemini 3 Pro Preview
        thinkingLevel: 'high', // Use high thinking level for better reasoning
        maxOutputTokens: 180,      // 30-60 words for detailed responses
        temperature: 0.7,
        responseTimeoutMs: 60000,   // Increased to 60s for Gemini 3 Pro (High Thinking + Search)
        guideSearchService: guideSearchService // Inject Guide Search Service
    },
    output: {
        voice: 'Adam', // ElevenLabs voice
        model: 'eleven_turbo_v2_5', // Fastest model
        // Removed fallback config - no fallbacks allowed
    },
    display: {
        maxUpdateRate: 60,  // 60 FPS
        urgentUpdateRate: 120, // 120 FPS for urgent situations
        batchWindowMs: 16   // 16ms = 60 FPS
    },
    performanceLogging: true,
    maxConcurrentSessions: 5
    });
    
    log('🎮 Cluely-style Gaming Assistant Orchestrator initialized');
    log(`🤖 AI Model: ${hasVertexAIConfig ? 'Vertex AI Fine-Tuned (' + process.env.TUNED_GEMINI_MODEL_ID + ')' : 'Standard Gemini 2.5 Flash'}`);
    
    // Setup orchestrator event handlers (NOW that it's initialized)
    gamingOrchestrator.on('audio-ready', (audioData) => {
        log(`🔊 Audio ready for session: ${audioData.sessionId}`);
    });

    gamingOrchestrator.on('urgent-audio-ready', (urgentAudio) => {
        log(`🚨 Urgent audio ready for session: ${urgentAudio.sessionId}`);
    });

    gamingOrchestrator.on('session-started', (sessionData) => {
        log(`✅ Gaming session started: ${sessionData.sessionId}`);
    });

    gamingOrchestrator.on('session-stopped', (sessionData) => {
        log(`🛑 Gaming session stopped: ${sessionData.sessionId}`);
        log(`   ⏱️ Duration: ${Math.round(sessionData.duration / 1000)}s`);
    });
    
    // NOW create Gaming Assistant WebSocket server with noServer mode for manual upgrade handling
    gamingWSS = new WebSocket.Server({ noServer: true });

    log('🎮 Gaming Assistant WebSocket server created (noServer mode)');

    // Setup gaming WebSocket handlers
    setupGamingWebSocket(gamingWSS);
    
} catch (orchestratorError) {
    console.error('❌ Failed to initialize Gaming Assistant Orchestrator:', orchestratorError.message);
    console.error('   Stack:', orchestratorError.stack);
    console.warn('⚠️ Server will continue without gaming assistant features');
    gamingOrchestrator = null;
}

// Centralized WebSocket upgrade handler - ALWAYS register regardless of orchestrator status
server.removeAllListeners('upgrade'); // Clear any existing handlers

server.on('upgrade', (request, socket, head) => {
    try {
        const pathname = new URL(request.url, 'ws://localhost').pathname;
        log('🔄 HTTP Upgrade request:', {
            pathname,
            fullUrl: request.url,
            upgrade: request.headers.upgrade
        });
        
        if (pathname === '/voice-agent/ws') {
            log('✅ Routing to voice agent WebSocket');
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else if (pathname === '/voice-mode/ws') {
            log('✅ Routing to voice mode WebSocket');
            wssVoiceMode.handleUpgrade(request, socket, head, (ws) => {
                wssVoiceMode.emit('connection', ws, request);
            });
        } else if (pathname === '/gaming-assistant/ws') {
            log('✅ Routing to gaming assistant WebSocket');
            if (!gamingWSS) {
                console.error('❌ Gaming WebSocket server not initialized');
                socket.destroy();
                return;
            }
            gamingWSS.handleUpgrade(request, socket, head, (ws) => {
                gamingWSS.emit('connection', ws, request);
            });
        } else {
            console.warn('⚠️ Unknown WebSocket path:', pathname);
            socket.destroy();
        }
    } catch (upgradeError) {
        console.error('❌ [CRITICAL] WebSocket upgrade error:', upgradeError.message);
        console.error('❌ [CRITICAL] Stack:', upgradeError.stack);
        console.error('❌ [CRITICAL] Request URL:', request.url);
        socket.destroy();
    }
});

log('✅ WebSocket upgrade handler registered for all endpoints');

// Handle WebSocket connections for voice agent - Direct OpenAI connection
wss.on('connection', async (clientWS, req) => {
    log('🔗 New voice agent WebSocket connection');
    log('   📊 Connection details:', {
        timestamp: new Date().toISOString(),
        origin: req.headers.origin,
        userAgent: req.headers['user-agent'],
        ip: req.connection.remoteAddress
    });
    
    let openaiWS = null;
    
    // Per-connection state context
    const ctx = {
        sessionReady: false,       // becomes true after session.updated
        responseOpen: false,       // becomes true after response.created
        responseDone: false,       // becomes true after response.done
        audioQueue: []            // buffer client audio until ready
    };
    
    let conversationLog = {
        sessionId: `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        startTime: new Date().toISOString(),
        endTime: null,
        messages: [],
        toolCalls: [],
        metadata: {
            clientInfo: {
                origin: req.headers.origin,
                userAgent: req.headers['user-agent'],
                ip: req.connection.remoteAddress
            }
        }
    };
    
    log('📝 Started conversation logging for session:', conversationLog.sessionId);
    
    try {
        // Initialize first connection with retry/fallback support
        const initialModel = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
        createOpenAIConnection(initialModel);
        
        // OpenAI WebSocket event handlers
        openaiWS.on('open', () => {
            log('✅ Connected to OpenAI Realtime API - waiting for session.created');
        });
        
        openaiWS.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                log('📡 Message from OpenAI:', message.type);
                
                // Handle OpenAI events with proper flow
                switch (message.type) {
                    case 'session.created':
                        log('✅ OpenAI session created - configuring session...');
                        
                        // Step 1: Configure session for audio/text with explicit formats
                        const sessionConfig = {
                            type: 'session.update',
                            session: {
                                modalities: ['audio', 'text'],
                                voice: 'alloy',
                                turn_detection: { 
                                    type: 'server_vad', 
                                    threshold: 0.5,
                                    prefix_padding_ms: 300,
                                    silence_duration_ms: 1000
                                },
                                // Use supported string format values
                                input_audio_format: 'pcm16',
                                output_audio_format: 'pcm16'
                            }
                        };
                        
                        log('📤 Sending session configuration...');
                        openaiWS.send(JSON.stringify(sessionConfig));
                        break;
                        
                    case 'session.updated':
                        log('✅ OpenAI session updated - starting response turn...');
                        ctx.sessionReady = true;
                        
                        // Step 2: Create response turn to enable audio
                        const responseCreate = {
                            type: 'response.create',
                            response: {
                                modalities: ['audio', 'text'],
                                instructions: 'You are ready to help with gaming questions.'
                            }
                        };
                        
                        log('📤 Creating response turn...');
                        openaiWS.send(JSON.stringify(responseCreate));
                        break;
                        
                    case 'response.created':
                        log('✅ Response turn created - voice agent ready for audio');
                        ctx.responseOpen = true;
                        
                        // Flush any queued audio
                        log('📤 Flushing', ctx.audioQueue.length, 'queued audio messages');
                        while (ctx.audioQueue.length) {
                            openaiWS.send(ctx.audioQueue.shift());
                        }
                        
                        // Now notify client that we're ready for audio
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.connected',
                                message: 'Voice agent ready for audio'
                            }));
                        }
                        break;
                        
                    case 'input_audio_buffer.speech_started':
                        log('🎤 OpenAI detected speech start');
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.listening',
                                message: 'Listening...'
                            }));
                        }
                        break;
                        
                    case 'input_audio_buffer.speech_stopped':
                        log('🤐 OpenAI detected speech stop');
                        break;
                        
                    case 'input_audio_buffer.committed':
                        log('✅ OpenAI confirmed audio buffer committed');
                        break;
                        
                    case 'conversation.item.input_audio_transcription.completed':
                        log('📝 Transcription completed:', message.transcript);
                        
                        // Log user message
                        conversationLog.messages.push({
                            timestamp: new Date().toISOString(),
                            speaker: 'user',
                            type: 'transcript',
                            content: message.transcript
                        });
                        
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.transcript',
                                transcript: message.transcript
                            }));
                        }
                        break;
                        
                    case 'response.function_call_arguments.done':
                        log('🔧 Function call (ignored - no tools configured):', message.name);
                        break;
                        
                    case 'response.output_audio.delta': // newer event name
                    case 'response.audio.delta':        // older event name
                        // Forward audio response to client
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.audio',
                                audio: message.delta
                            }));
                        }
                        break;
                        
                    case 'response.done':
                        log('✅ OpenAI response completed - sealing turn');
                        ctx.responseDone = true;
                        ctx.responseOpen = false;
                        ctx.audioQueue.length = 0; // clear any stragglers
                        
                        // Log AI response
                        conversationLog.messages.push({
                            timestamp: new Date().toISOString(),
                            speaker: 'assistant',
                            type: 'response',
                            content: 'Audio response completed'
                        });
                        
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.response',
                                message: 'Response completed'
                            }));
                        }
                        break;
                        
                    case 'error':
                        console.error('❌ OpenAI error:', message.error);
                        
                        // Handle server errors with intelligent retry logic
                        if (message.error?.type === 'server_error') {
                            if (turnRetryCount < MAX_TURN_RETRIES) {
                                // Retry the current turn
                                turnRetryCount++;
                                const retryDelay = 500 * turnRetryCount + Math.random() * 500; // jittered backoff
                                console.warn(`⚠️ Server error, retrying turn in ${Math.round(retryDelay)}ms... (attempt ${turnRetryCount}/${MAX_TURN_RETRIES})`);
                                
                                setTimeout(() => {
                                    if (!openaiWS?._isClosed && openaiWS?.readyState === WebSocket.OPEN) {
                                        startNewTurn(true);
                                    }
                                }, retryDelay);
                            } else {
                                // Max turn retries reached, try new session with fallback model
                                console.error('❌ Max turn retries reached, reinitializing session...');
                                initNewSession();
                            }
                        } else {
                            // Non-server errors - seal connection immediately
                            if (openaiWS) openaiWS._isClosed = true;
                            
                            if (clientWS.readyState === WebSocket.OPEN) {
                                clientWS.send(JSON.stringify({
                                    type: 'agent.error',
                                    error: message.error.message
                                }));
                            }
                        }
                        break;
                        
                    default:
                        log('📋 OpenAI message type:', message.type);
                }
                
            } catch (error) {
                console.error('❌ Error processing OpenAI message:', error);
            }
        });
        
        openaiWS.on('error', (error) => {
            console.error('❌ OpenAI WebSocket error:', error);
            console.error('   📋 Error details:', {
                message: error.message,
                code: error.code,
                stack: error.stack
            });
            if (clientWS.readyState === WebSocket.OPEN) {
                clientWS.send(JSON.stringify({
                    type: 'agent.error',
                    error: error.message
                }));
            }
        });
        
        openaiWS.on('close', (code, reason) => {
            if (code === 1000) {
                log('🔌 OpenAI WebSocket closed normally (code 1000)');
                log('   📊 This is usually due to a server error - check error events above');
            } else {
                log('🔌 OpenAI WebSocket closed unexpectedly');
            }
            
            log('   📊 Close details:', {
                code: code,
                reason: reason.toString(),
                timestamp: new Date().toISOString(),
                wasClean: code === 1000,
                isNormalClosure: code === 1000
            });
            
            // Cleanup on close
            cleanup();
            
            // Only treat non-1000 codes as unexpected errors
            if (code !== 1000 && clientWS.readyState === WebSocket.OPEN) {
                clientWS.send(JSON.stringify({
                    type: 'agent.error',
                    error: `OpenAI connection closed unexpectedly: ${code} ${reason.toString()}`
                }));
            }
        });
        
    } catch (error) {
        console.error('❌ Error setting up voice agent:', error);
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'agent.error',
                error: error.message
            }));
        }
    }
    
    // Heartbeat for long-lived connections
    const HEARTBEAT_MS = 25000;
    const heartbeat = setInterval(() => {
        try { 
            if (openaiWS?.readyState === WebSocket.OPEN) {
                openaiWS.ping(); 
            }
        } catch (error) {
            console.warn('⚠️ Heartbeat ping failed:', error.message);
        }
    }, HEARTBEAT_MS);
    
    // Cleanup function
    const cleanup = () => {
        clearInterval(heartbeat);
        ctx.audioQueue = [];
        ctx.sessionReady = false;
        ctx.responseOpen = false;
        ctx.responseDone = true;  // seal to prevent late messages
        if (openaiWS) openaiWS._isClosed = true;
        log('🧹 Connection cleanup completed');
    };
    
    // Handle client disconnection
    clientWS.on('close', (code, reason) => {
        log('🔌 Client WebSocket disconnected');
        
        // Cleanup
        cleanup();
        
        // Save conversation log
        conversationLog.endTime = new Date().toISOString();
        if (conversationLog.messages.length > 0 || conversationLog.toolCalls.length > 0) {
            const savedPath = saveVoiceConversation(conversationLog);
            if (savedPath) {
                log('💾 Voice conversation saved:', savedPath);
            }
        }
        
        // Close OpenAI connection
        if (openaiWS && openaiWS.readyState === WebSocket.OPEN) {
            openaiWS.close();
        }
    });
    
    clientWS.on('error', (error) => {
        console.error('❌ Client WebSocket error:', error);
    });
    
    // Allowed message types to forward to OpenAI
    const ALLOWED_TO_OPENAI = new Set([
        'input_audio_buffer.append',
        'response.cancel'
        // Note: commits/clears disabled with server VAD
    ]);
    
    const VAD_ENABLED = true; // we set server_vad above
    
    function forwardToOpenAI(raw) {
        if (openaiWS?._isClosed || openaiWS?.readyState !== WebSocket.OPEN) return false;
        openaiWS.send(raw);
        return true;
    }
    
    let turnRetryCount = 0;
    let sessionRetryCount = 0;
    const MAX_TURN_RETRIES = 3;
    const MAX_SESSION_RETRIES = 2;
    
    function startNewTurn(isRetry = false) {
        if (openaiWS?._isClosed || openaiWS?.readyState !== WebSocket.OPEN) return;
        
        if (isRetry) {
            log('🔄 Retrying response turn...', { attempt: turnRetryCount + 1 });
        } else {
            log('🔄 Starting new response turn...');
            turnRetryCount = 0;
        }
        
        ctx.responseOpen = true;
        ctx.responseDone = false;
        openaiWS.send(JSON.stringify({
            type: 'response.create',
            response: { 
                modalities: ['audio', 'text'], 
                instructions: 'You are a concise in-game guide assistant.' 
            }
        }));
    }
    
    function initNewSession() {
        if (sessionRetryCount >= MAX_SESSION_RETRIES) {
            console.error('❌ Max session retries reached, giving up');
            if (clientWS.readyState === WebSocket.OPEN) {
                clientWS.send(JSON.stringify({
                    type: 'agent.error',
                    error: 'Voice agent unavailable - please try again later'
                }));
            }
            return;
        }
        
        sessionRetryCount++;
        const fallbackModel = sessionRetryCount > 1 ? 
            'gpt-4o-realtime-preview-2024-10-01' : // Fallback to older stable model
            'gpt-4o-realtime-preview-2024-12-17';
            
        log(`🔄 Reinitializing session with model: ${fallbackModel} (attempt ${sessionRetryCount}/${MAX_SESSION_RETRIES})`);
        
        // Reset context
        ctx.sessionReady = false;
        ctx.responseOpen = false;
        ctx.responseDone = false;
        ctx.audioQueue = [];
        turnRetryCount = 0;
        
        // Close current connection
        if (openaiWS) {
            openaiWS._isClosed = true;
            openaiWS.close();
        }
        
        // Start new connection with delay
        setTimeout(() => {
            if (clientWS.readyState === WebSocket.OPEN) {
                createOpenAIConnection(fallbackModel);
            }
        }, 1000 + Math.random() * 1000); // 1-2 second jittered delay
    }
    
    function createOpenAIConnection(model) {
        const openaiUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
        
        log('🔗 Creating new OpenAI connection...');
        log('   🔗 URL:', openaiUrl);
        log('   🤖 Model:', model);
        
        openaiWS = new WebSocket(openaiUrl, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });
        
        // Re-attach all event handlers
        setupOpenAIEventHandlers();
    }
    
    function setupOpenAIEventHandlers() {
        openaiWS.on('open', () => {
            log('✅ Connected to OpenAI Realtime API - waiting for session.created');
        });
        
        openaiWS.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                log('📡 Message from OpenAI:', message.type);
                
                // Handle OpenAI events with proper flow
                switch (message.type) {
                    case 'session.created':
                        log('✅ OpenAI session created - configuring session...');
                        
                        // Configure session for audio/text
                        const sessionConfig = {
                            type: 'session.update',
                            session: {
                                modalities: ['audio', 'text'],
                                voice: 'alloy',
                                turn_detection: { 
                                    type: 'server_vad', 
                                    threshold: 0.5,
                                    prefix_padding_ms: 300,
                                    silence_duration_ms: 1000
                                },
                                input_audio_format: 'pcm16',
                                output_audio_format: 'pcm16'
                            }
                        };
                        
                        openaiWS.send(JSON.stringify(sessionConfig));
                        break;
                        
                    case 'session.updated':
                        log('✅ OpenAI session updated - starting response turn...');
                        ctx.sessionReady = true;
                        startNewTurn();
                        break;
                        
                    case 'response.created':
                        log('✅ Response turn created - ready for audio');
                        ctx.responseOpen = true;
                        ctx.responseDone = false;
                        
                        // Flush queued audio
                        while (ctx.audioQueue.length && !ctx.responseDone) {
                            if (openaiWS?.readyState !== WebSocket.OPEN) break;
                            openaiWS.send(ctx.audioQueue.shift());
                        }
                        
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.connected',
                                message: 'Voice agent ready for audio'
                            }));
                        }
                        break;
                        
                    case 'response.output_audio.delta':
                    case 'response.audio.delta':
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.audio',
                                audio: message.delta
                            }));
                        }
                        break;
                        
                    case 'response.done':
                        log('✅ OpenAI response completed - sealing turn');
                        ctx.responseDone = true;
                        ctx.responseOpen = false;
                        ctx.audioQueue.length = 0; // clear stragglers
                        
                        if (clientWS.readyState === WebSocket.OPEN) {
                            clientWS.send(JSON.stringify({
                                type: 'agent.response',
                                message: 'Response completed'
                            }));
                        }
                        break;
                        
                    case 'error':
                        console.error('❌ OpenAI error:', message.error);
                        
                        if (message.error?.type === 'server_error') {
                            if (turnRetryCount < MAX_TURN_RETRIES) {
                                turnRetryCount++;
                                const retryDelay = 500 * turnRetryCount + Math.random() * 500;
                                console.warn(`⚠️ Server error, retrying in ${Math.round(retryDelay)}ms... (${turnRetryCount}/${MAX_TURN_RETRIES})`);
                                
                                setTimeout(() => {
                                    if (!openaiWS?._isClosed && openaiWS?.readyState === WebSocket.OPEN) {
                                        startNewTurn(true);
                                    }
                                }, retryDelay);
                            } else {
                                console.error('❌ Max retries reached, reinitializing session...');
                                initNewSession();
                            }
                        } else {
                            if (openaiWS) openaiWS._isClosed = true;
                        }
                        break;
                        
                    default:
                        log('📋 OpenAI message type:', message.type);
                }
                
            } catch (error) {
                console.error('❌ Error processing OpenAI message:', error);
            }
        });
        
        openaiWS.on('error', (error) => {
            console.error('❌ OpenAI WebSocket error:', error);
            // (reuse existing error handling)
        });
        
        openaiWS.on('close', (code, reason) => {
            if (code === 1000) {
                log('🔌 OpenAI WebSocket closed normally (code 1000)');
            } else {
                log('🔌 OpenAI WebSocket closed unexpectedly');
            }
            cleanup();
        });
    }
    
    // Handle messages from client (strict gating and allowlist)
    clientWS.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // Strict handling for manual commits/clears
            if (message.type === 'input_audio_buffer.commit' || message.type === 'input_audio_buffer.clear') {
                if (VAD_ENABLED) {
                    log('🛑 Ignored', message.type, 'with server_vad');
                    return;
                }
            }
            
            // Handle audio append with new turn logic
            if (message.type === 'input_audio_buffer.append') {
                // If response is done and we have new audio, start a new turn with delay
                if (ctx.responseDone && ctx.sessionReady && !openaiWS?._isClosed) {
                    log('🕐 Delaying new turn start by 200ms to avoid server errors...');
                    setTimeout(() => startNewTurn(), 200);
                }
                
                // Drop audio if connection is closed or response completed without new turn
                if (ctx.responseDone || openaiWS?._isClosed) {
                    return; // Don't queue after completion or close
                }
                
                // Queue audio until session is ready
                if (!ctx.sessionReady || !ctx.responseOpen) {
                    ctx.audioQueue.push(data);
                    if (ctx.audioQueue.length > 200) ctx.audioQueue.shift();
                    return;
                }
                
                // Forward audio when ready
                forwardToOpenAI(data);
                return;
            }
            
            // Handle other allowed message types
            if (ALLOWED_TO_OPENAI.has(message.type)) {
                forwardToOpenAI(data);
            } else {
                log('🙅 Ignoring disallowed client message:', message.type);
            }
            
        } catch (error) {
            console.error('❌ Error processing client message:', error);
        }
    });
    
    // RAG functionality removed for basic voice testing
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
});

// ========================================
// VOICE MODE WEBSOCKET SERVER
// ========================================

wssVoiceMode.on('connection', async (clientWS, req) => {
    log('🎤 New voice mode WebSocket connection');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
        console.error('❌ No sessionId provided');
        clientWS.close(4000, 'sessionId required');
        return;
    }
    
    // Get voice mode session
    const session = activeVoiceSessions.get(sessionId);
    
    if (!session) {
        console.error('❌ Voice mode session not found:', sessionId);
        clientWS.close(4001, 'Session not found');
        return;
    }
    
    log('✅ Voice mode WebSocket connected for session:', sessionId);
    
    // Cancel cleanup timer if reconnecting
    if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
        log('   ✅ Cleanup timer cancelled (session reconnected)');
    }
    
    const { voiceMode } = session;
    
    // IMPORTANT: Remove any existing listeners to prevent duplicates on reconnect
    voiceMode.removeAllListeners('audio-chunk');
    voiceMode.removeAllListeners('agent-response');
    voiceMode.removeAllListeners('audio-start');
    voiceMode.removeAllListeners('user-speaking');
    voiceMode.removeAllListeners('audio-end');
    voiceMode.removeAllListeners('user-transcript');
    voiceMode.removeAllListeners('request-vision');
    voiceMode.removeAllListeners('error');

    // Reconnect to ElevenLabs if connection is dead
    if (!voiceMode.elevenLabsWS || voiceMode.elevenLabsWS.readyState !== WebSocket.OPEN) {
        log('🔄 Reconnecting ElevenLabs for session:', sessionId);
        try {
            await voiceMode.connectToElevenLabs();
            log('✅ ElevenLabs re-connected successfully');
        } catch (err) {
            console.error('❌ Failed to re-connect to ElevenLabs:', err.message);
        }
    }

    // Store client connection
    session.clientConnection = clientWS;
    session.pendingTranscript = null;
    
    // Forward audio chunks from ElevenLabs to client
    voiceMode.on('audio-chunk', (audioData) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(audioData); // Send binary audio directly
        }
    });
    
    // Forward status updates
    voiceMode.on('agent-response', async (data) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'response_text',
                text: data.text
            }));
            
            // Update overlay status
            clientWS.send(JSON.stringify({
                type: 'status',
                status: 'speaking'
            }));
        }

        // Note: Conversations are now ALSO saved server-side for cross-session persistence
    });

    // 🧠 Save complete conversation exchanges to database
    voiceMode.on('conversation-exchange', async (data) => {
        const session = activeVoiceSessions.get(sessionId);
        if (session && session.gameTitle) {
            await saveConversationTurn(
                session.gameTitle,
                data.user,
                data.assistant,
                sessionId
            );

            // 🔄 Check if it's time for periodic memory update (every 5 exchanges)
            if (data.exchangeNumber % 5 === 0) {
                log(`🔄 [MEMORY] ${data.exchangeNumber} exchanges completed - triggering memory update`);
                await sendMemoryUpdate(voiceMode, session.gameTitle);
            }
        }
    });

    voiceMode.on('audio-start', () => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'status',
                status: 'Speaking'
            }));
        }
    });
    
    voiceMode.on('user-speaking', () => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'status',
                status: 'Listening'
            }));
        }
    });
    
    voiceMode.on('audio-end', () => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'status',
                status: 'Ready'
            }));
        }
    });
    
    voiceMode.on('user-transcript', (data) => {
        log('📝 [VOICE MODE] User transcript:', data.text);
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'transcript',
                text: data.text
            }));
            
            // Update status to thinking
            clientWS.send(JSON.stringify({
                type: 'status',
                status: 'Thinking'
            }));
        }
        
        // 🧠 Store user message temporarily for memory saving (when AI responds)
        const session = activeVoiceSessions.get(sessionId);
        if (session && data.text) {
            session.lastUserMessage = data.text;
            session.lastUserMessageTime = Date.now();
        }
        
        // Check if vision/RAG is needed
        const needsVision = checkIfVisionNeeded(data.text);
        
        if (needsVision) {
            log('🔍 Vision needed for:', data.text);
            session.pendingTranscript = data.text;
            
            // Update status to reading screen
            if (clientWS.readyState === WebSocket.OPEN) {
                clientWS.send(JSON.stringify({
                    type: 'status',
                    status: 'Reading'
                }));
            }
            
            // Request screenshot from client
            if (clientWS.readyState === WebSocket.OPEN) {
                clientWS.send(JSON.stringify({
                    type: 'request_screenshot'
                }));
            }
        }
    });
    
    voiceMode.on('error', (error) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'error',
                error: error.message || error
            }));
        }
    });
    
    // Track audio chunks for debugging
    let audioChunksReceived = 0;
    let jsonMessagesReceived = 0;
    
    // Handle incoming messages from client
    clientWS.on('message', async (data) => {
        try {
            // Try to parse as JSON first (Gaming Session's proven pattern)
            let message;
            let isJSON = false;
            
            try {
                message = JSON.parse(data.toString());
                isJSON = true;
                jsonMessagesReceived++;
                log(`📨 [VOICE MODE] JSON message #${jsonMessagesReceived}, type:`, message.type);
            } catch (parseError) {
                // Not JSON - must be binary audio
                isJSON = false;
            }
            
            // If it's JSON, handle the message
            if (isJSON) {
                // JSON message handling (screen_frame, etc.)
                switch(message.type) {
                    
                    case 'screen_frame':
                        // Screenshot received from frontend (Gaming Session pattern)
                        log('📸 [VOICE MODE] Screenshot received (screen_frame)');
                        log('   📏 Image size:', Math.round(message.image?.length / 1024) || 0, 'KB');
                        
                        // Clear timeout
                        if (session.screenshotTimeout) {
                            clearTimeout(session.screenshotTimeout);
                            session.screenshotTimeout = null;
                        }
                        
                        // If this is for a tool call, process and respond
                        if (session.pendingToolResponse) {
                            log('   ✅ Processing screenshot for ElevenLabs tool call');
                            
                            // Update status to analyzing
                            session.clientConnection.send(JSON.stringify({
                                type: 'status',
                                status: 'Looking'
                            }));
                            
                            // Analyze with Gemini (legacy system)
                            analyzeScreenWithGemini(message.image).then(analysis => {
                                log('✅ [TOOL] Gemini screen analysis complete');
                                log('   📝 Analysis:', analysis.substring(0, 150));
                                
                                // Return Gemini's text description to ElevenLabs webhook
                                if (session.pendingToolResponse && !session.pendingToolResponse.headersSent) {
                                    session.pendingToolResponse.json({
                                        result: analysis
                                    });
                                }
                                session.pendingToolResponse = null;
                                session.pendingToolQuery = null;
                            }).catch(error => {
                                console.error('❌ [TOOL] Gemini analysis error:', error);
                                if (session.pendingToolResponse && !session.pendingToolResponse.headersSent) {
                                    session.pendingToolResponse.json({
                                        result: 'Unable to analyze screen. Please describe what you see.'
                                    });
                                }
                                session.pendingToolResponse = null;
                            });
                        }
                        break;

                    case 'proactive_tips':
                        // 🪝 HOOK #3: Receive proactive tips from background agent
                        log('🤖 [PROACTIVE] Tips received from frontend');
                        log('   💡 Tips count:', message.tips?.length || 0);

                        // Safety: Validate tips array
                        if (!message.tips || !Array.isArray(message.tips) || message.tips.length === 0) {
                            console.warn('⚠️ [PROACTIVE] Invalid tips format');
                            break;
                        }

                        // Safety: Limit tips array size (max 10 tips)
                        if (message.tips.length > 10) {
                            console.warn('⚠️ [PROACTIVE] Too many tips, limiting to 10');
                            message.tips = message.tips.slice(0, 10);
                        }

                        // Safety: Validate tip structure
                        const validTips = message.tips.filter(tip => {
                            return tip &&
                                   typeof tip.text === 'string' &&
                                   tip.text.length > 0 &&
                                   tip.text.length < 500 &&
                                   ['immediate', 'can-wait'].includes(tip.priority);
                        });

                        if (validTips.length === 0) {
                            console.warn('⚠️ [PROACTIVE] No valid tips found');
                            break;
                        }

                        // Store tips in session memory
                        if (!session.proactiveTips) {
                            session.proactiveTips = [];
                        }

                        // Safety: Limit total stored tips (max 20)
                        session.proactiveTips.push(...validTips);
                        if (session.proactiveTips.length > 20) {
                            session.proactiveTips = session.proactiveTips.slice(-20);
                        }

                        // Send tips as additional context to ElevenLabs
                        voiceMode.sendProactiveTipsContext(validTips, message.instructions);

                        log('   ✅ Tips added to context for voice agent');
                        break;

                    case 'end':
                        log('🛑 Client requested voice mode end');
                        voiceMode.deactivate('client_request');
                        clientWS.close(1000, 'Session ended');
                        activeVoiceSessions.delete(sessionId);
                        break;

                    default:
                        log('⚠️ [VOICE MODE] Unknown JSON message type:', message.type);
                        break;
                }
                return;
            }
            
            // It's binary audio
            audioChunksReceived++;
            
            if (audioChunksReceived === 1) {
                log('🎤 [VOICE MODE] Receiving audio from frontend');
                log('   📊 Audio chunk size:', data.length, 'bytes');
                log('   🔌 ElevenLabs WS ready:', voiceMode.elevenLabsWS?.readyState === WebSocket.OPEN);
            }
            
            // Forward audio to ElevenLabs in JSON format with base64
            if (voiceMode.elevenLabsWS && voiceMode.elevenLabsWS.readyState === WebSocket.OPEN) {
                try {
                    // Convert binary audio to base64
                    const base64Audio = data.toString('base64');
                    
                    // Send as JSON message (ElevenLabs requires JSON format)
                    const audioMessage = {
                        user_audio_chunk: base64Audio
                    };
                    
                    voiceMode.elevenLabsWS.send(JSON.stringify(audioMessage));
                    
                    if (audioChunksReceived === 1) {
                        log('   ✅ Forwarding audio to ElevenLabs (JSON with base64)');
                    } else if (audioChunksReceived % 200 === 0) {
                        log(`   📊 Forwarded ${audioChunksReceived} audio chunks`);
                    }
                } catch (error) {
                    console.error('   ❌ Error sending audio to ElevenLabs:', error);
                }
            } else {
                if (audioChunksReceived === 1) {
                    console.error('   ❌ ElevenLabs WebSocket not ready!');
                    console.error('      State:', voiceMode.elevenLabsWS?.readyState);
                    console.error('      WS exists:', !!voiceMode.elevenLabsWS);
                }
            }
            // Binary audio has been handled above, this code is unreachable
        } catch (error) {
            console.error('❌ Error handling voice mode message:', error);
        }
    });
    
    clientWS.on('close', (code, reason) => {
        log(`🔌 Voice mode client disconnected (Code: ${code}, Reason: ${reason})`);
        log('   ⏸️ Preserving session for potential reconnect (5 min timeout)');
        
        // NEVER delete session on close - always preserve for reconnect
        // This allows auto-pause/resume to work reliably
        
        // Set a cleanup timer - delete only if no reconnect after 5 minutes
        if (!session.cleanupTimer) {
            session.cleanupTimer = setTimeout(() => {
                log('🧹 Cleaning up abandoned session:', sessionId);
                if (voiceMode) {
                    voiceMode.deactivate('timeout');
                    voiceMode.removeAllListeners();
                }
                activeVoiceSessions.delete(sessionId);
                log('   📊 Remaining sessions:', activeVoiceSessions.size);
            }, 300000); // 5 minutes
        }
    });
    
    clientWS.on('error', (error) => {
        console.error('❌ Voice mode client error:', error);
    });
});

// Helper function to check if vision is needed
function checkIfVisionNeeded(transcript) {
    const visionKeywords = [
        'see', 'screen', 'look', 'where', 'what', 'show',
        'this', 'here', 'display', 'visible', 'viewing'
    ];
    
    const lowerTranscript = transcript.toLowerCase();
    return visionKeywords.some(keyword => lowerTranscript.includes(keyword));
}

// Helper function to analyze screen with Gemini
async function analyzeScreenWithGemini(base64Image) {
    try {
        log('🔍 Analyzing screen with Gemini...');
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        
        const prompt = 'Analyze this game screenshot. Describe what you see, including UI elements, game state, character position, and any relevant information for a gaming assistant. Be concise.';
        
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: 'image/png',
                    data: base64Image.replace(/^data:image\/\w+;base64,/, '')
                }
            }
        ]);
        
        const analysis = result.response.text();
        log('✅ Vision analysis complete:', analysis.substring(0, 100) + '...');
        
        return analysis;
        
    } catch (error) {
        console.error('❌ Error analyzing screen:', error);
        return 'Unable to analyze screen at this time.';
    }
}

// Helper: Send periodic memory updates to voice agent
async function sendMemoryUpdate(voiceMode, gameTitle) {
    if (!voiceMode || !gameTitle || !pool) {
        return;
    }

    try {
        // Fetch fresh long-term memory
        const events = await pool.query(
            `SELECT category, event_type, entity_name, context, timestamp
             FROM long_term_memory
             WHERE game_title = $1
             ORDER BY timestamp DESC
             LIMIT 20`,
            [gameTitle]
        );

        if (events.rows.length === 0) {
            return; // No new events to update
        }

        // Format memory update message
        const formattedMemory = formatLongTermMemory(events.rows);

        let updateMessage = '🔄 MEMORY UPDATE:\n\n';
        updateMessage += 'Fresh player progress loaded from long-term memory:\n\n';
        updateMessage += formattedMemory;
        updateMessage += '\n\nUse this updated information to provide context-aware guidance.';

        // Send as context injection to ElevenLabs
        voiceMode.sendProactiveTipsContext(
            [], // No tips, just memory
            updateMessage
        );

        log('✅ [MEMORY] Periodic memory update sent to voice agent');
    } catch (error) {
        console.error('❌ [MEMORY] Failed to send memory update:', error.message);
    }
}

// Helper: Save conversation turn to database for cross-session persistence
async function saveConversationTurn(gameTitle, userMessage, aiResponse, sessionId) {
    if (!pool || !gameTitle || !userMessage || !aiResponse) {
        return; // Skip if missing required data
    }

    try {
        await pool.query(
            `INSERT INTO conversation_history (game_title, user_message, ai_response, session_id)
             VALUES ($1, $2, $3, $4)`,
            [gameTitle, userMessage, aiResponse, sessionId]
        );
        log('💾 [MEMORY] Conversation turn saved to database');
    } catch (error) {
        console.error('❌ [MEMORY] Failed to save conversation:', error.message);
    }
}

// Helper: Format timestamp as "X mins ago" or "X hours ago"
function getTimeAgo(timestamp) {
    const now = new Date();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

// Helper: Load recent conversation history for a game
async function loadConversationHistory(gameTitle, limit = 30) {
    if (!pool || !gameTitle) {
        return [];
    }

    try {
        const result = await pool.query(
            `SELECT user_message, ai_response, timestamp
             FROM conversation_history
             WHERE game_title = $1
             ORDER BY timestamp DESC
             LIMIT $2`,
            [gameTitle, limit]
        );

        // Return in chronological order (oldest first)
        return result.rows.reverse();
    } catch (error) {
        console.error('❌ [MEMORY] Failed to load conversation history:', error.message);
        return [];
    }
}

// Helper function to format long-term memory events for AI context
function formatLongTermMemory(events) {
    if (!events || events.length === 0) {
        return '';
    }

    let formatted = '═══════════════════════════════════════\n';
    formatted += '📍 PLAYER PROGRESS TRACKER:\n';
    formatted += '═══════════════════════════════════════\n\n';

    // Group events by category
    const checkpoints = events.filter(e => e.category === 'checkpoint');
    const bosses = events.filter(e => e.category === 'boss');
    const items = events.filter(e => e.category === 'item');
    const deaths = events.filter(e => e.category === 'death');
    const locations = events.filter(e => e.category === 'location');
    const levels = events.filter(e => e.category === 'level');

    // CHECKPOINTS FIRST (Primary tracking feature)
    if (checkpoints.length > 0) {
        formatted += '🚩 RECENT CHECKPOINTS (Last 3 Save Points):\n';
        const recentCheckpoints = checkpoints.slice(0, 3);
        recentCheckpoints.forEach((c, idx) => {
            const timeAgo = getTimeAgo(new Date(c.timestamp));
            const marker = idx === 0 ? '→' : ' '; // Arrow for most recent
            formatted += `  ${marker} ${c.entity_name} (${timeAgo})`;
            if (c.confidence) {
                formatted += ` [confidence: ${c.confidence}]`;
            }
            formatted += '\n';
        });
        formatted += '\n';
        formatted += '💡 Use checkpoints to answer: "Where am I?", "What was my last save?", "Where should I go?"\n\n';
    } else {
        formatted += '🚩 NO CHECKPOINTS DETECTED YET\n';
        formatted += '   The system will automatically track checkpoints as you reach them.\n\n';
    }

    // Format bosses (if any)
    if (bosses.length > 0) {
        formatted += '⚔️ BOSSES DEFEATED:\n';
        bosses.forEach(b => {
            const date = new Date(b.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            formatted += `  - ${b.entity_name} (${date})`;
            if (b.context && !b.context.startsWith('[Auto-detected]')) {
                formatted += ` - ${b.context}`;
            }
            formatted += '\n';
        });
        formatted += '\n';
    }

    // Format locations
    if (locations.length > 0) {
        formatted += '📍 LOCATIONS VISITED:\n';
        const recentLocations = locations.slice(0, 5); // Show last 5 locations
        recentLocations.forEach(l => {
            const date = new Date(l.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            formatted += `  - ${l.entity_name} (${date})\n`;
        });
        formatted += '\n';
    }

    // Format important items
    if (items.length > 0) {
        formatted += '🎒 IMPORTANT ITEMS:\n';
        items.forEach(i => {
            const date = new Date(i.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            formatted += `  - ${i.entity_name} (${date})`;
            if (i.context && !i.context.startsWith('[Auto-detected]')) {
                formatted += ` - ${i.context}`;
            }
            formatted += '\n';
        });
        formatted += '\n';
    }

    // Format deaths (last 3 only)
    if (deaths.length > 0) {
        formatted += '💀 RECENT DEATHS:\n';
        const recentDeaths = deaths.slice(0, 3);
        recentDeaths.forEach(d => {
            const date = new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            formatted += `  - ${d.entity_name} (${date})\n`;
        });
        formatted += '\n';
    }

    // Format levels
    if (levels.length > 0) {
        const latestLevel = levels[0]; // Most recent level
        formatted += `🆙 CURRENT LEVEL: ${latestLevel.entity_name}\n\n`;
    }

    formatted += '═══════════════════════════════════════\n';
    formatted += '🧠 MEMORY USAGE PROTOCOL:\n';
    formatted += '═══════════════════════════════════════\n';
    formatted += '⚠️ CRITICAL: ALWAYS check the above sections BEFORE answering:\n';
    formatted += '  • "Where am I?" → Check CHECKPOINTS and LOCATIONS\n';
    formatted += '  • "What was I doing?" → Check CONVERSATION HISTORY above\n';
    formatted += '  • "Which bosses have I defeated?" → Check BOSSES DEFEATED\n';
    formatted += '  • "What items do I have?" → Check IMPORTANT ITEMS\n\n';
    formatted += '✅ DO:\n';
    formatted += '  • Reference specific progress from memory naturally\n';
    formatted += '  • Celebrate milestones: "Great job defeating Luna earlier!"\n';
    formatted += '  • Use memory to provide context-aware tips\n';
    formatted += '  • Trust memory over what you see on screen (loading transitions)\n\n';
    formatted += '❌ DO NOT:\n';
    formatted += '  • Ask player to repeat info already in memory\n';
    formatted += '  • Say "I don\'t have that information" if it\'s in memory above\n';
    formatted += '  • Suggest tips for already-defeated bosses\n';
    formatted += '═══════════════════════════════════════\n';

    return formatted;
}

wssVoiceMode.on('error', (error) => {
    console.error('❌ Voice mode WebSocket server error:', error);
});
