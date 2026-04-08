// Memory Preloader - Async memory warmup for AI context injection
const MemoryManager = require('./MemoryManager');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class MemoryPreloader {
    constructor(memoryManager = null) {
        this.memoryManager = memoryManager || new MemoryManager();
    }
    
    // Called when user starts game session
    async preloadMemoryForSession(sessionId, gameTitle) {
        log(`🔥 Warming up AI for ${gameTitle}...`);
        
        const startTime = Date.now();
        
        try {
            // Fetch in parallel (fast)
            const [recentEvents, lastSessionMessages, sessionState] = await Promise.all([
                this.memoryManager.getRecentEvents(gameTitle, 20), // Last 20 events
                this.memoryManager.getLastSessionMessages(gameTitle, 10), // Last 10 messages
                this.memoryManager.getSessionState(gameTitle)
            ]);
            
            // Build context string
            const memoryContext = this.buildMemoryContext({
                recentEvents,
                lastSessionMessages,
                sessionState,
                gameTitle
            });
            
            log(`✅ Memory preloaded in ${Date.now() - startTime}ms`);
            log(`   📊 Events: ${recentEvents.length}, Messages: ${lastSessionMessages.length}`);
            
            return memoryContext;
        } catch (error) {
            console.error('❌ Memory preload failed:', error);
            return this.buildEmptyContext(gameTitle);
        }
    }
    
    buildMemoryContext({ recentEvents, lastSessionMessages, sessionState, gameTitle }) {
        let context = `\n═══════════════════════════════════════\n`;
        context += `GAME IN MEMORY: ${gameTitle.toUpperCase()}\n`;
        context += `═══════════════════════════════════════\n`;
        context += `This is the game the player is currently playing. You have memory from previous sessions.\n\n`;
        
        // Session resume
        if (sessionState) {
            context += `## LAST SESSION (${sessionState.last_played})\n`;
            context += `- Game: ${gameTitle}\n`;
            context += `- Location: ${sessionState.last_location || 'Unknown'}\n`;
            context += `- Level: ${sessionState.last_level || 'Unknown'}\n`;
            context += `- Objective: ${sessionState.last_objective || 'None'}\n\n`;
        }
        
        // Recent events by category
        const eventsByCategory = {};
        recentEvents.forEach(event => {
            if (!eventsByCategory[event.category]) {
                eventsByCategory[event.category] = [];
            }
            eventsByCategory[event.category].push(event);
        });
        
        if (Object.keys(eventsByCategory).length > 0) {
            context += `## RECENT EVENTS\n`;
            for (const [category, events] of Object.entries(eventsByCategory)) {
                context += `### ${category.toUpperCase()}\n`;
                events.forEach(e => {
                    const eventType = e.event_type || 'mentioned';
                    context += `- ${eventType} ${e.entity_name}`;
                    if (e.context && e.context.length < 100) {
                        context += `: ${e.context}`;
                    }
                    context += `\n`;
                });
                context += '\n';
            }
        }
        
        // Last conversation
        if (lastSessionMessages.length > 0) {
            context += `## LAST CONVERSATION\n`;
            lastSessionMessages.reverse().forEach(msg => {
                if (msg.user_message) {
                    context += `User: ${msg.user_message}\n`;
                }
                if (msg.ai_response) {
                    context += `AI: ${msg.ai_response}\n\n`;
                }
            });
        }
        
        return context;
    }
    
    buildEmptyContext(gameTitle) {
        return `# MEMORY CONTEXT FOR ${gameTitle.toUpperCase()}\n\nNo previous memory found. This is a fresh start.\n`;
    }
    
    // Get specific category events for targeted context
    async getEventsByCategory(gameTitle, category, limit = 10) {
        try {
            return await this.memoryManager.getActiveEvents(gameTitle, category, limit);
        } catch (error) {
            console.error(`❌ Failed to get ${category} events:`, error);
            return [];
        }
    }
    
    // Build targeted context for specific queries
    async buildTargetedContext(gameTitle, categories = []) {
        let context = '';
        
        for (const category of categories) {
            const events = await this.getEventsByCategory(gameTitle, category, 5);
            if (events.length > 0) {
                context += `\n### ${category.toUpperCase()} MEMORY:\n`;
                events.forEach(e => {
                    context += `- ${e.entity_name}: ${e.context}\n`;
                });
            }
        }
        
        return context;
    }
}

module.exports = MemoryPreloader;

