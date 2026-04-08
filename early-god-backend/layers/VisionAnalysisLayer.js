// Layer 3: Vision Analysis (500-1500ms) - GPT-4o Vision API
const OpenAI = require('openai');
const EventEmitter = require('events');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class VisionAnalysisLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required for VisionAnalysisLayer');
        }
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.config = {
            model: options.model || 'gpt-4o', // GPT-4o Vision
            maxTokens: options.maxTokens || 150, // Keep output short for speed
            analysisRate: options.analysisRate || 1, // Analyze every N frames (1-3 FPS)
            urgencyThresholds: {
                lowHealth: options.lowHealthThreshold || 30,
                enemyDistance: options.enemyDistanceThreshold || 50,
                bossPhase: options.bossPhaseThreshold || 0.8
            },
            gameTypes: options.gameTypes || ['rpg', 'action', 'fps', 'mmorpg', 'strategy']
        };
        
        this.isAnalyzing = false;
        this.frameQueue = [];
        this.sessionId = null;
        this.currentGameContext = null;
        this.lastAnalysis = null;
        this.frameCounter = 0;
        
        // Performance tracking
        this.stats = {
            framesAnalyzed: 0,
            totalAnalysisTime: 0,
            avgAnalysisTime: 0,
            urgentEventsDetected: 0,
            cacheHits: 0
        };
        
        // Simple cache for similar frames
        this.analysisCache = new Map();
        this.maxCacheSize = 50;
        
        log('👁️ VisionAnalysisLayer initialized:', {
            model: this.config.model,
            maxTokens: this.config.maxTokens,
            analysisRate: `1 per ${this.config.analysisRate} frames`
        });
    }
    
    async startAnalysis(sessionId, gameContext = {}) {
        if (this.isAnalyzing) {
            console.warn('⚠️ Vision analysis already running');
            return;
        }
        
        this.sessionId = sessionId;
        this.currentGameContext = gameContext;
        this.isAnalyzing = true;
        this.frameCounter = 0;
        
        log('👁️ Starting vision analysis for session:', sessionId);
        log('   🎮 Game context:', gameContext);
        
        this.emit('analysis-started', { sessionId, gameContext });
    }
    
    // ======================================================================
    // OLD PARALLEL GPT-4o VISION PATH (COMMENTED OUT - NOW USING UNIFIED GEMINI)
    // ======================================================================
    // This was the old separate vision AI path that used OpenAI GPT-4o for screenshots.
    // It has been replaced by a unified Gemini 2.5 Flash implementation that handles
    // both simple text questions AND vision questions with screenshots.
    // 
    // Kept here for reference in case we need to roll back.
    // ======================================================================
    /*
    // OLD: Separate GPT-4o Vision implementation
    async processScreenFrame_OLD_GPT4O(frameData) {
        log('📸 [VISION] processScreenFrame called');
        log('   📊 Frame data keys:', Object.keys(frameData || {}));
        log('   🆔 Session ID:', frameData?.sessionId);
        log('   ❓ Question:', frameData?.question);
        log('   📏 Image size:', frameData?.image ? Math.round(frameData.image.length / 1024) + ' KB' : 'NO IMAGE');
        
        try {
            const { sessionId, image, question, timestamp } = frameData;
            
            if (!image || !question) {
                throw new Error(`Missing required data - image: ${!!image}, question: ${!!question}`);
            }
            
            // Call GPT-4o Vision API with the screenshot and question
            const analysisStart = Date.now();
            
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `You are a gaming assistant. The player asked: "${question}"\n\nAnalyze this screenshot and provide a helpful, specific answer in 30-40 words. Focus on what's visible on screen and how it relates to their question.`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${image}`,
                                    detail: 'low' // For speed and cost efficiency
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 100,
                temperature: 0.3
            });
            
            const analysisTime = Date.now() - analysisStart;
            const visionResponse = response.choices[0].message.content.trim();
            
            log('👁️ Vision analysis complete:', {
                question: question.substring(0, 50),
                response: visionResponse.substring(0, 50),
                analysisTime: `${analysisTime}ms`
            });
            
            // Emit vision analysis result
            this.emit('vision-analysis-complete', {
                sessionId,
                question,
                response: visionResponse,
                analysisTime,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Vision analysis error:', error.message);
            
            // Emit error with fallback response
            this.emit('vision-analysis-complete', {
                sessionId: frameData.sessionId,
                question: frameData.question,
                response: "I'm having trouble analyzing the screen right now. Can you describe what you're seeing?",
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    */
    // ======================================================================
    // END OF OLD GPT-4o VISION PATH
    // ======================================================================
    
    // UNIFIED GEMINI PATH: Forward screenshots to unified Gemini AI Decision Engine
    // This now handles BOTH simple questions and vision questions
    async processScreenFrame(frameData) {
        log('📸 [VISION] Forwarding screen frame to unified Gemini AI');
        
        // Instead of processing here, emit an event that will be caught by orchestrator
        // and forwarded to the AI Decision Engine with the image
        this.emit('forward-to-gemini', {
            sessionId: frameData.sessionId,
            screenshot: {
                image: frameData.image,
                question: frameData.question,
                timestamp: frameData.timestamp
            }
        });
    }
    
    async processFrame(frameData) {
        if (!this.isAnalyzing) return;
        
        this.frameCounter++;
        
        // Only analyze every Nth frame based on analysisRate
        if (this.frameCounter % this.config.analysisRate !== 0) {
            return;
        }
        
        const analysisStart = Date.now();
        
        try {
            // Convert frame buffer to base64 for OpenAI API
            const base64Image = frameData.frameBuffer.toString('base64');
            const imageHash = this.generateImageHash(base64Image.substring(0, 100)); // Simple hash
            
            // Check cache first
            if (this.analysisCache.has(imageHash)) {
                const cachedResult = this.analysisCache.get(imageHash);
                this.handleCachedAnalysis(cachedResult, frameData.timestamp);
                return;
            }
            
            // Prepare system prompt based on game context
            const systemPrompt = this.generateSystemPrompt();
            
            // Call GPT-4o Vision API
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                max_tokens: this.config.maxTokens,
                temperature: 0.3,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Analyze this game screen. Focus on: health/status, enemies/threats, objectives, and any urgent situations.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ]
            });
            
            const analysisTime = Date.now() - analysisStart;
            const analysisText = response.choices[0]?.message?.content || '';
            
            // Parse the analysis results
            const analysisResult = this.parseAnalysisResult(analysisText, analysisTime);
            
            // Cache the result
            this.cacheAnalysis(imageHash, analysisResult);
            
            // Update stats
            this.updateStats(analysisTime, analysisResult);
            
            // Emit analysis result
            this.emitAnalysisResult(analysisResult, frameData);
            
        } catch (error) {
            console.error('❌ Vision analysis error:', error.message);
            this.emit('analysis-error', {
                sessionId: this.sessionId,
                error: error.message,
                timestamp: frameData.timestamp
            });
        }
    }
    
    generateSystemPrompt() {
        const gameType = this.currentGameContext?.gameType || 'generic';
        const gameTitle = this.currentGameContext?.gameTitle || 'unknown game';
        
        return `You are analyzing gameplay screenshots for real-time coaching assistance. 

Game: ${gameTitle} (${gameType})

CRITICAL: Respond with a JSON object containing these fields:
{
  "health_percentage": number (0-100, null if not visible),
  "enemies_visible": boolean,
  "enemy_count": number,
  "enemy_threat_level": "low"|"medium"|"high"|"critical",
  "objectives_visible": boolean,
  "current_objective": "string description or null",
  "urgency_level": number (1-5 scale),
  "urgent_situation": boolean,
  "situation_description": "brief description",
  "ui_elements": ["list", "of", "visible", "ui", "elements"],
  "recommended_action": "very brief tactical advice (max 10 words)"
}

Focus on actionable information. Keep descriptions brief. Prioritize detecting urgent situations like low health, nearby enemies, or critical game states.`;
    }
    
    parseAnalysisResult(analysisText, processingTime) {
        try {
            // Try to extract JSON from the response
            const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
            let parsedData = {};
            
            if (jsonMatch) {
                parsedData = JSON.parse(jsonMatch[0]);
            } else {
                // Fallback: create structured data from text
                parsedData = this.extractDataFromText(analysisText);
            }
            
            // Validate and normalize data
            const result = {
                timestamp: new Date(),
                health_percentage: this.validateNumber(parsedData.health_percentage, 0, 100),
                enemies_visible: Boolean(parsedData.enemies_visible),
                enemy_count: this.validateNumber(parsedData.enemy_count, 0, 20) || 0,
                enemy_threat_level: this.validateThreatLevel(parsedData.enemy_threat_level),
                objectives_visible: Boolean(parsedData.objectives_visible),
                current_objective: this.validateString(parsedData.current_objective),
                urgency_level: this.validateNumber(parsedData.urgency_level, 1, 5) || 1,
                urgent_situation: Boolean(parsedData.urgent_situation),
                situation_description: this.validateString(parsedData.situation_description) || 'Normal gameplay',
                ui_elements: Array.isArray(parsedData.ui_elements) ? parsedData.ui_elements : [],
                recommended_action: this.validateString(parsedData.recommended_action) || 'Continue playing',
                raw_analysis: analysisText,
                processing_time_ms: processingTime,
                confidence_score: this.calculateConfidence(parsedData)
            };
            
            return result;
            
        } catch (error) {
            console.warn('⚠️ Failed to parse vision analysis JSON:', error.message);
            
            // Fallback result
            return {
                timestamp: new Date(),
                health_percentage: null,
                enemies_visible: false,
                enemy_count: 0,
                enemy_threat_level: 'low',
                objectives_visible: false,
                current_objective: null,
                urgency_level: 1,
                urgent_situation: false,
                situation_description: 'Analysis parsing failed',
                ui_elements: [],
                recommended_action: 'Continue playing',
                raw_analysis: analysisText,
                processing_time_ms: processingTime,
                confidence_score: 0.1
            };
        }
    }
    
    extractDataFromText(text) {
        const textLower = text.toLowerCase();
        
        return {
            health_percentage: this.extractHealthFromText(textLower),
            enemies_visible: textLower.includes('enemy') || textLower.includes('enemies'),
            enemy_count: this.extractEnemyCountFromText(textLower),
            enemy_threat_level: this.extractThreatFromText(textLower),
            urgent_situation: textLower.includes('urgent') || textLower.includes('danger') || textLower.includes('low health'),
            situation_description: text.substring(0, 100),
            recommended_action: this.extractActionFromText(textLower)
        };
    }
    
    extractHealthFromText(text) {
        const healthMatch = text.match(/health[:\s]*(\d+)[%]?/i) || text.match(/(\d+)[%]\s*health/i);
        return healthMatch ? parseInt(healthMatch[1]) : null;
    }
    
    extractEnemyCountFromText(text) {
        const countMatch = text.match(/(\d+)\s*enem/i);
        return countMatch ? parseInt(countMatch[1]) : (text.includes('enemy') || text.includes('enemies') ? 1 : 0);
    }
    
    extractThreatFromText(text) {
        if (text.includes('critical') || text.includes('danger')) return 'critical';
        if (text.includes('high') || text.includes('urgent')) return 'high';
        if (text.includes('medium') || text.includes('moderate')) return 'medium';
        return 'low';
    }
    
    extractActionFromText(text) {
        if (text.includes('dodge') || text.includes('avoid')) return 'Dodge enemies';
        if (text.includes('heal') || text.includes('health')) return 'Heal up';
        if (text.includes('attack') || text.includes('fight')) return 'Engage enemies';
        return 'Assess situation';
    }
    
    validateNumber(value, min, max) {
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(num)) return null;
        return Math.max(min, Math.min(max, num));
    }
    
    validateString(value) {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    }
    
    validateThreatLevel(value) {
        const validLevels = ['low', 'medium', 'high', 'critical'];
        return validLevels.includes(value) ? value : 'low';
    }
    
    calculateConfidence(data) {
        let score = 0.5; // Base confidence
        
        if (data.health_percentage !== null) score += 0.2;
        if (data.enemies_visible && data.enemy_count > 0) score += 0.1;
        if (data.current_objective) score += 0.1;
        if (data.recommended_action) score += 0.1;
        
        return Math.min(1.0, score);
    }
    
    generateImageHash(imageData) {
        // Simple hash function for caching similar frames
        let hash = 0;
        for (let i = 0; i < imageData.length; i++) {
            const char = imageData.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }
    
    cacheAnalysis(imageHash, result) {
        // Simple LRU cache
        if (this.analysisCache.size >= this.maxCacheSize) {
            const firstKey = this.analysisCache.keys().next().value;
            this.analysisCache.delete(firstKey);
        }
        
        this.analysisCache.set(imageHash, {
            ...result,
            cached_at: Date.now()
        });
    }
    
    handleCachedAnalysis(cachedResult, timestamp) {
        this.stats.cacheHits++;
        
        const result = {
            ...cachedResult,
            timestamp,
            processing_time_ms: 5, // Cache hit is very fast
            from_cache: true
        };
        
        this.emitAnalysisResult(result, { timestamp });
    }
    
    updateStats(analysisTime, result) {
        this.stats.framesAnalyzed++;
        this.stats.totalAnalysisTime += analysisTime;
        this.stats.avgAnalysisTime = this.stats.totalAnalysisTime / this.stats.framesAnalyzed;
        
        if (result.urgent_situation) {
            this.stats.urgentEventsDetected++;
        }
        
        // Log performance every 10 analyses
        if (this.stats.framesAnalyzed % 10 === 0) {
            log(`📊 Vision analysis: ${this.stats.framesAnalyzed} frames, avg ${Math.round(this.stats.avgAnalysisTime)}ms, ${this.stats.urgentEventsDetected} urgent events`);
        }
    }
    
    emitAnalysisResult(result, frameData) {
        this.lastAnalysis = result;
        
        this.emit('analysis-result', {
            sessionId: this.sessionId,
            frameTimestamp: frameData.timestamp,
            analysis: result
        });
        
        // Emit urgent events separately for immediate handling
        if (result.urgent_situation) {
            log(`🚨 URGENT: ${result.situation_description}`);
            this.emit('urgent-situation', {
                sessionId: this.sessionId,
                urgency_level: result.urgency_level,
                situation: result.situation_description,
                recommended_action: result.recommended_action,
                analysis: result
            });
        }
    }
    
    async stopAnalysis() {
        if (!this.isAnalyzing) {
            console.warn('⚠️ Vision analysis not running');
            return;
        }
        
        log('🛑 Stopping vision analysis');
        this.isAnalyzing = false;
        
        this.emit('analysis-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        // Clear state
        this.sessionId = null;
        this.currentGameContext = null;
        this.frameQueue = [];
        this.frameCounter = 0;
    }
    
    getLastAnalysis() {
        return this.lastAnalysis;
    }
    
    getStats() {
        return {
            ...this.stats,
            isAnalyzing: this.isAnalyzing,
            sessionId: this.sessionId,
            frameCounter: this.frameCounter,
            cacheSize: this.analysisCache.size,
            config: this.config
        };
    }
    
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        log('🔧 Vision analysis config updated:', newConfig);
    }
}

module.exports = VisionAnalysisLayer;
