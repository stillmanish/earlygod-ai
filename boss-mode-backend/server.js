const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const WebSocket = require('ws');
const http = require('http');
const QuestModeLayer = require('./QuestModeLayer');
const MapService = require('./MapService');

// Load environment variables
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;
const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:3001';

// Initialize services
const mapService = new MapService();

// Middleware
app.use(cors({ origin: '*', credentials: true }));
// Increase limit for screenshot analysis (multiple 1080p base64 images @ 95% quality = ~400-500KB each)
// With 3-4 screenshots per request, need at least 2-3MB, using 10MB for safety
app.use(express.json({ limit: '10mb' }));

log('📍 Starting Quest Mode Backend on port', PORT);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'quest-mode-backend',
        timestamp: new Date().toISOString()
    });
});

// ========================================
// PROACTIVE AGENT ENDPOINT
// ========================================
const ProactiveAgentLayer = require('./ProactiveAgentLayer');
const proactiveAgent = new ProactiveAgentLayer();

app.post('/api/proactive-agent/analyze', async (req, res) => {
    const payloadSize = Math.round(JSON.stringify(req.body).length / 1024);
    log('[PROACTIVE] Request received -', payloadSize, 'KB');

    try {
        const {
            currentScreenshot,
            previousScreenshots = [],
            guideData,
            gameContext,
            sessionId
        } = req.body;

        // Validate inputs
        if (!currentScreenshot) {
            return res.status(400).json({ error: 'currentScreenshot is required' });
        }

        // Fetch long-term memory from main backend
        let longTermMemory = '';
        if (gameContext?.gameTitle) {
            try {
                longTermMemory = await fetchLongTermMemory(gameContext.gameTitle);
                log('[MEMORY] Loaded long-term context:', longTermMemory.length, 'chars');
            } catch (error) {
                console.warn('[MEMORY] Failed to fetch long-term memory:', error.message);
                longTermMemory = '';
            }
        }

        // Build memory context
        let memory = {
            shortTerm: [],
            longTerm: longTermMemory || `Gaming session for ${gameContext?.gameTitle || 'unknown game'}`
        };

        // Call proactive agent to extract comprehensive game state
        const result = await proactiveAgent.extractGameState({
            currentScreenshot,
            previousScreenshots,
            guideData,
            gameContext,
            memory
        });

        // Store detected events (checkpoints, bosses, etc.) to main backend's Neon database
        if (result.gameState?.events && result.gameState.events.length > 0 && gameContext?.gameTitle && gameContext.gameTitle !== 'Unknown') {
            log('[EVENTS] Detected', result.gameState.events.length, 'events for', gameContext.gameTitle);

            for (const event of result.gameState.events) {
                try {
                    await storeEventToMainBackend(event, gameContext.gameTitle);
                } catch (error) {
                    // Non-blocking - log but continue
                    console.error('[EVENTS] Failed to store event:', event.category, event.entityName, error.message);
                }
            }
        } else if (!gameContext?.gameTitle || gameContext.gameTitle === 'Unknown') {
            console.warn('[EVENTS] Skipping storage - game title is Unknown or missing');
        }

        res.json(result);

    } catch (error) {
        console.error('[PROACTIVE] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            gameState: {
                location: { area: 'unknown', specificLocation: null, type: 'unknown', confidence: 0 },
                party: [],
                uiState: { menuOpen: false, menuType: 'none', options: [], inCombat: false, canSave: false },
                resources: { currency: 'not visible', healthStatus: 'unknown', items: 'not visible' },
                events: [],
                objectives: { visible: false, markers: [] },
                combat: { status: 'unknown', enemy: null, playerHealth: 'unknown' }
            }
        });
    }
});

