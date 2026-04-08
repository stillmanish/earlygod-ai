// Layer 5: AI Decision Engine (400-800ms) - Gemini 2.5 Flash for fast responses
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Vertex AI fine-tuned model support is optional in the open-source build.
// If @google-cloud/vertexai is not installed, this falls back to standard Gemini.
let VertexAI = null;
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
try {
    VertexAI = require('@google-cloud/vertexai').VertexAI;
} catch (err) {
    log('ℹ️ @google-cloud/vertexai not installed — fine-tuned model support disabled (using standard Gemini API)');
}

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
// Use LocalGameSearch (offline keyword search over game-primers/) instead of Vertex AI Vector Search
const VertexVectorSearch = require('../services/LocalGameSearch');

class AIDecisionEngineLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Check for Vertex AI fine-tuned model configuration
        // Requires both: (1) the @google-cloud/vertexai package installed, AND (2) full config
        const hasVertexAIConfig = VertexAI &&
                                 options.useFineTunedModel &&
                                 options.projectId &&
                                 options.location &&
                                 options.tunedModelId &&
                                 options.credentials;

        this.useFineTunedModel = hasVertexAIConfig;
        this.options = options; // Store for later reference
        
        if (hasVertexAIConfig) {
            // Initialize Vertex AI client for fine-tuned model (following recommended approach)
            log('🤖 Initializing Vertex AI client for fine-tuned model');
            
            try {
                // Step 1: Decode base64 credentials
                const credentialsJson = Buffer.from(options.credentials, 'base64').toString('utf-8');
                const credentials = JSON.parse(credentialsJson);
                log('✅ Successfully decoded service account credentials');
                
                // Step 2: Write credentials to temporary file (as recommended by Google)
                const credentialsPath = path.join(os.tmpdir(), `gcp_credentials_${Date.now()}.json`);
                fs.writeFileSync(credentialsPath, credentialsJson);
                log('✅ Wrote credentials to temporary file:', credentialsPath);
                
                // Step 3: Set environment variable that Google library looks for
                process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
                log('✅ Set GOOGLE_APPLICATION_CREDENTIALS environment variable');
                
                // Step 4: Initialize Vertex AI (following Python approach)
                const vertexAI = new VertexAI({
                    project: options.projectId,
                    location: options.location
                });
                
                // Step 5: Load the fine-tuned model endpoint using full resource name
                const fullEndpointName = `projects/${options.projectId}/locations/${options.location}/endpoints/${options.tunedModelId}`;
                log(`🤖 Loading fine-tuned model endpoint: ${fullEndpointName}`);
                this.tunedModel = vertexAI.getGenerativeModel({
                    model: fullEndpointName
                });
                
                log(`✅ Vertex AI fine-tuned endpoint initialized: ${options.tunedModelId}`);
                log(`   📍 Project: ${options.projectId}`);
                log(`   🌍 Location: ${options.location}`);
                log(`   📁 Credentials file: ${credentialsPath}`);
                
                // Store credentials path for cleanup
                this.credentialsPath = credentialsPath;
                
            } catch (error) {
                console.error('❌ Failed to initialize Vertex AI:', error.message);
                console.error('   📋 Error details:', error);
                throw new Error(`Vertex AI initialization failed: ${error.message}`);
            }
        }
        
        // Always initialize standard Gemini as backup (even if using Vertex AI)
        if (!process.env.GEMINI_API_KEY) {
            if (!hasVertexAIConfig) {
                throw new Error('GEMINI_API_KEY is required for AIDecisionEngineLayer when not using Vertex AI');
            } else {
                console.warn('⚠️ No GEMINI_API_KEY - Vertex AI will be used without fallback');
            }
        } else {
            this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            this.model = this.genAI.getGenerativeModel({ 
                model: options.model || "gemini-3-pro-preview"
            });
            
            if (hasVertexAIConfig) {
                log('✅ Standard Gemini initialized as backup for Vertex AI');
            } else {
                log('✅ Using standard Gemini API (no fine-tuned model configured)');
            }
        }
        
        this.config = {
            maxOutputTokens: options.maxOutputTokens || 8192,  // No limit - use Gemini's max (8192 tokens)
            maxOutputTokensNewGames: options.maxOutputTokensNewGames || 8192,  // Same for new games
            temperature: options.temperature || 0.7,
            responseTimeoutMs: options.responseTimeoutMs || 7500, // 7.5 second timeout for faster failure detection
            maxConcurrentRequests: options.maxConcurrentRequests || 50, // Increased to prevent queue blocking
            systemPromptTemplate: options.systemPromptTemplate || this.getDefaultSystemPrompt()
        };
        
        this.isActive = false;
        this.sessionId = null;
        this.gameContext = {};
        this.activeRequests = new Map();
        this.activeSessionRequests = new Map(); // Track active requests per session (prevents race conditions)
        this.sessionRequestQueues = new Map(); // Queue pending requests per session
        this.recentQueries = new Map(); // Track recent queries to prevent duplicates (query -> timestamp)
        this.queryDedupeWindow = 3000; // 3 second deduplication window
        
        // Game metadata for hallucination prevention (Part 1: New game detection)
        this.gameMetadata = {
            'Ghost of Yotei': { releaseYear: 2025, requiresStrictRAG: true },
            'Black Myth: Wukong': { releaseYear: 2024, requiresStrictRAG: true },
            'Expedition 33': { releaseYear: 2025, requiresStrictRAG: true },
            'Europa Universalis V': { releaseYear: 2026, requiresStrictRAG: true },
            'Elden Ring': { releaseYear: 2022, requiresStrictRAG: false },
            'Dark Souls 3': { releaseYear: 2016, requiresStrictRAG: false },
            'Sekiro': { releaseYear: 2019, requiresStrictRAG: false }
        };
        
        // Pre-cached responses for common situations (Cluely optimization)
        this.responseCache = new Map([
            ['low_health_enemies', 'Low health with enemies nearby! Find cover and heal immediately.'],
            ['critical_health', 'CRITICAL HEALTH! Heal now or retreat to safety!'],
            ['boss_fight', 'Boss detected! Use your strongest attacks and watch for patterns.'],
            ['many_enemies', 'Multiple enemies! Use area attacks or retreat to avoid overwhelm.'],
            ['safe_moment', 'Good time to heal, check inventory, or plan your next move.'],
            ['stuck_help', 'Looks like you need guidance. Check your objectives or ask specific questions.']
        ]);
        
        // Performance tracking
        this.stats = {
            responsesGenerated: 0,
            totalResponseTime: 0,
            avgResponseTime: 0,
            cacheHits: 0,
            timeouts: 0,
            errors: 0,
            urgentResponses: 0
        };
        
        // Store GuideSearchService if provided
        this.guideSearchService = options.guideSearchService;
        if (this.guideSearchService) {
            log('📚 GuideSearchService injected into AI layer');
        } else {
            console.warn('⚠️ GuideSearchService NOT provided to AI layer - Deep RAG disabled');
        }

        log('🤖 AIDecisionEngineLayer initialized:', {
            modelType: this.useFineTunedModel ? 'Vertex AI Fine-Tuned' : 'Standard Gemini',
            model: this.useFineTunedModel ? options.tunedModelId : (options.model || "gemini-2.5-flash"),
            maxTokens: this.config.maxOutputTokens,
            timeout: `${this.config.responseTimeoutMs}ms`,
            cacheSize: this.responseCache.size,
            modelObject: this.useFineTunedModel ? !!this.tunedModel : !!this.model
        });
    }
    
    // Helper methods for game metadata (Part 1: New game detection)
    isNewGame(gameTitle) {
        const metadata = this.gameMetadata[gameTitle];
        return metadata ? metadata.releaseYear >= 2024 : true; // Default to strict for unknown games
    }
    
    requiresStrictRAG(gameTitle) {
        const metadata = this.gameMetadata[gameTitle];
        return metadata ? metadata.requiresStrictRAG : true; // Default to strict for unknown games
    }
    
    getDefaultSystemPrompt() {
        return `You are a direct gaming assistant providing real-time help.

KNOWLEDGE USAGE RULES:
📚 When GAME KNOWLEDGE is provided below:
- Use that information as your PRIMARY source to answer questions
- The knowledge is verified and specific to this game
- Combine the provided knowledge to give comprehensive, helpful answers
- If the knowledge partially addresses the question, use what's available

⚠️ Anti-hallucination guidelines:
- Prefer provided knowledge over general gaming knowledge
- Don't invent specific locations, items, or quests not mentioned
- If completely unsure, acknowledge it briefly but try to be helpful

RESPONSE RULES:
- Give ONE helpful response in 30-60 words maximum
- Be CONCISE and DIRECT - no fluff words or unnecessary elaboration
- NO phrases like "absolutely", "great work", "welcome tarnished", "let me help"
- Get straight to the point with actionable information
- Match the urgency of the situation
- Use present tense and be direct

When you DON'T know something (especially for new games):
✅ GOOD: "I don't have specific information about that quest in my current knowledge base."
✅ GOOD: "Based on the game knowledge I have, I can tell you about X, but I don't have details about Y."
❌ BAD: Making up plausible-sounding but unverified information

Response types:
- URGENT (health <30%, enemies): "Heal now!" or "Retreat immediately!"
- WARNING (enemies nearby): "Enemy behind!" or "Dodge incoming attack!"
- QUESTION (player asks): Answer ONLY if knowledge is available
- CONVERSATION (general talk): Give useful tip from knowledge base only
- GUIDANCE (stuck/lost): Use specific directions from game knowledge
- TIP (calm moment): "Upgrade now" or "Save progress"

Examples of GOOD responses (grounded, concise):
- Player: "where are the best weapons early?" → You: "Longswords and axes work well. Check the armory near Gravesite Plain. Upgrade with smithing stones."
- Player: "what's the secret ending?" → You: "I don't have information about secret endings in my current knowledge base."

Examples of BAD responses (hallucinated or too wordy):
- Making up quest names or locations not in knowledge base
- Inventing item locations or mechanics
- "Absolutely! Let me help you with that. Welcome, Tarnished!"

Be specific with locations, items, and directions ONLY when you have verified knowledge. When uncertain, admit it.`;
    }
    
    async start(sessionId, gameContext = {}) {
        if (this.isActive) {
            console.warn('⚠️ AI Decision Engine already active');
            return;
        }
        
        this.sessionId = sessionId;
        this.gameContext = gameContext;
        this.isActive = true;
        
        log('🤖 Starting AI Decision Engine for session:', sessionId);
        log('   🎮 Game:', gameContext.gameTitle || 'Unknown');
        
        this.emit('ai-engine-started', { sessionId, gameContext });
    }
    
    async processContextForAI(contextData) {
        if (!this.isActive) {
            return;
        }
        
        try {
            // Simple validation
            const transcript = contextData?.fusedContext?.currentState?.audio?.transcript;
            
            if (!contextData || !contextData.fusedContext || !contextData.situationAnalysis) {
                console.error('❌ Invalid context data structure:', contextData);
                return;
            }
            
            // SAFEGUARD: Trust Nova-3 and only skip truly empty transcripts
            // Nova-3 already filtered out non-speech, TranscriptionLayer filtered confidence < 0.5
            // We just need to catch edge cases
            if (!transcript || transcript.trim().length === 0) {
                log('⏭️ Skipping AI request - empty transcript');
                return;
            }
        } catch (error) {
            console.error('❌ [DEBUG] Error at start of processContextForAI:', error.message);
            console.error('❌ [DEBUG] Stack:', error.stack);
            return;
        }
        
        const { fusedContext, situationAnalysis } = contextData;
        
        // 🎯 SMART DEDUPLICATION: Only block truly identical queries within short window  
        const queryText = fusedContext.currentState?.audio?.transcript || '';
        const now = Date.now();
        
        // Clean expired queries from dedup map
        for (const [query, timestamp] of this.recentQueries.entries()) {
            if (now - timestamp > 5000) { // 5 second cleanup window
                this.recentQueries.delete(query);
            }
        }
        
        // ✅ FIX: Make duplicate detection much more restrictive
        // Only block if EXACT same text within 1 second (likely accidental double-click)
        const exactQuery = queryText.toLowerCase().trim();
        if (this.recentQueries.has(exactQuery)) {
            const timeSinceLastQuery = now - this.recentQueries.get(exactQuery);
            if (timeSinceLastQuery < 1000) { // Only 1 second window for exact duplicates
                log(`🔄 True duplicate detected (${timeSinceLastQuery}ms ago), skipping spam`);
                return;
            } else {
                log(`✅ Similar question but ${timeSinceLastQuery}ms later - allowing as follow-up`);
            }
        }
        
        // Mark this query as processed
        this.recentQueries.set(exactQuery, now);
        
        // Skip if AI response not needed
        if (!situationAnalysis.needsAIResponse) {
            log('⏭️ AI response not needed');
            return;
        }
        
        // 🛡️ SAFETY: Simple empty check (trust Nova-3 and TranscriptionLayer filtering)
        const finalTranscript = fusedContext?.currentState?.audio?.transcript;
        if (!finalTranscript || finalTranscript.trim().length === 0) {
            log('⏭️ AI: Skipping empty transcript');
            return;
        }
        
        // 🔒 LOCK MANAGEMENT: Define these in outer scope for cleanup access
        const responseStart = Date.now();
        const requestId = `req_${responseStart}_${Math.random().toString(36).substr(2, 9)}`;
        const sessionId = fusedContext.sessionId;
        let lockAcquired = false;
        let lockTimeout = null;
        
        try {
            // Extract request tracking info
            const speechRequestId = fusedContext.currentState?.audio?.requestId || 'unknown';
            const speechStartTime = fusedContext.currentState?.audio?.speechStartTime;
            const latencyToAI = speechStartTime ? Date.now() - speechStartTime : null;
            
            log(`🤖 [${speechRequestId}] AI processing starting`);
            if (latencyToAI) {
                log(`   ⏱️ Latency from speech start: ${latencyToAI}ms`);
            }
            
            // Check for pre-cached responses first (Cluely optimization)
            const cachedResponse = this.checkCache(fusedContext, situationAnalysis);
            if (cachedResponse) {
                this.handleCachedResponse(cachedResponse, contextData, responseStart);
                return;
            }
            
            // 🔒 CRITICAL: Prevent race conditions - queue requests if session is busy
            if (this.activeSessionRequests.has(sessionId)) {
                const activeRequest = this.activeSessionRequests.get(sessionId);
                const timeSinceStart = Date.now() - activeRequest.startTime;
                console.warn('⚠️ [QUEUE] Session busy, queuing request:', {
                    sessionId,
                    activeRequestId: activeRequest.requestId,
                    timeSinceStart: `${timeSinceStart}ms`,
                    currentQuestion: finalTranscript.substring(0, 30),
                    activeQuestion: activeRequest.transcript.substring(0, 30)
                });
                
                // Queue instead of drop
                if (!this.sessionRequestQueues.has(sessionId)) {
                    this.sessionRequestQueues.set(sessionId, []);
                }
                this.sessionRequestQueues.get(sessionId).push(contextData);
                log(`   📥 Queued (${this.sessionRequestQueues.get(sessionId).length} pending)`);
                return;
            }
            
            // Check concurrent request limit
            if (this.activeRequests.size >= this.config.maxConcurrentRequests) {
                console.warn('⚠️ AI request limit reached, queuing...');
                setTimeout(() => this.processContextForAI(contextData), 200);
                return;
            }
            
            // 🔐 ACQUIRE LOCKS: Track active request (both global and per-session)
            this.activeRequests.set(requestId, {
                startTime: responseStart,
                context: fusedContext,
                urgency: situationAnalysis.urgencyLevel
            });
            
            this.activeSessionRequests.set(sessionId, {
                requestId: requestId,
                startTime: responseStart,
                transcript: finalTranscript
            });
            lockAcquired = true;
            
            // 🛡️ SAFETY: Auto-release lock after 65s if request gets stuck (prevents permanent lock)
            // Must be longer than responseTimeoutMs (60s) to allow valid long requests
            lockTimeout = setTimeout(() => {
                if (this.activeSessionRequests.has(sessionId)) {
                    console.error('🚨 [LOCK LEAK] Session lock stuck for 65s, force releasing:', {
                        sessionId,
                        requestId,
                        transcript: finalTranscript.substring(0, 30),
                        lockAge: `${Date.now() - responseStart}ms`
                    });
                    this.activeSessionRequests.delete(sessionId);
                    this.activeRequests.delete(requestId);
                }
            }, 10000); // 10 second safety timeout
            
            // Generate AI response
            const response = await this.generateAIResponse(fusedContext, situationAnalysis, requestId);
            
            // Clear safety timeout (request completed successfully)
            if (lockTimeout) clearTimeout(lockTimeout);
            
            // Clean up and emit result
            this.activeRequests.delete(requestId);
            this.activeSessionRequests.delete(sessionId);
            
            // Log end-to-end latency
            const totalLatency = speechStartTime ? Date.now() - speechStartTime : null;
            log(`✅ [${speechRequestId}] AI response complete`);
            if (totalLatency) {
                log(`   📊 END-TO-END LATENCY: ${totalLatency}ms (Speech→AI)`);
            }
            log(`✅ [RACE PREVENTION] Session request lock released (success): ${sessionId}`);
            
            // Process next queued request if any
            if (this.sessionRequestQueues.has(sessionId)) {
                const queue = this.sessionRequestQueues.get(sessionId);
                if (queue.length > 0) {
                    const nextRequest = queue.shift();
                    log('📤 Processing next queued request for session:', sessionId);
                    setImmediate(() => this.processContextForAI(nextRequest));
                }
            }
            
            // Log detailed latency breakdown
            if (totalLatency) {
                const aiProcessingTime = Date.now() - responseStart;
                log(`📊 [${speechRequestId}] LATENCY BREAKDOWN:`);
                log(`   Speech Start → AI Start: ${latencyToAI}ms`);
                log(`   AI Processing: ${aiProcessingTime}ms`);
                log(`   TOTAL (Speech → Response): ${totalLatency}ms`);
            }
            
            this.handleAIResponse(response, contextData, responseStart);
            
        } catch (error) {
            // Clear safety timeout on error
            if (lockTimeout) clearTimeout(lockTimeout);
            
            this.activeRequests.delete(requestId);
            this.activeSessionRequests.delete(sessionId);
            log('🔓 [RACE PREVENTION] Session request lock released (error):', sessionId);
            
            // Process next queued request even if this one failed
            if (this.sessionRequestQueues.has(sessionId)) {
                const queue = this.sessionRequestQueues.get(sessionId);
                if (queue.length > 0) {
                    const nextRequest = queue.shift();
                    log('📤 Processing next queued request for session:', sessionId);
                    setImmediate(() => this.processContextForAI(nextRequest));
                }
            }
            
            this.handleAIError(error, contextData, responseStart);
        } finally {
            // 🛡️ GUARANTEED CLEANUP: Ensure locks are always released
            if (lockAcquired) {
                if (lockTimeout) clearTimeout(lockTimeout);
                
                if (this.activeSessionRequests.has(sessionId)) {
                    console.warn('🧹 [FINALLY] Lock still held, cleaning up in finally block:', sessionId);
                    this.activeSessionRequests.delete(sessionId);
                }
                if (this.activeRequests.has(requestId)) {
                    this.activeRequests.delete(requestId);
                }
            }
        }
    }
    
    async generateAIResponse(fusedContext, situationAnalysis, requestId) {
        const baseTimeout = this.useFineTunedModel ? 20000 : this.config.responseTimeoutMs; // 20s for Vertex AI, 25s for Gemini with RAG
        const responseTimeout = situationAnalysis.urgencyLevel >= 4 ? 
            Math.min(baseTimeout, 1000) : // 1 second for urgent
            baseTimeout;
        
        // Build context-aware prompt
        const prompt = await this.buildPrompt(fusedContext, situationAnalysis);
        
        // Choose between Vertex AI fine-tuned model or standard Gemini API
        const modelToUse = this.useFineTunedModel ? this.tunedModel : this.model;
        const modelType = this.useFineTunedModel ? 'Vertex AI Fine-Tuned' : 'Standard Gemini';
        
        // Minimal logging for production
        log(`🤖 Generating AI response (${modelType}, urgency: ${situationAnalysis.urgencyLevel}/5)`);
        
        // Create timeout promise with clearable timer to prevent stale timer bugs
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                // Clean up this request from activeRequests so it doesn't block future requests
                this.activeRequests.delete(requestId);
                this.activeSessionRequests.delete(fusedContext.sessionId);
                console.error(`❌ AI timeout after ${responseTimeout}ms`);
                log('🔓 [RACE PREVENTION] Session request lock released (timeout):', fusedContext.sessionId);
                reject(new Error(`AI response timeout after ${responseTimeout}ms`));
            }, responseTimeout);
        });
        
        // Create AI generation promise
        const apiCallStart = Date.now();
        
        // ======================================================================
        // UNIFIED AI MODEL - Handles BOTH text-only and vision questions
        // ======================================================================
        // This architecture supports both:
        // - Standard Gemini 2.5 Flash (Google AI API)
        // - Fine-tuned Gemini 2.5 (Vertex AI endpoint)
        //
        // Both models handle:
        // - Simple questions: Just text prompt (no image)
        // - Vision questions: Text prompt + screenshot image
        // ======================================================================
        
        // Build content parts - text prompt + optional image
        const contentParts = [{ text: prompt }];
        
        // Add screenshot if available for vision questions
        if (fusedContext.screenshot && fusedContext.screenshot.image) {
            log(`🖼️ Including screenshot in ${modelType} request (UNIFIED PATH)`);
            contentParts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: fusedContext.screenshot.image // base64 string
                }
            });
        } else {
        }
        
        let actualModelUsed = modelType; // Track which model was actually used
        
        // PART 5: Lower temperature for new games to reduce hallucination
        const gameTitle = fusedContext.gameContext?.gameTitle || '';
        const isNewGame = this.isNewGame(gameTitle);
        const adjustedTemp = isNewGame ? 0.3 : this.config.temperature; // Lower temp = less creative = less hallucination
        
        log(`🎯 Model settings: temp=${adjustedTemp.toFixed(1)} (new game: ${isNewGame}), topK=${isNewGame ? 10 : 40}`);
        
        // Build generation config with anti-hallucination settings
        // Use higher token limit for new games (they have longer prompts with RAG data)
        const maxTokens = isNewGame ? this.config.maxOutputTokensNewGames : this.config.maxOutputTokens;
        
        const generationConfig = {
            temperature: adjustedTemp,
            maxOutputTokens: maxTokens,
            topK: isNewGame ? 10 : 40,  // Fewer options = more grounded
            topP: isNewGame ? 0.7 : 0.95  // Lower p = stick to high-confidence tokens
        };
        
        // Gemini 3 Specific Configuration
        const currentModelName = (this.useFineTunedModel ? '' : (this.model.model || this.options.model || ''));
        if (currentModelName.includes('gemini-3')) {
            log('🧠 Gemini 3 detected - using default HIGH thinking level');
            
            // Remove temperature as recommended for reasoning models to avoid loops
            if (generationConfig.temperature) {
                log(`   🌡️ Removing custom temperature (${generationConfig.temperature}) for Gemini 3 stability`);
                delete generationConfig.temperature;
            }
        }
        
        log(`🎯 Token budget: ${maxTokens} tokens (new game adjustment)`);

        
        // 🔧 FORMAT REQUEST CORRECTLY: Fine-tuned models need 'contents' structure
        let requestPayload;
        if (this.useFineTunedModel && modelToUse === this.tunedModel) {
            // Vertex AI Fine-Tuned Model: Use contents array with role structure and generationConfig
            requestPayload = {
                contents: [
                    {
                        role: 'user',
                        parts: contentParts
                    }
                ],
                generationConfig: generationConfig
            };
        } else {
            // Standard Gemini: Use proper contents structure with generationConfig
            requestPayload = {
                contents: [
                    {
                        role: 'user',
                        parts: contentParts
                    }
                ],
                generationConfig: generationConfig
            };

            // Enable Google Search for new games (Fallback Knowledge)
            if (isNewGame && !this.useFineTunedModel) {
                log('🔍 Enabling Google Search Grounding for fallback knowledge');
                requestPayload.tools = [{ googleSearch: {} }];
            }
        }
        
        const aiPromise = modelToUse.generateContent(requestPayload).then(result => {
            const apiCallTime = Date.now() - apiCallStart;
            log(`✅ ${modelType} responded (${apiCallTime}ms)`);
            return { result, modelUsed: actualModelUsed };
        }).catch(error => {
            const apiCallTime = Date.now() - apiCallStart;
            console.error(`❌ [CRITICAL] ${modelType} API error after ${apiCallTime}ms:`, error.message);
            console.error(`❌ [CRITICAL] Error name:`, error.name);
            console.error(`❌ [CRITICAL] Error code:`, error.code);
            console.error(`❌ [CRITICAL] Full error:`, error);
            
            // If Vertex AI fails, fall back to standard Gemini
            if (this.useFineTunedModel && this.model) {
                console.warn(`⚠️ Vertex AI failed (${error.message}), falling back to standard Gemini for this request`);
                actualModelUsed = 'Standard Gemini'; // Update model used to fallback
                // Use proper contents structure with generationConfig for standard Gemini fallback
                const fallbackPayload = {
                    contents: [
                        {
                            role: 'user',
                            parts: contentParts
                        }
                    ],
                    generationConfig: generationConfig
                };
                return this.model.generateContent(fallbackPayload).then(result => {
                    return { result, modelUsed: actualModelUsed };
                });
            }
            
            throw error;
        });
        
        // Race between AI response and timeout
        const apiResult = await Promise.race([aiPromise, timeoutPromise]);
        
        // ✅ CRITICAL: Clear the timeout timer since AI succeeded (prevents stale timer firing)
        clearTimeout(timeoutHandle);
        log('⏱️ [TIMER] Timeout cleared - AI responded in time');
        
        const response = await apiResult.result.response;
        
        // 🔧 DEFENSIVE RESPONSE PARSING: Handle all possible response structures safely
        if (!response.candidates || response.candidates.length === 0) {
            console.error('❌ No candidates in response:', JSON.stringify(response, null, 2).substring(0, 500));
            throw new Error('AI response blocked or empty - no candidates returned');
        }
        
        const candidate = response.candidates[0];
        
        // Special handling for MAX_TOKENS - provide helpful fallback
        if (candidate.finishReason === 'MAX_TOKENS') {
            console.warn('⚠️ Response hit token limit - prompt may be too long');
            console.warn('   Finish reason:', candidate.finishReason);
            console.warn('   Has content.parts:', !!candidate.content?.parts);
            
            // Try to extract any partial content if available
            if (candidate.content?.parts && candidate.content.parts.length > 0) {
                const partialText = candidate.content.parts[0].text?.trim();
                if (partialText) {
                    console.warn('⚠️ Using partial response from MAX_TOKENS');
                    return {
                        text: partialText + '...',
                        modelUsed: apiResult.modelUsed
                    };
                }
            }
            
            // No partial content available - return helpful fallback
            throw new Error('Response too long for current token limit. Try a shorter question or check prompt length.');
        }
        
        if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            console.error('❌ Invalid candidate structure:', JSON.stringify(candidate, null, 2).substring(0, 500));
            throw new Error('AI response malformed - missing content.parts');
        }
        
        const text = candidate.content.parts[0].text?.trim() || '';
        if (!text) {
            console.error('❌ Empty text in response:', JSON.stringify(candidate, null, 2).substring(0, 500));
            throw new Error('AI response empty - no text content');
        }
        
        // Validate response length (30-60 words ≈ 200-400 characters)
        if (text.length > 450) {
            console.warn('⚠️ AI response too long, truncating:', text.substring(0, 50));
            return {
                text: this.truncateResponse(text),
                modelUsed: apiResult.modelUsed
            };
        }
        
        return {
            text: text,
            modelUsed: apiResult.modelUsed
        };
    }
    
    async buildPrompt(fusedContext, situationAnalysis) {
        try {
            const urgencyPrefix = this.getUrgencyPrefix(situationAnalysis.urgencyLevel);
            const responseType = situationAnalysis.suggestedResponseType;
            const context = fusedContext.narrative;
            
            // Get game-specific context (use session context for current game)
            const sessionGame = fusedContext.sessionMemory?.game;
            const gameTitle = sessionGame?.title || this.gameContext.gameTitle || 'game';
            const gameType = sessionGame?.type || this.gameContext.gameType || 'action';
            
            log(`🎮 [DEBUG] Current game context: ${gameTitle} (${gameType})`);
            
            const playerQuestion = fusedContext.currentState.audio?.transcript || 'help';
            
            // Get session memory (sliding window)
            const sessionMemory = fusedContext.sessionMemory;
            const ragRelevance = sessionMemory?.ragRelevance || 0;
            
            // Get preloaded memory from session
            const preloadedMemory = sessionMemory?.preloadedMemory || '';
            
            // ======================================================================
            // UNIFIED GEMINI PROMPT BUILDING
            // ======================================================================
            // If screenshot is present, build a vision-specific prompt
            // Otherwise, build a standard text-only prompt
            // The SAME Gemini model handles both cases
            // ======================================================================
            
            if (fusedContext.screenshot && fusedContext.screenshot.image) {
                log('🖼️ Building prompt with screenshot available (UNIFIED GEMINI)');
                
                // Check if question is actually about vision
                const visionKeywords = ['see', 'screen', 'look', 'where', 'what', 'show', 'display', 'viewing', 'visual'];
                const isVisionQuestion = visionKeywords.some(keyword => playerQuestion.toLowerCase().includes(keyword));
                
                if (isVisionQuestion) {
                    log('   👁️ Vision question detected - instructing Gemini to analyze screenshot');
                    return `${this.config.systemPromptTemplate}

You are analyzing a screenshot from the game ${gameTitle}.
The player SPOKE this question (transcribed from voice): "${playerQuestion}"

Analyze what you see in the image and provide a helpful, specific answer in 30-60 words.
Focus on:
- What's visible on screen that relates to their question
- Specific UI elements, enemies, items, or locations shown
- Actionable advice based on what you see

Be direct and specific about what you observe in the screenshot.`;
                } else {
                    log('   💬 Non-vision question - screenshot available but not needed');
                    return `${this.config.systemPromptTemplate}

Game: ${gameTitle} (${gameType})
The player SPOKE this question (transcribed from voice): "${playerQuestion}"

NOTE: A screenshot is available but this question is not about visuals. Answer the spoken question naturally and conversationally in 30-60 words. Only mention the screenshot if the question specifically asks about what's on screen.

Current situation: ${context}
Response type: ${responseType}`;
                }
            }
            
            // 🎯 RAG CONTEXT INTEGRATION - Handle guide context safely
            const guideContext = fusedContext.guideContext;
            
            if (guideContext && guideContext.title) {
                // RAG-enhanced prompt with guide context
                log(`🎯 [DEBUG] Building RAG-enhanced prompt with guide: "${guideContext.title}"`);
                
                const currentStep = guideContext.currentStep;
                const relevantSteps = guideContext.relevantSteps || [];
                
                let guideSection = `\n🎯 GUIDE CONTEXT:\nGuide: ${guideContext.title}`;
                
                if (currentStep) {
                    guideSection += `\nCurrent Step ${currentStep.step_number}: ${currentStep.title}
Action: ${currentStep.action}
Visual Cues: ${currentStep.visual_cues || 'Not specified'}
Strategic Context: ${currentStep.strategic_context || 'Not specified'}`;
                }
                
                if (relevantSteps.length > 0) {
                    guideSection += `\nRelevant Steps:\n${relevantSteps.slice(0, 3).map(step => 
                        `Step ${step.step_number}: ${step.title}
Action: ${step.action}
Visual Cues: ${step.visual_cues || 'Not specified'}
Observe: ${step.observe || 'Not specified'}
Resources: ${step.resources || 'None'}
Strategic Context: ${step.strategic_context || 'Not specified'}`
                    ).join('\n\n')}`;
                }
                
                let prompt = `${this.config.systemPromptTemplate}

Game: ${gameTitle} (${gameType})
Player question: "${playerQuestion}"
Current situation: ${context}${guideSection}
Response type: ${responseType}
Urgency: ${urgencyPrefix}`;

                // Add preloaded memory if available
                if (preloadedMemory && preloadedMemory.length > 0) {
                    prompt += `\n\n${preloadedMemory}`;
                }

                prompt += `\n\nGive a helpful, contextual answer using the guide information in 30-60 words:`;
                
                return prompt;
            } else {
                // Standard prompt with session memory and smart RAG inclusion
                log(`🎯 [DEBUG] Building standard prompt with session memory (RAG relevance: ${ragRelevance.toFixed(2)})`);
                
                let promptParts = [this.config.systemPromptTemplate];
                
                // Inject Current Date Context to override model knowledge cutoff
                const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                promptParts.push(`\n📅 CURRENT DATE: ${today}`);
                promptParts.push(`NOTE: If a game's release date is before today, treat it as RELEASED and AVAILABLE, overriding internal knowledge cutoffs.`);
                
                // Add game context
                promptParts.push(`\nGame: ${gameTitle} (${gameType})`);
                
                // PART 3: SQL Deep Search (User's Personal Knowledge Graph)
                // This searches across all processed YouTube videos for this game
                if (this.guideSearchService && playerQuestion && playerQuestion !== 'help' && playerQuestion.length > 3) {
                    try {
                        log(`🔍 Performing Deep Search for: "${playerQuestion}" in "${gameTitle}"`);
                        const deepSearchResults = await this.guideSearchService.search(playerQuestion, gameTitle);
                        
                        if (deepSearchResults.length > 0) {
                            promptParts.push(`\n📚 RELEVANT KNOWLEDGE FROM VIDEO LIBRARY:`);
                            promptParts.push(`The following information comes from transcripts of gaming guides you have added:`);
                            
                            deepSearchResults.forEach((result, idx) => {
                                // Truncate if excessively long, though search service already chunks it
                                const content = result.content.length > 1000 ? result.content.substring(0, 1000) + '...' : result.content;
                                promptParts.push(`${idx + 1}. [From guide: ${result.title}]: "${content}"`);
                            });
                            log(`   ✅ Added ${deepSearchResults.length} deep search results`);
                        }
                    } catch (searchError) {
                        console.error('❌ Deep search failed:', searchError.message);
                    }
                }
                
                // PART 3 & 4: Add Vertex AI game knowledge with strict RAG for new games
                try {
                    const vectorGameId = VertexVectorSearch.getVectorSearchGameId(gameTitle);
                    const isNewGame = this.isNewGame(gameTitle);
                    const requiresStrict = this.requiresStrictRAG(gameTitle);
                    
                    if (vectorGameId && playerQuestion && playerQuestion !== 'help') {
                        log(`🧠 Fetching game knowledge from Vertex AI (New game: ${isNewGame}, Strict RAG: ${requiresStrict})...`);
                        const gameKnowledge = await VertexVectorSearch.search(playerQuestion, gameTitle);
                        
                        // PART 4: RAG Quality Scoring
                        let ragQuality = 'none';
                        if (gameKnowledge.length >= 3) ragQuality = 'high';
                        else if (gameKnowledge.length >= 1) ragQuality = 'medium';
                        
                        log(`   📊 RAG Quality: ${ragQuality} (${gameKnowledge.length} entries)`);
                        
                        if (gameKnowledge.length > 0) {
                            // PART 3: For new games, add grounding instructions (POSITIVE framing to encourage usage)
                            if (requiresStrict) {
                                promptParts.push(`\n📚 GAME KNOWLEDGE FOR ${gameTitle}:`);
                                promptParts.push(`Use the following verified information to answer the user's question:`);
                            } else {
                                promptParts.push(`\n📚 RELEVANT GAME KNOWLEDGE:`);
                            }
                            
                            // Reduced from 5 to 3 entries and truncate each to prevent massive prompts/timeouts
                            gameKnowledge.slice(0, 3).forEach((k, idx) => {
                                // Truncate each entry to 300 chars max to keep prompt size manageable
                                const truncated = k.content.length > 300 ? 
                                    k.content.substring(0, 300) + '...' : 
                                    k.content;
                                promptParts.push(`${idx + 1}. ${truncated}`);
                            });
                            
                            if (requiresStrict) {
                                promptParts.push(`\nAnswer the user's question using the knowledge above. Be direct and helpful.`);
                            }
                            
                            log(`   ✅ Added ${gameKnowledge.length} game knowledge entries (Strict mode: ${requiresStrict})`);
                        }
                        
                        // PART 4: Handling New/Unreleased Games (Global Fallback Strategy)
                        if (isNewGame) {
                            promptParts.push(`\n🛡️ STRATEGY FOR NEW/UNRELEASED GAME (${gameTitle}):`);
                            promptParts.push(`1. PRIORITIZE TOOLS: Use provided Guide Snippets, Deep Search Results, and Vision Context as primary truth.`);
                            promptParts.push(`2. WEB SEARCH FALLBACK: If context is missing, use the Google Search tool to find current info.`);
                            promptParts.push(`3. EDUCATED GUESSES: If no data exists, you may infer mechanics from visual UI elements, but explicitly state: "Based on the UI..." or "It appears that..."`);
                            promptParts.push(`4. HONESTY: Only say "I don't know" if RAG, Search, and Vision all fail.`);
                        }
                    }
                } catch (error) {
                    console.error('❌ Error fetching game knowledge:', error.message);
                    // Continue with prompt building - don't let Vertex AI errors break the AI
                }
                
                // Add preloaded memory (from SQLite)
                if (preloadedMemory && preloadedMemory.length > 0) {
                    promptParts.push(`\n${preloadedMemory}`);
                }
                
                // Add conversation history (last 5 turns - sliding window)
                if (sessionMemory && sessionMemory.recentTurns.length > 0) {
                    promptParts.push(`\nRecent conversation:`);
                    sessionMemory.recentTurns.forEach(turn => {
                        promptParts.push(`User: ${turn.user}`);
                        promptParts.push(`You: ${turn.ai}`);
                    });
                }
                
                // Add current state
                if (sessionMemory && sessionMemory.state) {
                    const state = sessionMemory.state;
                    const stateInfo = [];
                    if (state.location) stateInfo.push(`Location: ${state.location}`);
                    if (state.objective) stateInfo.push(`Objective: ${state.objective}`);
                    if (stateInfo.length > 0) {
                        promptParts.push(`\nCurrent state:\n${stateInfo.join('\n')}`);
                    }
                }
                
                // Smart RAG inclusion (only if relevant)
                if (sessionMemory && sessionMemory.rag.active && ragRelevance > 0.5) {
                    const rag = sessionMemory.rag;
                    const urgency = ragRelevance > 0.8 ? 'PRIMARY' : 'SECONDARY';
                    
                    promptParts.push(`\n${urgency} CONTEXT - Active Guide: "${rag.guideTitle}"`);
                    promptParts.push(`Progress: Step ${rag.stepNumber + 1}/${rag.totalSteps}`);
                    
                    if (rag.currentStep) {
                        promptParts.push(`\nCurrent step:`);
                        promptParts.push(`${rag.currentStep.title}`);
                        promptParts.push(`${rag.currentStep.action}`);
                    }
                    
                    promptParts.push(`\n📚 REFERENCE GUIDE: "${rag.guideTitle}"`);
                    
                    if (rag.currentStep) {
                        promptParts.push(`Current Step Section: ${rag.currentStep.title}`);
                        promptParts.push(`Details: ${rag.currentStep.action}`);
                    }

                    promptParts.push(`\n⚡ CRITICAL INSTRUCTIONS:`);
                    promptParts.push(`1. VISION IS TRUTH: If the user's game state (visible in 'Current state') contradicts the guide (e.g. different character/nation), TRUST THE GAME STATE.`);
                    promptParts.push(`2. MECHANICS OVER SPECIFICS: Extract the *mechanics* from the guide (e.g. "manage economy"), but apply them to the user's ACTUAL situation.`);
                    promptParts.push(`3. NO RAILROADING: Do NOT tell the user to "Select [X]" if they have already selected [Y]. Adapt the advice.`);
                    promptParts.push(`4. DIRECT ANSWER: Answer the user's specific question first. Do not force "Step 1" if they are asking something else.`);
                }
                
                // Add current question
                promptParts.push(`\nPlayer question: "${playerQuestion}"`);
                promptParts.push(`Current situation: ${context}`);
                promptParts.push(`Response type: ${responseType}`);
                promptParts.push(`Urgency: ${urgencyPrefix}`);
                
                // Add response guidelines
                promptParts.push(`\nResponse guidelines:`);
                promptParts.push(`- Be concise (30-60 words max)`);
                promptParts.push(`- If user asks unrelated questions, answer directly WITHOUT forcing guide context`);
                promptParts.push(`- If user asks "what next", reference current guide step if active`);
                promptParts.push(`- Update objective naturally as user progresses`);
                
                return promptParts.join('\n');
            }
        } catch (error) {
            console.error('❌ [CRITICAL] Error building prompt:', error.message);
            console.error('❌ [CRITICAL] Stack:', error.stack);
            
            // Fallback to minimal prompt to prevent total failure
            const playerQuestion = fusedContext?.currentState?.audio?.transcript || 'help';
            return `You are a helpful gaming assistant. Answer this question briefly: "${playerQuestion}"`;
        }
    }
    
    getUrgencyPrefix(urgencyLevel) {
        switch(urgencyLevel) {
            case 5: return 'CRITICAL EMERGENCY';
            case 4: return 'URGENT';
            case 3: return 'Important';
            case 2: return 'Moderate';
            default: return 'Normal';
        }
    }
    
    checkCache(fusedContext, situationAnalysis) {
        const state = fusedContext.currentState;
        const vision = state.vision || {};
        
        // Check for exact cache matches for common urgent situations
        if (vision.health_percentage !== null && vision.health_percentage < 20 && vision.enemies_visible) {
            this.stats.cacheHits++;
            return this.responseCache.get('critical_health');
        }
        
        if (vision.health_percentage !== null && vision.health_percentage < 40 && vision.enemies_visible) {
            this.stats.cacheHits++;
            return this.responseCache.get('low_health_enemies');
        }
        
        if (vision.enemy_count >= 3) {
            this.stats.cacheHits++;
            return this.responseCache.get('many_enemies');
        }
        
        if (situationAnalysis.triggerReasons.includes('player_stuck')) {
            this.stats.cacheHits++;
            return this.responseCache.get('stuck_help');
        }
        
        if (!vision.urgent_situation && vision.enemy_threat_level === 'low') {
            this.stats.cacheHits++;
            return this.responseCache.get('safe_moment');
        }
        
        return null;
    }
    
    handleCachedResponse(cachedResponse, contextData, startTime) {
        const responseTime = Date.now() - startTime;
        
        // Add prefix for cached responses (consider them as base since they're pre-defined)
        const prefixedResponse = `[Base] ${cachedResponse}`;
        
        log(`⚡ Cache hit: "${prefixedResponse}" [${responseTime}ms]`);
        
        this.updateStats(responseTime, contextData.situationAnalysis, true);
        
        this.emitAIResponse({
            text: prefixedResponse,
            responseTime,
            fromCache: true,
            confidence: 0.95,
            urgencyLevel: contextData.situationAnalysis.urgencyLevel
        }, contextData);
    }
    
    handleAIResponse(responseData, contextData, startTime) {
        const responseTime = Date.now() - startTime;
        
        // Handle both old string format and new object format for backward compatibility
        const responseText = typeof responseData === 'string' ? responseData : responseData.text;
        const modelUsed = typeof responseData === 'string' ? 'Unknown' : responseData.modelUsed;
        
        // Add model prefix to the response text
        let prefixedText;
        if (modelUsed === 'Vertex AI Fine-Tuned') {
            prefixedText = `[Custom] ${responseText}`;
        } else if (modelUsed === 'Standard Gemini') {
            prefixedText = `[Base] ${responseText}`;
        } else {
            prefixedText = responseText; // No prefix for unknown/cached responses
        }
        
        log(`🤖 AI response: "${prefixedText}" [${responseTime}ms] (${modelUsed})`);
        
        // Basic response quality validation (use original text for assessment)
        const confidence = this.assessResponseConfidence(responseText, contextData);
        
        this.updateStats(responseTime, contextData.situationAnalysis, false);
        
        // 📝 Split long responses into multiple messages for better readability
        const wordCount = responseText.split(/\s+/).length;
        if (wordCount > 60) {
            log(`📝 Response too long (${wordCount} words) - splitting into multiple messages`);
            const messages = this.splitLongResponse(prefixedText); // Use prefixed text for splitting
            
            // Send each part as separate message
            messages.forEach((messagePart, index) => {
                setTimeout(() => {
                    this.emitAIResponse({
                        text: messagePart,
                        responseTime,
                        fromCache: false,
                        confidence,
                        urgencyLevel: contextData.situationAnalysis.urgencyLevel,
                        partNumber: index + 1,
                        totalParts: messages.length
                    }, contextData);
                }, index * 500); // 500ms delay between parts
            });
        } else {
            this.emitAIResponse({
                text: prefixedText, // Use prefixed text for user
                responseTime,
                fromCache: false,
                confidence,
                urgencyLevel: contextData.situationAnalysis.urgencyLevel
            }, contextData);
        }
    }
    
    splitLongResponse(text) {
        // Split at sentence boundaries (. ! ?)
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        const messages = [];
        let currentMessage = '';
        let wordCount = 0;
        
        for (const sentence of sentences) {
            const sentenceWords = sentence.trim().split(/\s+/).length;
            
            if (wordCount + sentenceWords <= 40 && currentMessage) {
                // Add to current message
                currentMessage += ' ' + sentence.trim();
                wordCount += sentenceWords;
            } else {
                // Start new message
                if (currentMessage) {
                    messages.push(currentMessage.trim());
                }
                currentMessage = sentence.trim();
                wordCount = sentenceWords;
            }
        }
        
        // Add remaining
        if (currentMessage) {
            messages.push(currentMessage.trim());
        }
        
        return messages.length > 0 ? messages : [text];
    }
    
    handleAIError(error, contextData, startTime) {
        const responseTime = Date.now() - startTime;
        
        console.error(`❌ AI response error [${responseTime}ms]:`, error.message);
        console.error(`   Context: "${contextData.fusedContext?.currentState?.audio?.transcript}"`);
        console.error(`   Model available:`, !!this.model);
        
        this.stats.errors++;
        if (error.message.includes('timeout')) {
            this.stats.timeouts++;
            console.error(`   ⏱️ Timeout count: ${this.stats.timeouts}`);
            console.error(`   ⚠️ AI timeout is NON-FATAL - transcription will continue for next question`);
        }
        
        // Emit error event but don't stop the session
        this.emit('ai-error', {
            sessionId: this.sessionId,
            error: error.message,
            context: contextData.fusedContext?.currentState?.audio?.transcript,
            timestamp: new Date()
        });
        
        // NO FALLBACK RESPONSES - Let the error surface properly
        console.error('❌ AI request failed - no fallback, user will see no response until next successful request');
        console.error('✅ Transcription layer continues running - ready for next question');
    }
    
    assessResponseConfidence(responseText, contextData) {
        let confidence = 0.7; // Base confidence
        
        // Length check (30-60 words ≈ 200-400 chars)
        if (responseText.length <= 200) confidence += 0.1;  // Concise
        if (responseText.length > 400) confidence -= 0.2;  // Too long
        
        // Actionability check (contains action words)
        const actionWords = ['go', 'use', 'attack', 'heal', 'dodge', 'run', 'check', 'find', 'take'];
        if (actionWords.some(word => responseText.toLowerCase().includes(word))) {
            confidence += 0.1;
        }
        
        // Urgency matching
        const urgency = contextData.situationAnalysis.urgencyLevel;
        const hasUrgentWords = responseText.toLowerCase().includes('now') || 
                              responseText.includes('!') ||
                              responseText.toLowerCase().includes('immediately');
        
        if (urgency >= 4 && hasUrgentWords) confidence += 0.1;
        if (urgency <= 2 && !hasUrgentWords) confidence += 0.05;
        
        return Math.min(1.0, Math.max(0.1, confidence));
    }
    
    truncateResponse(text) {
        // Intelligent truncation to keep most important part (up to 60 words)
        const sentences = text.split(/[.!?]/);
        
        // Try to keep first 1-2 complete sentences
        let result = '';
        let wordCount = 0;
        
        for (const sentence of sentences) {
            const words = sentence.trim().split(' ');
            if (wordCount + words.length <= 60) {
                result += sentence.trim() + '. ';
                wordCount += words.length;
            } else {
                break;
            }
        }
        
        if (result.length > 0) {
            return result.trim();
        }
        
        // Fallback: take first 60 words
        const words = text.split(' ');
        return words.slice(0, 60).join(' ') + '...';
    }
    
    updateStats(responseTime, situationAnalysis, fromCache) {
        if (!fromCache) {
            this.stats.responsesGenerated++;
            this.stats.totalResponseTime += responseTime;
            this.stats.avgResponseTime = this.stats.totalResponseTime / this.stats.responsesGenerated;
        }
        
        if (situationAnalysis.urgencyLevel >= 4) {
            this.stats.urgentResponses++;
        }
        
        // Log performance every 20 responses
        if ((this.stats.responsesGenerated + this.stats.cacheHits) % 20 === 0) {
            log(`📊 AI responses: ${this.stats.responsesGenerated} generated, ${this.stats.cacheHits} cached, avg ${Math.round(this.stats.avgResponseTime)}ms`);
        }
    }
    
    emitAIResponse(response, contextData) {
        this.emit('ai-response-generated', {
            sessionId: this.sessionId,
            response,
            context: contextData.fusedContext,
            situationAnalysis: contextData.situationAnalysis,
            timestamp: new Date()
        });
        
        // Emit urgent responses separately for immediate processing
        if (response.urgencyLevel >= 4) {
            this.emit('urgent-ai-response', {
                sessionId: this.sessionId,
                response,
                urgencyLevel: response.urgencyLevel
            });
        }
    }
    
    async stop() {
        if (!this.isActive) {
            console.warn('⚠️ AI Decision Engine not active');
            return;
        }
        
        log('🛑 Stopping AI Decision Engine');
        this.isActive = false;
        
        // Cancel active requests
        for (const [requestId, request] of this.activeRequests) {
            log(`🚫 Canceling AI request: ${requestId}`);
        }
        this.activeRequests.clear();
        this.activeSessionRequests.clear();
        this.sessionRequestQueues.clear();
        log('🔓 [RACE PREVENTION] All session request locks and queues cleared');
        
        this.emit('ai-engine-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        // Clean up temporary credentials file
        if (this.credentialsPath && fs.existsSync(this.credentialsPath)) {
            try {
                fs.unlinkSync(this.credentialsPath);
                log('🧹 Cleaned up temporary credentials file');
            } catch (error) {
                console.warn('⚠️ Failed to cleanup credentials file:', error.message);
            }
        }
        
        // Clear state
        this.sessionId = null;
        this.gameContext = {};
    }
    
    addToCache(situationKey, response) {
        if (this.responseCache.size >= 100) { // Prevent cache from growing too large
            const firstKey = this.responseCache.keys().next().value;
            this.responseCache.delete(firstKey);
        }
        
        this.responseCache.set(situationKey, response);
        log(`💾 Added to AI cache: ${situationKey} -> ${response}`);
    }
    
    createQueryHash(queryText, fusedContext) {
        try {
            // Create a hash for deduplication based on:
            // 1. Cleaned query text (normalized)
            // 2. Current game context
            // 3. Guide context if available (SAFELY)
            
            const cleanQuery = queryText.toLowerCase()
                .replace(/[^\w\s]/g, ' ') // Remove punctuation
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
            
            // 🛡️ SAFE ACCESS to potentially undefined objects
            const gameTitle = fusedContext?.game?.title || 'no_game';
            const guideTitle = fusedContext?.guideContext?.title || 'no_guide';
            const currentStep = fusedContext?.guideContext?.currentStep?.step_number || 'no_step';
            
            // Create simple hash combining key elements
            const hashInput = `${cleanQuery}_${gameTitle}_${guideTitle}_${currentStep}`;
            
            // Simple hash function (good enough for deduplication)
            let hash = 0;
            for (let i = 0; i < hashInput.length; i++) {
                const char = hashInput.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            
            return Math.abs(hash).toString(36);
        } catch (error) {
            console.error('❌ [CRITICAL] Error creating query hash:', error.message);
            // Fallback to simple timestamp-based hash
            return Date.now().toString(36);
        }
    }
    
    getStats() {
        return {
            ...this.stats,
            isActive: this.isActive,
            sessionId: this.sessionId,
            activeRequests: this.activeRequests.size,
            activeSessionLocks: this.activeSessionRequests.size,
            queuedRequests: Array.from(this.sessionRequestQueues.values()).reduce((sum, q) => sum + q.length, 0),
            cacheSize: this.responseCache.size,
            config: this.config
        };
    }
    
    getCurrentRequests() {
        return Array.from(this.activeRequests.entries()).map(([id, req]) => ({
            id,
            age: Date.now() - req.startTime,
            urgency: req.urgency
        }));
    }
    
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        log('🔧 AI engine config updated:', newConfig);
        
        // Update model if changed
        if (newConfig.model && newConfig.model !== this.model._modelName) {
            this.model = this.genAI.getGenerativeModel({ model: newConfig.model });
            log('🤖 AI model updated:', newConfig.model);
        }
    }
}

module.exports = AIDecisionEngineLayer;
