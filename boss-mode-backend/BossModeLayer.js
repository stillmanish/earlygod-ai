// Boss Fight Mode Layer - Real-time strategic guidance during boss encounters
const EventEmitter = require('events');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class BossModeLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required for BossModeLayer');
        }
        
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Use Gemini 2.5 Flash for quality boss fight analysis
        this.model = this.genAI.getGenerativeModel({ 
            model: options.model || "gemini-2.5-flash"
        });
        
        this.config = {
            screenshotInterval: options.screenshotInterval || 2000,     // Request every 2s
            guidanceInterval: options.guidanceInterval || 11000,        // Generate every 10-12s during normal combat
            maxQueueSize: options.maxQueueSize || 5,                    // Keep last 5 screenshots
            maxOutputTokens: options.maxOutputTokens || 8192,           // No limit - let model decide (Gemini max)
            temperature: options.temperature || 0.7,                     // Match main backend
            bossTimeout: options.bossTimeout || 600000                  // 10 minute max
        };
        
        // Boss mode state
        this.isActive = false;
        this.sessionId = null;
        this.gameContext = null;
        this.guideData = null;  // RAG guide for boss fight strategies
        
        // Screenshot queue (non-blocking buffer)
        this.screenshotQueue = [];
        
        // Timers
        this.screenshotRequestTimer = null;
        this.guidanceGenerationTimer = null;
        this.timeoutTimer = null;
        
        // Boss fight tracking
        this.bossState = {
            bossName: null,
            startTime: null,
            lastBossHealth: 100,
            lastPlayerHealth: 100,
            phase: 1,
            guidanceCount: 0,
            screenshotCount: 0
        };
        
        // Guidance memory (track last 20 messages to avoid repetition and provide context)
        this.guidanceHistory = [];
        
        log('🔥 BossModeLayer initialized:', {
            model: options.model || "gemini-2.5-flash",
            screenshotInterval: `${this.config.screenshotInterval}ms`,
            guidanceInterval: `${this.config.guidanceInterval}ms`,
            maxQueueSize: this.config.maxQueueSize
        });
    }
    
    async activate(sessionId, gameContext = {}, guideData = null) {
        if (this.isActive) {
            console.warn('⚠️ Boss mode already active');
            return false;
        }
        
        this.sessionId = sessionId;
        this.gameContext = gameContext;
        this.guideData = guideData;  // Store RAG guide for context
        this.isActive = true;
        
        // Reset boss state and guidance history
        this.bossState = {
            bossName: null,
            startTime: Date.now(),
            lastBossHealth: 100,
            lastPlayerHealth: 100,
            phase: 1,
            guidanceCount: 0,
            screenshotCount: 0
        };
        this.guidanceHistory = []; // Start fresh each boss fight
        
        log('🔥 Boss mode activated for session:', sessionId);
        log('   🎮 Game:', gameContext.gameTitle || 'Unknown');
        
        // Start screenshot request loop (every 2s)
        this.startScreenshotLoop();
        
        // Start guidance generation loop (every 3.5s, samples from queue)
        this.startGuidanceLoop();
        
        // Start timeout failsafe
        this.timeoutTimer = setTimeout(() => {
            log('⏰ Boss mode timeout (10 minutes) - auto-ending');
            this.deactivate('timeout');
        }, this.config.bossTimeout);
        
        // Generate initial briefing from RAG guide
        await this.generateInitialBriefing();
        
        this.emit('boss-mode-activated', {
            sessionId,
            gameContext,
            timestamp: new Date()
        });
        
        return true;
    }
    
    async generateInitialBriefing() {
        try {
            // Split briefing into 3 separate messages (40 words each, heavy RAG usage)
            
            if (this.guideData && this.guideData.steps && this.guideData.steps.length > 0) {
                // Extract comprehensive strategies from ALL available steps (heavy RAG usage)
                const allStrategies = this.guideData.steps
                    .map(step => step.action || step.title || step.description)
                    .filter(s => s && s.length > 0)
                    .slice(0, 6); // Use up to 6 steps for richer context
                
                // Message 1: Activation + Target (40 words max)
                let message1 = '🔥 BOSS MODE ACTIVATED';
                if (this.guideData.bossName) {
                    message1 += `\nTarget: ${this.guideData.bossName}`;
                }
                message1 += '\nReal-time strategic guidance initiated. Analyzing patterns and vulnerabilities for optimal combat performance.';
                
                // Message 2: Core Strategies (40 words max)  
                const strategiesText = allStrategies.slice(0, 3).join(' | ');
                let message2 = `🎯 PRIMARY STRATEGIES\n${strategiesText}`;
                if (strategiesText.length < 100) { // Add more if space allows
                    const extraStrategies = allStrategies.slice(3, 5).join(' | ');
                    if (extraStrategies) message2 += ` | ${extraStrategies}`;
                }
                
                // Message 3: Phases + Key Tips (40 words max)
                let message3 = '⚡ COMBAT ESSENTIALS\n';
                if (this.guideData.phases && this.guideData.phases.length > 0) {
                    const phasesText = this.guideData.phases.slice(0, 2).map(p => p.name || p.description).join(' → ');
                    message3 += `Phases: ${phasesText}\n`;
                }
                message3 += 'Key: Stay mobile | Target weak points | Watch patterns | Adapt quickly';
                
                // Emit messages with delays
                this.emitBriefingMessage(message1, 0);      // Immediate
                this.emitBriefingMessage(message2, 1500);   // 1.5s delay  
                this.emitBriefingMessage(message3, 3000);   // 3s delay
                
            } else {
                // Fallback messages without RAG data
                this.emitBriefingMessage('🔥 BOSS MODE ACTIVATED\nReal-time strategic guidance initiated. Analyzing combat patterns for optimal performance.', 0);
                this.emitBriefingMessage('🎯 PRIMARY STRATEGY\nObserve attack patterns | Exploit recovery windows | Maintain positioning advantage', 1500);
                this.emitBriefingMessage('⚡ COMBAT ESSENTIALS\nStay alert | Watch telegraphs | Adapt tactics | Use environment wisely', 3000);
            }
            
            log('📋 Initial briefing sequence started (3 messages)');
            
        } catch (error) {
            console.error('❌ Failed to generate initial briefing:', error.message);
        }
    }
    
    emitBriefingMessage(message, delay) {
        setTimeout(() => {
            this.emit('boss-briefing', {
                sessionId: this.sessionId,
                briefing: message,
                timestamp: new Date()
            });
        }, delay);
    }
    
    async deactivate(reason = 'manual') {
        if (!this.isActive) {
            console.warn('⚠️ Boss mode not active');
            return false;
        }
        
        log('🛑 Deactivating boss mode, reason:', reason);
        
        // Stop all timers
        if (this.screenshotRequestTimer) {
            clearInterval(this.screenshotRequestTimer);
            this.screenshotRequestTimer = null;
        }
        
        if (this.guidanceGenerationTimer) {
            clearInterval(this.guidanceGenerationTimer);
            this.guidanceGenerationTimer = null;
        }
        
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        
        // Clear queue and guidance history
        this.screenshotQueue = [];
        this.guidanceHistory = [];
        
        const duration = Date.now() - this.bossState.startTime;
        const stats = {
            duration: Math.round(duration / 1000),
            guidanceCount: this.bossState.guidanceCount,
            screenshotCount: this.bossState.screenshotCount
        };
        
        log('📊 Boss mode stats:', stats);
        
        this.isActive = false;
        
        this.emit('boss-mode-deactivated', {
            sessionId: this.sessionId,
            reason,
            stats,
            timestamp: new Date()
        });
        
        // Generate summary based on reason
        await this.generateSummary(reason, stats);
        
        return true;
    }
    
    startScreenshotLoop() {
        log('📸 Starting screenshot request loop (every 2s)');
        
        this.screenshotRequestTimer = setInterval(() => {
            if (this.isActive) {
                this.emit('request-screenshot', {
                    sessionId: this.sessionId,
                    timestamp: new Date()
                });
            }
        }, this.config.screenshotInterval);
    }
    
    startGuidanceLoop() {
        log('🎯 Starting guidance generation loop (every 11s)');
        
        this.guidanceGenerationTimer = setInterval(async () => {
            if (this.isActive && this.screenshotQueue.length > 0) {
                await this.generateGuidance();
            }
        }, this.config.guidanceInterval);
    }
    
    addScreenshot(screenshot) {
        if (!this.isActive) return;
        
        // Add to queue (non-blocking)
        this.screenshotQueue.push({
            image: screenshot.image,
            timestamp: screenshot.timestamp,
            size: screenshot.size
        });
        
        // Keep only last N screenshots (circular buffer)
        if (this.screenshotQueue.length > this.config.maxQueueSize) {
            this.screenshotQueue.shift();
        }
        
        this.bossState.screenshotCount++;
        
        log(`📸 [BOSS] Screenshot queued: ${this.screenshotQueue.length}/${this.config.maxQueueSize}`);
    }
    
    async generateGuidance() {
        try {
            // Get latest single screenshot from queue
            const screenshot = this.screenshotQueue[this.screenshotQueue.length - 1];
            if (!screenshot) return;
            
            log('🎯 [BOSS] Generating guidance from screenshot...');
            const guidanceStart = Date.now();
            
            // Build strategic prompt (accounting for 2-3s delay)
            const prompt = this.buildBossGuidancePrompt();
            
            // Call Gemini 2.5 Flash Vision API (single screenshot for now)
            const result = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: screenshot.image
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: this.config.temperature,
                    maxOutputTokens: this.config.maxOutputTokens,
                    topK: 10,
                    topP: 0.7
                }
            });
            
            const response = await result.response;
            const guidance = response.text().trim();
            
            const guidanceTime = Date.now() - guidanceStart;
            
            // Debug: Log full response details
            if (!guidance || guidance.length === 0) {
                console.error('❌ [BOSS] Empty guidance received!');
                console.error('   Full result:', JSON.stringify(result, null, 2).substring(0, 500));
                console.error('   Response object:', response);
                console.error('   Candidates:', result.response?.candidates);
                return; // Skip empty guidance
            }
            
            log(`🎯 [BOSS] Guidance generated in ${guidanceTime}ms:`, guidance.substring(0, 100));
            
            // Validate format: should start with emoji and be detailed but not too long
            const validFormat = /^[📊🎯⚡💡🔄✓]/;
            const wordCount = guidance.split(/\s+/).length;
            
            if (!validFormat.test(guidance) || wordCount < 10 || wordCount > 30) {
                console.error(`❌ [BOSS] Invalid guidance format! Words: ${wordCount}, Text: "${guidance.substring(0, 50)}..."`);
                console.error('   Expected format: [emoji] [10-30 word detailed insight]');
                return; // Skip invalid guidance
            }
            
            // Check for boss fight end conditions
            const bossStatus = this.detectBossStatus(guidance);
            
            if (bossStatus.defeated) {
                log('🎉 Boss defeated detected!');
                this.deactivate('victory');
                return;
            }
            
            if (bossStatus.playerDied) {
                log('💀 Player death detected');
                this.deactivate('death');
                return;
            }
            
            // Emit single categorized insight (Gemini provides ONE insight per generation)
            this.emit('boss-guidance', {
                sessionId: this.sessionId,
                guidance: guidance.trim(),  // Single categorized insight
                bossHealth: bossStatus.bossHealth,
                playerHealth: bossStatus.playerHealth,
                phase: bossStatus.phase,
                timestamp: new Date(),
                generationTime: guidanceTime
            });
            
            this.bossState.guidanceCount++;
            this.bossState.lastBossHealth = bossStatus.bossHealth;
            this.bossState.lastPlayerHealth = bossStatus.playerHealth;
            
            // Store in guidance history (keep last 20 for context)
            this.guidanceHistory.push(guidance);
            if (this.guidanceHistory.length > 20) {
                this.guidanceHistory.shift();
            }
            
        } catch (error) {
            console.error('❌ Boss guidance generation error:', error.message);
            console.error('❌ Stack:', error.stack);
            // Continue - don't break boss mode on single error
        }
    }
    
    buildBossGuidancePrompt() {
        const gameTitle = this.gameContext.gameTitle || 'game';
        
        // Build context from RAG guide
        let guideContext = '';
        if (this.guideData && this.guideData.steps) {
            const strategies = this.guideData.steps.slice(0, 3).map(step => step.title || step.action).join('; ');
            guideContext = `\nGuide strategies: ${strategies}\n`;
        }
        
        // Build context from previous guidance (last 20)
        let previousContext = '';
        if (this.guidanceHistory.length > 0) {
            const recentGuidance = this.guidanceHistory.slice(-5).join('; ');  // Last 5 for brevity
            previousContext = `\nRecent insights: ${recentGuidance}\n\nProvide NEW insights based on current screenshot.`;
        }
        
        // Categorized, contextual prompt with RAG + memory
        return `CRITICAL: You MUST provide EXACTLY ONE insight between 10-30 words. NO introduction. NO guide. NO paragraphs. NO lists.

${gameTitle} boss coach. Analyze fight screenshot.
${guideContext}${previousContext}

Choose ONE category and provide ONE detailed insight:

📊 Pattern Recognition: Boss attack patterns, combos, telegraphs
🎯 Positioning Note: Player positioning, recommended angles
⚡ Phase/Alert: Phase transitions, major changes
💡 Tactical Insight: Opportunities player is missing
🔄 Adaptation: Mistakes to correct, better approaches
✓ Performance: What's working well, encouragement

OUTPUT FORMAT (EXACTLY like this):
[emoji] [10-30 word detailed insight]

GOOD Examples:
⚡ Boss entering phase 2 transition - expect faster combo attacks and reduced recovery windows
🎯 Move to far left corner behind the pillar to avoid the upcoming fire stomp area attack
💡 Boss is vulnerable for 3 seconds after heavy slam - perfect time for charged ranged attacks

BAD Examples (DO NOT DO THIS):
- "Here's a guide..."
- Multiple sentences
- Numbered lists
- Paragraphs
- Any text longer than 30 words

YOUR RESPONSE (one line only):`;
    }
    
    detectBossStatus(guidanceText) {
        const text = guidanceText.toLowerCase();
        
        return {
            defeated: text.includes('defeated') || 
                     text.includes('you won') || 
                     text.includes('victory') ||
                     text.includes('boss is dead'),
            playerDied: text.includes('you died') || 
                       text.includes('player died') ||
                       text.includes('death screen'),
            bossHealth: this.extractHealthFromText(text, 'boss'),
            playerHealth: this.extractHealthFromText(text, 'player'),
            phase: this.extractPhaseFromText(text)
        };
    }
    
    extractHealthFromText(text, entity) {
        const pattern = new RegExp(`${entity}.*?(\\d+)%`, 'i');
        const match = text.match(pattern);
        return match ? parseInt(match[1]) : this.bossState[`last${entity === 'boss' ? 'Boss' : 'Player'}Health`];
    }
    
    extractPhaseFromText(text) {
        const match = text.match(/phase\s*(\d+)/i);
        return match ? parseInt(match[1]) : this.bossState.phase;
    }
    
    async generateSummary(reason, stats) {
        let summaryMessage = '';
        
        if (reason === 'victory') {
            summaryMessage = `🎉 BOSS DEFEATED! Great job! You handled ${stats.duration} seconds of combat effectively. Returning to normal mode...`;
        } else if (reason === 'death') {
            summaryMessage = `💀 You died after ${stats.duration} seconds. Boss strategies learned - try again! Returning to normal mode...`;
        } else if (reason === 'timeout') {
            summaryMessage = `Boss fight concluded (${stats.duration}s). Returning to normal mode...`;
        } else {
            summaryMessage = `Boss mode ended. Returning to normal mode...`;
        }
        
        this.emit('boss-summary', {
            sessionId: this.sessionId,
            summary: summaryMessage,
            reason,
            stats,
            timestamp: new Date()
        });
    }
    
    getStats() {
        return {
            isActive: this.isActive,
            sessionId: this.sessionId,
            queueSize: this.screenshotQueue.length,
            bossState: this.bossState,
            config: this.config
        };
    }
}

module.exports = BossModeLayer;