// Helper: Store event to main backend's Neon database
async function storeEventToMainBackend(event, gameTitle) {
    const response = await fetch(`${MAIN_BACKEND_URL}/api/memory/store-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            gameTitle,
            category: event.category,
            eventType: event.eventType,
            entityName: event.entityName,
            context: `[Auto-detected] ${event.evidence} (confidence: ${event.confidence})`
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    log('[MEMORY] Stored:', event.category, event.entityName, '→ main backend');
    return data;
}

// Helper: Fetch long-term memory from main backend
async function fetchLongTermMemory(gameTitle) {
    const response = await fetch(
        `${MAIN_BACKEND_URL}/api/memory/events/${encodeURIComponent(gameTitle)}?limit=20`,
        {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch memory: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !data.events || data.events.length === 0) {
        return '';
    }

    // Format memory for proactive agent context
    let formatted = '═══════════════════════════════════════\n';
    formatted += '📊 PLAYER PROGRESS (Long-Term Memory):\n';
    formatted += '═══════════════════════════════════════\n\n';

    // Group events by category
    const bosses = data.events.filter(e => e.category === 'boss');
    const checkpoints = data.events.filter(e => e.category === 'checkpoint');
    const items = data.events.filter(e => e.category === 'item');
    const deaths = data.events.filter(e => e.category === 'death');
    const locations = data.events.filter(e => e.category === 'location');

    if (bosses.length > 0) {
        formatted += '⚔️ BOSSES DEFEATED:\n';
        bosses.forEach(b => {
            formatted += `  - ${b.entity_name}\n`;
        });
        formatted += '\n';
    }

    if (checkpoints.length > 0) {
        formatted += '🚩 CHECKPOINTS REACHED:\n';
        checkpoints.forEach(c => {
            formatted += `  - ${c.entity_name}\n`;
        });
        formatted += '\n';
    }

    if (locations.length > 0) {
        formatted += '📍 RECENT LOCATIONS:\n';
        locations.slice(0, 5).forEach(l => {
            formatted += `  - ${l.entity_name}\n`;
        });
        formatted += '\n';
    }

    if (items.length > 0) {
        formatted += '🎒 KEY ITEMS:\n';
        items.forEach(i => {
            formatted += `  - ${i.entity_name}\n`;
        });
        formatted += '\n';
    }

    if (deaths.length > 0) {
        formatted += '💀 RECENT DEATHS:\n';
        deaths.slice(0, 3).forEach(d => {
            formatted += `  - ${d.entity_name}\n`;
        });
        formatted += '\n';
    }

    formatted += '═══════════════════════════════════════\n';
    formatted += 'Use this context to provide relevant tips.\n';
    formatted += '═══════════════════════════════════════\n';

    return formatted;
}

// ========================================
// MAP VISUALIZATION ENDPOINTS
// ========================================

/**
 * GET /api/map/:gameTitle/full
 * Get complete map data with checkpoints and their status
 */
app.get('/api/map/:gameTitle/full', async (req, res) => {
    const { gameTitle } = req.params;
    log('[MAP] Fetching full map for:', gameTitle);

    try {
        const result = await mapService.getMapWithCheckpoints(gameTitle);
        res.json(result);
    } catch (error) {
        console.error('[MAP] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            gameTitle
        });
    }
});

/**
 * POST /api/map/:gameTitle/refresh
 * Clear cache and refresh map data
 */
app.post('/api/map/:gameTitle/refresh', async (req, res) => {
    const { gameTitle } = req.params;
    log('[MAP] Refreshing map cache for:', gameTitle);

    try {
        mapService.clearCache(gameTitle);
        const result = await mapService.getMapWithCheckpoints(gameTitle);
        res.json(result);
    } catch (error) {
        console.error('[MAP] Refresh error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            gameTitle
        });
    }
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server for quest mode
const wss = new WebSocket.Server({ noServer: true });

// Active quest mode sessions
const activeQuestSessions = new Map();

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    
    if (pathname === '/quest-vision/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } else {
        socket.destroy();
    }
});

// Handle quest mode WebSocket connections
wss.on('connection', (clientWS, req) => {
    log('📍 New quest mode connection');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
        console.error('❌ No sessionId provided');
        clientWS.close(4000, 'sessionId required');
        return;
    }
    
    log('📍 Quest mode session:', sessionId);
    
    // Create quest mode layer for this session
    const questMode = new QuestModeLayer({
        model: 'gemini-2.5-pro'
    });
    
    // Store session
    activeQuestSessions.set(sessionId, {
        clientWS,
        questMode,
        startTime: Date.now()
    });
    
    // Event handlers
    questMode.on('request-screenshot', (data) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'request_screenshot',
                timestamp: data.timestamp
            }));
        }
    });
    
    questMode.on('quest-briefing', (data) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'quest_briefing',
                data: {
                    text: data.briefing
                },
                timestamp: data.timestamp
            }));
        }
    });
    
    questMode.on('quest-update', (data) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'quest_update',
                data: {
                    text: data.guidance
                },
                timestamp: data.timestamp
            }));
        }
    });
    
    questMode.on('quest-summary', (data) => {
        if (clientWS.readyState === WebSocket.OPEN) {
            clientWS.send(JSON.stringify({
                type: 'quest_summary',
                data: {
                    text: data.summary,
                    reason: data.reason,
                    stats: data.stats
                },
                timestamp: data.timestamp
            }));
        }
    });
    
    // Handle messages from client
    clientWS.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'activate':
                    log('📍 Activating quest mode');
                    questMode.activate(sessionId, message.gameContext || {}, message.guideData || null);
                    break;
                    
                case 'deactivate':
                    log('🛑 Deactivating quest mode');
                    questMode.deactivate('manual');
                    break;
                    
                case 'screenshot':
                    // Add screenshot to queue
                    questMode.addScreenshot({
                        image: message.image,
                        timestamp: message.timestamp,
                        size: message.size
                    });
                    break;
                    
                case 'ping':
                    clientWS.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                    break;
                    
                default:
                    console.warn('⚠️ Unknown quest mode message:', message.type);
            }
        } catch (error) {
            console.error('❌ Error processing quest mode message:', error.message);
        }
    });
    
    // Handle disconnection
    clientWS.on('close', () => {
        log('🔌 Quest mode client disconnected:', sessionId);
        
        const session = activeQuestSessions.get(sessionId);
        if (session) {
            session.questMode.deactivate('disconnect');
            activeQuestSessions.delete(sessionId);
        }
    });
    
    // Send welcome message
    clientWS.send(JSON.stringify({
        type: 'connected',
        sessionId,
        message: 'Quest mode service ready',
        timestamp: new Date().toISOString()
    }));
});

// Start server
server.listen(PORT, () => {
    log(`✅ Quest Mode Backend running on port ${PORT}`);
    log(`🔗 WebSocket: ws://localhost:${PORT}/quest-vision/ws`);
    log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('🛑 Received SIGTERM - shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});

