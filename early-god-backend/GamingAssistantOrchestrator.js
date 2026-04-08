// Main Orchestrator - Coordinates all 7 layers for Cluely-style low-latency gaming assistance
const EventEmitter = require('events');

// Import all layers
const CaptureLayer = require('./layers/CaptureLayer');
const TranscriptionLayer = require('./layers/TranscriptionLayer');
const VisionAnalysisLayer = require('./layers/VisionAnalysisLayer');
const ContextFusionLayer = require('./layers/ContextFusionLayer');
const AIDecisionEngineLayer = require('./layers/AIDecisionEngineLayer');

// Import memory system
const EventDetector = require('./services/EventDetector');
const MemoryManager = require('./services/MemoryManager');
const MemoryPreloader = require('./services/MemoryPreloader');
// Make OutputGenerationLayer optional to avoid deployment issues
let OutputGenerationLayer;
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
try {
    OutputGenerationLayer = require('./layers/OutputGenerationLayer');
} catch (error) {
    console.warn('⚠️ OutputGenerationLayer failed to load, using fallback:', error.message);
    // Simple fallback class
    OutputGenerationLayer = class FallbackOutputLayer extends require('events') {
        constructor() { super(); }
        async start() { log('🔄 Using fallback TTS'); }
        async stop() {}
        getStats() { return { fallback: true }; }
        processAIResponse() { this.emit('audio-generated', { fallback: true }); }
    };
}
const UIDisplayLayer = require('./layers/UIDisplayLayer');

class GamingAssistantOrchestrator extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            sessionTimeoutMs: options.sessionTimeoutMs || 1800000, // 30 minutes
            performanceLogging: options.performanceLogging !== false,
            logInterval: options.logInterval || 30000, // 30 seconds
            maxConcurrentSessions: options.maxConcurrentSessions || 5,
            enableMetrics: options.enableMetrics !== false
        };
        
        // Initialize all layers (create fresh instances each time)
        this.layers = {
            capture: new CaptureLayer(options.capture),
            transcription: new TranscriptionLayer(options.transcription),
            vision: new VisionAnalysisLayer(options.vision),
            context: new ContextFusionLayer(options.context),
            ai: new AIDecisionEngineLayer(options.ai),
            output: new OutputGenerationLayer(options.output),
            display: new UIDisplayLayer(options.display)
        };
        
        // Session management
        this.activeSessions = new Map();
        this.sessionStats = new Map();
        
        // 🔧 Track if layers are in use to prevent reuse across sessions
        this.layersInUse = false;
        
        // Memory system
        this.eventDetector = new EventDetector();
        this.memoryManager = new MemoryManager();
        this.memoryPreloader = new MemoryPreloader(this.memoryManager);
        
        // Performance tracking
        this.orchestratorStats = {
            sessionsStarted: 0,
            sessionsEnded: 0,
            totalPipelineLatency: 0,
            avgPipelineLatency: 0,
            urgentSituationsHandled: 0,
            errors: 0
        };
        
        // Setup layer event handlers
        this.setupLayerEventHandlers();
        
        // Performance logging timer
        if (this.config.performanceLogging) {
            this.performanceTimer = setInterval(() => {
                this.logPerformanceMetrics();
            }, this.config.logInterval);
        }
        
        log('🎮 GamingAssistantOrchestrator initialized');
        log('   📊 Layers active:', Object.keys(this.layers).length);
        log('   ⏱️ Performance logging:', this.config.performanceLogging);
        log('   👥 Max concurrent sessions:', this.config.maxConcurrentSessions);
    }
    
    setupLayerEventHandlers() {
        // Layer 1: Capture -> Layer 3: Vision Analysis
        this.layers.capture.on('frame-captured', (frameData) => {
            this.handleFrameCapture(frameData);
        });
        
        // Layer 2: Transcription -> Layer 4: Context Fusion
        this.layers.transcription.on('transcription-result', async (transcriptData) => {
            try {
                await this.handleTranscriptionResult(transcriptData);
            } catch (error) {
                console.error('❌ Error handling transcription result:', error.message);
                console.error('   📋 Transcript:', transcriptData.transcript);
                console.error('   🆔 Session:', transcriptData.sessionId);
            }
        });
        
        // VAD Event Handlers: Track speech start/end for proper state management
        this.layers.transcription.on('utterance-end', (data) => {
            this.handleUtteranceEnd(data);
        });
        
        this.layers.transcription.on('speech-started', (data) => {
            this.handleSpeechStarted(data);
        });
        
        // Layer 3: Vision Analysis -> Layer 4: Context Fusion
        this.layers.vision.on('analysis-result', (analysisData) => {
            this.handleVisionAnalysis(analysisData);
        });
        
        this.layers.vision.on('urgent-situation', (urgentData) => {
            this.handleUrgentSituation(urgentData);
        });
        
        // NEW: Handle vision analysis results for screen capture questions
        this.layers.vision.on('vision-analysis-complete', (visionData) => {
            this.handleVisionAnalysisComplete(visionData);
        });
        
        // ======================================================================
        // UNIFIED GEMINI AI ARCHITECTURE
        // ======================================================================
        // The Vision Layer no longer processes screenshots with GPT-4o.
        // Instead, it forwards screenshots to the unified Gemini AI in the
        // AI Decision Engine Layer, which handles BOTH text-only and vision questions.
        // ======================================================================
        this.layers.vision.on('forward-to-gemini', (data) => {
            this.handleScreenshotForGemini(data);
        });
        
        // Layer 4: Context Fusion -> Layer 5: AI Decision Engine
        this.layers.context.on('context-fused', (contextData) => {
            this.handleContextFusion(contextData);
        });
        
        this.layers.context.on('ai-response-needed', (aiRequestData) => {
            this.handleAIRequest(aiRequestData);
        });
        
        // Layer 5: AI Decision Engine -> Layer 6: Output Generation
        this.layers.ai.on('ai-response-generated', (aiResponseData) => {
            this.handleAIResponse(aiResponseData);
        });
        
        this.layers.ai.on('urgent-ai-response', (urgentAI) => {
            this.handleUrgentAIResponse(urgentAI);
        });
        
        // AI Error Handler: Ensure AI errors don't stop transcription
        this.layers.ai.on('ai-error', (errorData) => {
            log('⚠️ [ORCHESTRATOR] AI error received - transcription continues:', {
                sessionId: errorData.sessionId,
                error: errorData.error,
                context: errorData.context?.substring(0, 50)
            });
            // Don't stop session - just log and continue
            // Transcription layer keeps running for next question
        });
        
        // Layer 6: Output Generation -> Layer 7: UI Display
        this.layers.output.on('audio-generated', (audioData) => {
            this.handleAudioGenerated(audioData);
        });
        
        this.layers.output.on('urgent-audio', (urgentAudio) => {
            this.handleUrgentAudio(urgentAudio);
        });
        
        // Error handling for all layers
        this.setupErrorHandlers();
    }
    
    setupErrorHandlers() {
        Object.entries(this.layers).forEach(([layerName, layer]) => {
            layer.on('error', (error) => {
                this.handleLayerError(layerName, error);
            });
        });
    }
    
    isSessionActive(sessionId) {
        return this.activeSessions.has(sessionId);
    }
    
    async detectVisionIntent(transcript) {
        try {
            // Quick keyword check first (0ms) - for obvious cases
            const text = transcript.toLowerCase();
            
            // 🎯 PRIORITY 1: Guide questions (NEVER need vision)
            const guideKeywords = [
                'step',
                'guide',
                'what should i do',
                'where should i go',
                'what do i do',
                'where do i go',
                'what next',
                'help me with'
            ];
            
            if (guideKeywords.some(keyword => text.includes(keyword))) {
                log('🎯 Fast path: Guide question detected (text-only)');
                return false;  // NEVER vision for guide questions
            }
            
            // 🎯 PRIORITY 2: Obvious vision keywords (expanded for common phrases)
            const obviousVisionKeywords = [
                'can you see',
                'do you see',
                'what do you see',
                'look at this',
                'look at my',
                'describe what you see',
                'what am i looking at',
                'see my screen',
                'see what',
                'thing in front',
                'what\'s in front',
                'what is in front',
                'that thing',
                'what\'s that',
                'what is that'
            ];
            
            if (obviousVisionKeywords.some(keyword => text.includes(keyword))) {
                log('🎯 Fast path: Obvious vision question detected');
                return true;
            }
            
            // 🎯 PRIORITY 3: Other action keywords (text-only)
            const obviousActionKeywords = [
                'how do i',
                'what\'s the best way',
                'tell me about',
                'explain'
            ];
            
            if (obviousActionKeywords.some(keyword => text.includes(keyword))) {
                log('🎯 Fast path: Obvious action question detected');
                return false;
            }
            
            // 🚀 DEFAULT TO TEXT-ONLY for ambiguous cases (no Gemini classification)
            // Gemini classification adds 200-500ms latency and causes Deepgram sync issues
            // Better to default to text-only (fast) than wait for classification (slow)
            log('🎯 Ambiguous question - defaulting to text-only (fast path)');
            return false;
            
        } catch (error) {
            console.error('❌ Intent classification error, defaulting to text-only:', error.message);
            return false;
        }
    }
    
    async startSession(sessionId, gameContext = {}, clientConnection = null) {
        // 🧹 CRITICAL FIX: Only support ONE session at a time
        // If this exact session already exists, don't stop and restart it (prevents transcription interruption)
        if (this.activeSessions.has(sessionId)) {
            log(`♻️ [RECONNECT] Session ${sessionId} already active - reusing existing session`);
            log('   ⚠️ This prevents transcription from being stopped on client reconnect/error recovery');
            
            // Update client connection if provided (WebSocket reconnect scenario)
            if (clientConnection) {
                const session = this.activeSessions.get(sessionId);
                session.clientConnection = clientConnection;
                session.clientConnectionTimestamp = Date.now();
                this.layers.display.connectClient(clientConnection);
                log('   🔄 Client connection updated for existing session');
            }
            
            return true; // Session already active, don't recreate
        }
        
        // Clean up OTHER sessions (different sessionIds)
        if (this.activeSessions.size > 0) {
            log(`🧹 [CLEANUP] Found ${this.activeSessions.size} other sessions - cleaning up`);
            const oldSessions = Array.from(this.activeSessions.keys());
            for (const oldSessionId of oldSessions) {
                log(`🧟‍♂️ Stopping different session: ${oldSessionId}`);
                await this.stopSession(oldSessionId);
            }
            log(`✅ [CLEANUP] Old sessions stopped - ready for new session`);
        }
        
        if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
            console.error(`❌ Maximum concurrent sessions reached: ${this.config.maxConcurrentSessions}`);
            console.error(`🧟‍♂️ [CRITICAL] ZOMBIE SESSIONS DETECTED - Force cleaning up stuck sessions`);
            console.error(`📊 Sessions started: ${this.orchestratorStats.sessionsStarted}, ended: ${this.orchestratorStats.sessionsEnded}`);
            
            // 🧟‍♂️ EMERGENCY CLEANUP: Force stop all sessions to clear zombies
            log('🧹 [EMERGENCY] Performing zombie session cleanup...');
            const sessionIds = Array.from(this.activeSessions.keys());
            for (const sessionId of sessionIds) {
                log(`🧟‍♂️ Force stopping zombie session: ${sessionId}`);
                try {
                    await this.stopSession(sessionId);
                } catch (error) {
                    console.error(`❌ Error stopping zombie session ${sessionId}:`, error.message);
                    // Force remove from map even if stopping fails
                    this.activeSessions.delete(sessionId);
                    this.sessionStats.delete(sessionId);
                }
            }
            
            log(`🧹 [EMERGENCY] Zombie cleanup complete - active sessions: ${this.activeSessions.size}`);
            
            // Now try to start the new session
            if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
                console.error(`❌ Still at capacity after cleanup - something is very wrong`);
                return false;
            }
        }
        
        const sessionStart = Date.now();
        
        try {
            log(`🚀 Starting gaming session: ${sessionId}`);
            log(`   🎮 Game: ${gameContext.gameTitle || 'Unknown'}`);
            log(`   📊 Active sessions: ${this.activeSessions.size + 1}/${this.config.maxConcurrentSessions}`);
            
            // Create session record
            const session = {
                id: sessionId,
                gameContext,
                startTime: sessionStart,
                clientConnection,
                lastProcessedTranscript: '',
                lastProcessedTime: Date.now(), // Initialize to now, not 0
                lastSpeechStartTime: null, // Track VAD speech detection timing
                stats: {
                    framesProcessed: 0,
                    transcriptsProcessed: 0,
                    aiResponsesGenerated: 0,
                    urgentSituations: 0,
                    totalLatency: 0,
                    avgLatency: 0
                }
            };
            
            this.activeSessions.set(sessionId, session);
            this.sessionStats.set(sessionId, session.stats);
            
            log(`🔍 [DEBUG] Session stored with ID: "${sessionId}"`);
            log(`🔍 [DEBUG] activeSessions.size after set: ${this.activeSessions.size}`);
            log(`🔍 [DEBUG] Can retrieve session: ${!!this.activeSessions.get(sessionId)}`);
            
            // Start all layers for this session (with graceful capture layer handling)
            const layerStartPromises = [
                this.layers.transcription.startTranscription(sessionId),
                this.layers.vision.startAnalysis(sessionId, gameContext),
                this.layers.context.start(sessionId, gameContext),
                this.layers.ai.start(sessionId, gameContext),
                this.layers.output.start(sessionId),
                this.layers.display.start(sessionId)
            ];
            
            // Try to start capture layer, but don't fail if it's not available (headless server)
            try {
                const captureResult = await this.layers.capture.startCapture(sessionId, gameContext.gameProcess);
                if (captureResult !== false) {
                    log('✅ Screen capture layer started');
                } else {
                    log('⚠️ Screen capture not available (headless server mode)');
                }
            } catch (captureError) {
                console.warn('⚠️ Screen capture layer failed to start:', captureError.message);
                log('📱 Client-side screen capture should be used instead');
            }
            
            try {
                await Promise.all(layerStartPromises);
                log(`🔍 [DEBUG] All layers started successfully for session: ${sessionId}`);
            } catch (layerError) {
                console.error(`❌ [DEBUG] Layer initialization failed for session ${sessionId}:`, layerError.message);
                console.error(`🔍 [DEBUG] Session still exists: ${!!this.activeSessions.get(sessionId)}`);
                throw layerError; // Re-throw to handle in outer catch
            }
            
            // Connect client to display layer if provided
            if (clientConnection) {
                this.layers.display.connectClient(clientConnection);
            }
            
            // Set session timeout
            const timeoutHandle = setTimeout(() => {
                log(`⏰ Session ${sessionId} timed out, stopping...`);
                this.stopSession(sessionId);
            }, this.config.sessionTimeoutMs);
            
            session.timeoutHandle = timeoutHandle;
            
            this.orchestratorStats.sessionsStarted++;
            
            // Preload memory — await so first AI response has context
            try {
                await this.preloadMemory(sessionId, gameContext.gameTitle);
            } catch (err) {
                console.error('Memory preload failed (non-fatal):', err);
            }
            
            log(`✅ Gaming session ${sessionId} started successfully [${Date.now() - sessionStart}ms]`);
            
            this.emit('session-started', {
                sessionId,
                gameContext,
                startTime: sessionStart
            });
            
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to start session ${sessionId}:`, error.message);
            
            // Cleanup partial session
            if (this.activeSessions.has(sessionId)) {
                await this.stopSession(sessionId);
            }
            
            this.orchestratorStats.errors++;
            return false;
        }
    }
    
    async stopSession(sessionId) {
        log('🛑 Stopping gaming session...');
        console.trace('📍 stopGamingSession called from:');
        
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            console.warn(`⚠️ Session ${sessionId} not found`);
            return false;
        }
        
        const stopStart = Date.now();
        
        try {
            // Log WHO is calling stopSession
            const stack = new Error().stack;
            log(`🛑 Stopping gaming session: ${sessionId}`);
            log(`📍 Called from:`, stack.split('\n')[2].trim());
            
            // Clear session timeout
            if (session.timeoutHandle) {
                clearTimeout(session.timeoutHandle);
            }
            
            // Stop all layers for this session (gracefully handle capture layer)
            const layerStopPromises = [
                this.layers.transcription.stopTranscription(),
                this.layers.vision.stopAnalysis(),
                this.layers.context.stop(),
                this.layers.ai.stop(),
                this.layers.output.stop(),
                this.layers.display.stop()
            ];
            
            // Try to stop capture layer gracefully
            try {
                await this.layers.capture.stopCapture();
            } catch (captureError) {
                console.warn('⚠️ Error stopping capture layer:', captureError.message);
            }
            
            await Promise.all(layerStopPromises);
            
            // Calculate session metrics
            const sessionDuration = stopStart - session.startTime;
            const stats = session.stats;
            
            log(`📊 Session ${sessionId} stats:`);
            log(`   ⏱️ Duration: ${Math.round(sessionDuration / 1000)}s`);
            log(`   🖼️ Frames: ${stats.framesProcessed}`);
            log(`   🎤 Transcripts: ${stats.transcriptsProcessed}`);
            log(`   🤖 AI responses: ${stats.aiResponsesGenerated}`);
            log(`   🚨 Urgent situations: ${stats.urgentSituations}`);
            log(`   📈 Avg latency: ${stats.avgLatency.toFixed(0)}ms`);
            
            // Remove session
            this.activeSessions.delete(sessionId);
            this.sessionStats.delete(sessionId);
            
            this.orchestratorStats.sessionsEnded++;
            
            log(`✅ Session ${sessionId} stopped [${Date.now() - stopStart}ms]`);
            
            this.emit('session-stopped', {
                sessionId,
                duration: sessionDuration,
                stats
            });
            
            return true;
            
        } catch (error) {
            console.error(`❌ Error stopping session ${sessionId}:`, error.message);
            
            // Force cleanup
            this.activeSessions.delete(sessionId);
            this.sessionStats.delete(sessionId);
            
            this.orchestratorStats.errors++;
            return false;
        }
    }
    
    // Event handlers for layer interactions
    handleFrameCapture(frameData) {
        const session = this.activeSessions.get(frameData.sessionId);
        if (!session) return;
        
        session.stats.framesProcessed++;
        
        // Pass frame to vision analysis layer
        this.layers.vision.processFrame(frameData);
    }
    
    handleUtteranceEnd(data) {
        const session = this.activeSessions.get(data.sessionId);
        if (!session) {
            console.warn('⚠️ UtteranceEnd for unknown session:', data.sessionId);
            return;
        }
        
        log('🔚 [VAD] UtteranceEnd - Speech finished, resetting state:', {
            sessionId: data.sessionId,
            lastWordEnd: data.lastWordEnd,
            currentTranscript: session.lastProcessedTranscript?.substring(0, 30)
        });
        
        // Reset transcript state to allow next question
        // This prevents getting stuck after multiple turns
        session.lastProcessedTranscript = '';
        session.lastProcessedTime = Date.now(); // Reset to current time, not 0 (prevents time calc bugs)
        
        log('✅ [VAD] State reset complete - ready for next utterance');
    }
    
    handleSpeechStarted(data) {
        const session = this.activeSessions.get(data.sessionId);
        if (!session) {
            console.warn('⚠️ SpeechStarted for unknown session:', data.sessionId);
            return;
        }
        
        log('🎤 [VAD] SpeechStarted - User began speaking:', {
            sessionId: data.sessionId,
            speechTimestamp: data.speechTimestamp,
            timeSinceLastUtterance: session.lastProcessedTime ? 
                Date.now() - session.lastProcessedTime : 'N/A'
        });
        
        // Mark that new speech has started
        // Could be used for UI feedback or interruption handling
        session.lastSpeechStartTime = Date.now();

        // 📸 JUST-IN-TIME CAPTURE: Request screenshot immediately when speech starts
        if (session.clientConnection && session.clientConnection.readyState === 1) {
            log('📸 [VAD] SpeechStarted - Triggering proactive screenshot capture');
            session.clientConnection.send(JSON.stringify({
                type: 'capture_snapshot',
                timestamp: new Date().toISOString()
            }));
        }
    }
    
    async handleTranscriptionResult(transcriptData) {
        const requestId = transcriptData.requestId || 'unknown';
        const latency = transcriptData.latencyFromSpeech;
        
        log(`🎤 [${requestId}] ORCHESTRATOR received transcript:`, {
            sessionId: transcriptData.sessionId,
            transcript: transcriptData.transcript?.substring(0, 30),
            isFinal: transcriptData.isFinal,
            latency: latency ? `${latency}ms` : 'N/A',
            hasSession: this.activeSessions.has(transcriptData.sessionId)
        });
        
        const session = this.activeSessions.get(transcriptData.sessionId);
        if (!session) {
            console.error('❌ [ORCHESTRATOR] No session found for transcription:', transcriptData.sessionId);
            return;
        }
        
        session.stats.transcriptsProcessed++;
        
        // ✅ ALWAYS send transcription to client (even if empty - frontend will display it)
        if (session.clientConnection && session.clientConnection.readyState === 1) {
            log('📤 [ORCHESTRATOR] Sending transcription to client:', {
                text: transcriptData.transcript?.substring(0, 50),
                isFinal: transcriptData.isFinal,
                sessionId: transcriptData.sessionId,
                connectionAge: Date.now() - (session.clientConnectionTimestamp || 0),
                hasConnection: true
            });
            try {
                session.clientConnection.send(JSON.stringify({
                    type: 'transcription',
                    text: transcriptData.transcript,
                    confidence: transcriptData.confidence,
                    intent: transcriptData.intentClassification,
                    isFinal: transcriptData.isFinal,
                    timestamp: transcriptData.timestamp
                }));
                log('✅ [ORCHESTRATOR] Transcription sent successfully');
            } catch (error) {
                console.error('❌ [ORCHESTRATOR] Failed to send transcription:', error.message);
                console.error('   🔍 Connection readyState:', session.clientConnection.readyState);
                console.error('   🔍 Error stack:', error.stack);
                // Clear dead connection and try to reconnect on next message
                session.clientConnection = null;
            }
        } else {
            console.error('❌ [ORCHESTRATOR] Cannot send transcription - connection issue:', {
                hasConnection: !!session.clientConnection,
                readyState: session.clientConnection?.readyState,
                readyStateDesc: session.clientConnection ? 
                    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][session.clientConnection.readyState] : 
                    'NO_CONNECTION',
                sessionId: transcriptData.sessionId,
                sessionExists: !!session,
                connectionAge: session.clientConnectionTimestamp ? Date.now() - session.clientConnectionTimestamp : 'N/A'
            });
        }
        
        // ========================================
        // 🎯 VAD-BASED AI PROCESSING: Only process FINAL transcripts
        // ========================================
        // With Deepgram's endpointing=300ms + utterance_end_ms=1000:
        // - Interims: Sent to UI for real-time feedback (above)
        // - Finals: Sent to AI for processing (below)
        //
        // This prevents:
        // ✅ Multiple AI requests for same question (e.g., "Who are" then "Who are the nine tailed")
        // ✅ Wasted API calls on incomplete sentences
        // ✅ Duplicate detection complexity
        //
        // VAD Flow:
        // 1. User speaks → Multiple interims → UI shows real-time feedback
        // 2. User pauses 300ms → Deepgram sends final (endpointing triggered)
        // 3. Final processed by AI (this section)
        // 4. UtteranceEnd fires after 1000ms (confirms speech done)
        // ========================================
        if (!transcriptData.isFinal) {
            log('⏭️ Interim transcript sent to UI - waiting for final to process AI');
            return;
        }
        
        log('✅ Final transcript - proceeding to AI processing');
        
        // NEW: Detect and store events from transcript
        if (transcriptData.transcript && transcriptData.transcript.trim().length > 0) {
            try {
                const events = await this.eventDetector.detectEvents(
                    transcriptData.transcript,
                    session.gameContext.gameTitle
                );
                
                if (events.length > 0) {
                    await this.memoryManager.storeEvents(events, session.gameContext.gameTitle);
                    log(`💾 Stored ${events.length} events:`, events.map(e => e.category));
                }
            } catch (error) {
                console.error('❌ Event detection failed:', error);
            }
        }
        
        // Check for SpeechStarted timing issues (VAD detection delay diagnostic)
        if (session.lastSpeechStartTime) {
            const speechDetectionDelay = Date.now() - session.lastSpeechStartTime;
            log(`⏱️ [VAD TIMING] SpeechStarted was ${speechDetectionDelay}ms ago`);
            
            if (speechDetectionDelay > 2000) {
                console.warn(`⚠️ [VAD DELAY] SpeechStarted detected ${speechDetectionDelay}ms ago - VAD may be slow`);
                console.warn('   This indicates Deepgram VAD is detecting speech with significant delay');
            } else if (speechDetectionDelay < 100) {
                log('✅ [VAD TIMING] Good - speech detected quickly');
            }
        } else {
            console.warn('⚠️ [VAD TIMING] No SpeechStarted event received before final transcript');
            console.warn('   This could indicate VAD events are not firing or being missed');
        }
        
        // Reset session timeout on activity (prevents premature timeout during active use)
        if (session.timeoutHandle) {
            clearTimeout(session.timeoutHandle);
            session.timeoutHandle = setTimeout(() => {
                log(`⏰ Session ${session.sessionId} timed out after inactivity, stopping...`);
                this.stopSession(session.sessionId);
            }, this.config.sessionTimeoutMs);
            log('🔄 Session timeout reset - 30 minutes from now');
        }
        
        // Filter empty transcripts
        if (!transcriptData.transcript || typeof transcriptData.transcript !== 'string' || transcriptData.transcript.trim().length === 0) {
            log('⏭️ Skipping empty final transcript');
            return;
        }

        // ========================================
        // 🛡️ DEDUPLICATION: Prevent processing same question twice
        // ========================================
        // ⚠️ CRITICAL: Keep this simple - only check EXACT duplicates within 2s
        //
        // PROVEN WORKING CONFIG:
        // - Exact text match only (don't use similarity/fuzzy matching)
        // - 2 second window (don't increase to 5s, 8s, etc.)
        //
        // REGRESSIONS TO AVOID:
        // ❌ Don't use: similarity scoring (too slow, over-filters)
        // ❌ Don't increase window beyond 2s (blocks legitimate follow-ups)
        // ❌ Don't add: multiple deduplication layers (TranscriptionLayer already has one)
        //
        // WHY 2s: User might ask same question again if no response
        //         Longer windows prevent legitimate retries
        //         Shorter windows allow too many duplicates
        // ========================================
        const timeSinceLastProcessed = Date.now() - session.lastProcessedTime;
        const isDuplicate = session.lastProcessedTranscript === transcriptData.transcript &&
                           timeSinceLastProcessed < 2000;
        
        if (isDuplicate) {
            log('⏭️ [DEDUP] Skipping duplicate transcript:', {
                transcript: transcriptData.transcript,
                timeSinceLastProcessed: `${timeSinceLastProcessed}ms`,
                lastProcessedTranscript: session.lastProcessedTranscript,
                reason: 'Exact match within 2s window'
            });
            return;
        }
        
        log('✅ [DEDUP] Transcript passed duplicate check:', {
            transcript: transcriptData.transcript?.substring(0, 30),
            timeSinceLastProcessed: `${timeSinceLastProcessed}ms`,
            isNewQuestion: session.lastProcessedTranscript !== transcriptData.transcript
        });
        
        // Update tracking for next check
        session.lastProcessedTranscript = transcriptData.transcript;
        session.lastProcessedTime = Date.now();
        
        // ✅ FIX: Track pipeline start time for accurate latency measurement
        transcriptData.pipelineStartTime = Date.now();
        
        // ========================================
        // 📸 ALWAYS-ON VISION: Just-in-Time Capture
        // ========================================
        // We no longer ask "Can you see?". We ALWAYS assume vision is relevant if available.
        // The screenshot was requested at 'SpeechStarted' and should be ready now.
        
        log('🔍 Checking for Just-in-Time screenshot...');
        
        if (session.pendingScreenshot) {
            log('✅ Found pending screenshot! Attaching to AI request.');
            
            // Use the pending screenshot immediately
            const screenshot = session.pendingScreenshot;
            session.pendingScreenshot = null; // Clear buffer
            
            // Forward to Gemini via Vision/Unified path
            this.handleScreenshotForGemini({
                sessionId: transcriptData.sessionId,
                screenshot: {
                    ...screenshot,
                    question: transcriptData.transcript, // Attach question
                    timestamp: new Date().toISOString()
                }
            });
            return;
        }
        
        // FALLBACK: If no screenshot arrived yet (network slow?), force a capture now.
        // This maintains the legacy behavior but ensures vision is always attempted.
        if (session.clientConnection && session.clientConnection.readyState === 1) {
             log('⚠️ No pending screenshot found - forcing late capture (Fallback)');
             // We use 'use_cached_screenshot' type which frontend handles by sending 'screen_frame'
             // with the question attached.
             session.clientConnection.send(JSON.stringify({
                type: 'use_cached_screenshot', 
                question: transcriptData.transcript,
                timestamp: new Date().toISOString()
            }));
            return; // Wait for frame callback
        }

        // Text-only fallback if connection dead
        log('🤖 No connection for vision - running text-only AI pipeline');
        this.layers.context.processAudioData(transcriptData);
        
        // Log significant transcriptions
        if (transcriptData.confidence > 0.8 && transcriptData.transcript.length > 5) {
            log(`📝 [${transcriptData.sessionId}] "${transcriptData.transcript}" (${transcriptData.intentClassification})`);
        }
    }
    
    handleVisionAnalysis(analysisData) {
        const session = this.activeSessions.get(analysisData.sessionId);
        if (!session) return;
        
        // Pass analysis to context fusion layer
        this.layers.context.processVisionData(analysisData);
        
        // Also send game state directly to display layer
        this.layers.display.processGameState(analysisData);
        
        // Log interesting vision events
        const analysis = analysisData.analysis;
        if (analysis.health_percentage !== null && analysis.health_percentage < 30) {
            log(`🩸 [${analysisData.sessionId}] Low health: ${analysis.health_percentage}%`);
        }
        
        if (analysis.enemies_visible && analysis.enemy_count > 1) {
            log(`👹 [${analysisData.sessionId}] Multiple enemies: ${analysis.enemy_count} (${analysis.enemy_threat_level})`);
        }
    }
    
    handleUrgentSituation(urgentData) {
        const session = this.activeSessions.get(urgentData.sessionId);
        if (!session) return;
        
        session.stats.urgentSituations++;
        this.orchestratorStats.urgentSituationsHandled++;
        
        log(`🚨 URGENT [${urgentData.sessionId}]: ${urgentData.situation}`);
        
        // Send urgent situation directly to display layer for immediate visual feedback
        this.layers.display.processUrgentSituation(urgentData);
        
        // Also ensure context fusion layer processes it
        this.layers.context.processGameEvent({
            type: 'urgent_situation',
            data: urgentData,
            timestamp: new Date(),
            urgency_level: urgentData.urgency_level
        });
    }
    
    handleVisionAnalysisComplete(visionData) {
        const session = this.activeSessions.get(visionData.sessionId);
        if (!session) return;
        
        log('👁️ Vision analysis complete, sending response to client');
        
        // Send vision response directly to client
        if (session.clientConnection && session.clientConnection.readyState === 1) {
            session.clientConnection.send(JSON.stringify({
                type: 'ai_response',
                data: {
                    text: visionData.response,
                    type: 'vision_response',
                    question: visionData.question,
                    analysisTime: visionData.analysisTime
                },
                timestamp: visionData.timestamp
            }));
            log('📤 Vision response sent to client');
        }
    }
    
    // ======================================================================
    // UNIFIED GEMINI AI - Screenshot Forwarding
    // ======================================================================
    // This method forwards screenshots from the Vision Layer to the unified
    // Gemini AI Decision Engine. The same Gemini 2.5 Flash model handles:
    // - Simple text questions (no screenshot)
    // - Vision questions (with screenshot)
    // ======================================================================
    handleScreenshotForGemini(data) {
        const session = this.activeSessions.get(data.sessionId);
        if (!session) {
            console.error('❌ No session found for screenshot:', data.sessionId);
            return;
        }
        
        log('🖼️ Forwarding screenshot to unified Gemini AI (replaces old GPT-4o path)');
        
        // Create a context fusion event with the screenshot
        const fusedContext = {
            sessionId: data.sessionId,
            currentState: {
                audio: {
                    transcript: data.screenshot.question,
                    isFinal: true,
                    intentClassification: 'vision_question'
                },
                vision: {
                    hasScreenshot: true,
                    screenshot: data.screenshot
                }
            },
            screenshot: data.screenshot, // Direct access for AI layer
            narrative: `Player asked about their screen: "${data.screenshot.question}"`,
            game: this.activeSessions.get(data.sessionId)?.gameContext || {},
            guideContext: session.guideContext || null,
            recentHistory: []
        };
        
        const situationAnalysis = {
            needsAIResponse: true,
            urgencyLevel: 3,
            triggerReasons: ['vision_question'],
            suggestedResponseType: 'vision_answer',
            timeToRespond: 2000
        };
        
        // Send directly to AI Decision Engine
        this.layers.ai.processContextForAI({
            fusedContext,
            situationAnalysis,
            timestamp: data.screenshot.timestamp || new Date().toISOString()
        });
        
        // Update session stats
        session.stats.visionQuestionsAnswered = (session.stats.visionQuestionsAnswered || 0) + 1;
    }
    
    handleContextFusion(contextData) {
        // This is where the magic happens - context is fused and ready for AI
        log(`🔗 [${contextData.sessionId}] Context fused: ${contextData.fusedContext.narrative.substring(0, 100)}...`);
        
        // ✅ FIX: Use actual pipeline start time instead of creating new timestamp
        if (contextData.pipelineStartTime) {
            const actualLatency = Date.now() - contextData.pipelineStartTime;
            this.updatePipelineLatency(contextData.sessionId, actualLatency);
        }
    }
    
    handleAIRequest(aiRequestData) {
        log('🤖 [DEBUG] handleAIRequest called');
        log('🤖 [DEBUG] aiRequestData keys:', Object.keys(aiRequestData));
        
        try {
            log('🤖 [DEBUG] About to call processContextForAI...');
            // Pass AI request to decision engine layer
            this.layers.ai.processContextForAI(aiRequestData);
            log('🤖 [DEBUG] processContextForAI called successfully');
        } catch (error) {
            console.error('❌ [DEBUG] Error in processContextForAI:', error.message);
            console.error('❌ [DEBUG] Stack:', error.stack);
        }
        
        log(`🤖 [${aiRequestData.sessionId}] AI request: ${aiRequestData.responseType} (urgency ${aiRequestData.urgencyLevel})`);
    }
    
    handleAIResponse(aiResponseData) {
        const session = this.activeSessions.get(aiResponseData.sessionId);
        if (!session) return;
        
        session.stats.aiResponsesGenerated++;
        
        // Save turn to conversation history (sliding window)
        const userMessage = aiResponseData.context?.currentState?.audio?.transcript;
        const aiMessage = aiResponseData.response.text;
        if (userMessage && aiMessage) {
            this.layers.context.addTurnToHistory(aiResponseData.sessionId, userMessage, aiMessage);
            
            // NEW: Store in short-term memory
            this.memoryManager.addShortTermMessage(
                aiResponseData.sessionId,
                session.gameContext.gameTitle,
                userMessage,
                aiMessage
            ).catch(err => console.error('Failed to store message:', err));
            
            // NEW: Extract events from AI response
            this.eventDetector.detectEvents(aiMessage, session.gameContext.gameTitle)
                .then(events => {
                    if (events.length > 0) {
                        return this.memoryManager.storeEvents(events, session.gameContext.gameTitle);
                    }
                })
                .catch(err => console.error('Failed to extract AI response events:', err));
        }
        
        // Send TEXT response to client IMMEDIATELY (don't wait for TTS)
        if (session.clientConnection && session.clientConnection.readyState === 1) {
            session.clientConnection.send(JSON.stringify({
                type: 'ai_response',
                data: {
                    text: aiResponseData.response.text,
                    urgencyLevel: aiResponseData.response.urgencyLevel || 1,
                    fromCache: aiResponseData.response.fromCache,
                    generationTime: aiResponseData.response.responseTime,
                    ragRelevance: aiResponseData.context?.sessionMemory?.ragRelevance || 0 // ✅ Pass RAG relevance for gold tint
                },
                timestamp: new Date()
            }));
            log(`📤 Sent text response to client (RAG: ${(aiResponseData.context?.sessionMemory?.ragRelevance || 0).toFixed(2)})`);
        }
        
        // Generate audio async (don't block text delivery)
        this.layers.output.processAIResponse(aiResponseData);
        
        log(`🤖 [${aiResponseData.sessionId}] AI response: "${aiResponseData.response.text}" [${aiResponseData.response.responseTime}ms]`);
    }
    
    handleUrgentAIResponse(urgentAI) {
        log(`🚨 URGENT AI [${urgentAI.sessionId}]: "${urgentAI.response.text}"`);
        
        // Urgent AI responses may need special handling
        this.emit('urgent-ai-generated', urgentAI);
    }
    
    handleAudioGenerated(audioData) {
        const session = this.activeSessions.get(audioData.sessionId);
        if (!session) return;
        
        // Don't send here - already sent in handleAIResponse
        // This was causing duplicates!
        
        // Pass audio to display layer (for internal tracking only)
        this.layers.display.processAudioOutput(audioData);
        
        const sizeMB = (audioData.audio.audioBuffer?.length || 0) / 1024 / 1024;
        log(`🔊 [${audioData.sessionId}] Audio ready: ${sizeMB.toFixed(2)}MB [${audioData.audio.generationTime}ms]`);
        log(`   💬 Text: "${audioData.audio.text}"`);
        
        // Emit for external handling (e.g., WebSocket to client)
        this.emit('audio-ready', audioData);
    }
    
    handleUrgentAudio(urgentAudio) {
        log(`🚨 URGENT AUDIO [${urgentAudio.sessionId}]: "${urgentAudio.audio.text}"`);
        
        // Urgent audio needs immediate delivery
        this.emit('urgent-audio-ready', urgentAudio);
    }
    
    handleLayerError(layerName, error) {
        console.error(`❌ Layer error [${layerName}]:`, error.message);
        this.orchestratorStats.errors++;
        
        this.emit('layer-error', {
            layer: layerName,
            error: error.message,
            timestamp: new Date()
        });
    }
    
    updatePipelineLatency(sessionId, actualLatencyMs) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        
        // ✅ FIX: Use the actual calculated latency instead of estimating
        session.stats.totalLatency += actualLatencyMs;
        const responseCount = session.stats.aiResponsesGenerated || 1;
        session.stats.avgLatency = session.stats.totalLatency / responseCount;
        
        log(`⏱️ [${sessionId}] Pipeline latency: ${actualLatencyMs}ms (avg: ${Math.round(session.stats.avgLatency)}ms)`);
        
        // Update orchestrator stats
        this.orchestratorStats.totalPipelineLatency += actualLatencyMs;
        const totalResponses = this.orchestratorStats.sessionsStarted * 10; // Estimate
        this.orchestratorStats.avgPipelineLatency = this.orchestratorStats.totalPipelineLatency / Math.max(totalResponses, 1);
    }
    
    logPerformanceMetrics() {
        // Compressed metrics - only log when there's activity or errors
        const activeSessions = this.activeSessions.size;
        const totalErrors = this.orchestratorStats.errors;
        
        if (activeSessions > 0 || totalErrors > 0) {
            log(`📊 Gaming: ${activeSessions}/${this.config.maxConcurrentSessions} active, ${this.orchestratorStats.sessionsStarted} total, ${totalErrors} errors`);
        }
        
        // Skip verbose logging to reduce backend spam
    }
    
    getLayerIcon(layerName) {
        const icons = {
            capture: '🎬',
            transcription: '🎤',
            vision: '👁️',
            context: '🔗',
            ai: '🤖',
            output: '🔊',
            display: '🖥️'
        };
        return icons[layerName] || '⚙️';
    }
    
    // Public API methods
    async startGamingSession(sessionId, gameTitle, gameProcess = null, clientConnection = null) {
        const gameContext = {
            gameTitle,
            gameProcess,
            gameType: this.inferGameType(gameTitle),
            startedAt: new Date()
        };
        
        return await this.startSession(sessionId, gameContext, clientConnection);
    }
    
    async stopGamingSession(sessionId) {
        return await this.stopSession(sessionId);
    }
    
    inferGameType(gameTitle) {
        if (!gameTitle) return 'unknown';
        
        const title = gameTitle.toLowerCase();
        
        if (title.includes('elden ring') || title.includes('dark souls') || title.includes('bloodborne')) {
            return 'souls-like';
        }
        
        if (title.includes('world of warcraft') || title.includes('wow') || title.includes('final fantasy')) {
            return 'mmorpg';
        }
        
        if (title.includes('call of duty') || title.includes('counter-strike') || title.includes('valorant')) {
            return 'fps';
        }
        
        if (title.includes('league of legends') || title.includes('dota') || title.includes('starcraft')) {
            return 'strategy';
        }
        
        return 'action'; // Default
    }
    
    getActiveSessions() {
        return Array.from(this.activeSessions.values()).map(session => ({
            id: session.id,
            gameTitle: session.gameContext.gameTitle,
            startTime: session.startTime,
            duration: Date.now() - session.startTime,
            stats: session.stats
        }));
    }
    
    getPerformanceStats() {
        return {
            orchestrator: this.orchestratorStats,
            layers: Object.fromEntries(
                Object.entries(this.layers).map(([name, layer]) => [name, layer.getStats()])
            )
        };
    }
    
    // Connect client to specific session
    connectClient(sessionId, clientConnection) {
        log(`🔍 [DEBUG] connectClient called with sessionId: "${sessionId}"`);
        log(`🔍 [DEBUG] activeSessions.size: ${this.activeSessions.size}`);
        log(`🔍 [DEBUG] activeSessions keys:`, Array.from(this.activeSessions.keys()));
        
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            console.error(`❌ [DEBUG] Cannot connect client to non-existent session: "${sessionId}"`);
            console.error(`📊 [DEBUG] Active sessions:`, Array.from(this.activeSessions.keys()));
            console.error(`🔍 [DEBUG] Session lookup failed for: "${sessionId}"`);
            console.error(`🔍 [DEBUG] typeof sessionId: ${typeof sessionId}`);
            return false;
        }
        
        // ✅ FIX: Properly handle connection reassignment
        if (session.clientConnection) {
            const oldReadyState = session.clientConnection.readyState;
            log(`🔄 [DEBUG] Replacing existing connection (old readyState: ${oldReadyState})`);
            
            // Close old connection if it's still open
            if (oldReadyState === 1) { // WebSocket.OPEN
                log('🔌 Closing old WebSocket connection');
                session.clientConnection.close();
            } else {
                log(`⚰️ Old connection already closed (readyState: ${oldReadyState})`);
            }
        }
        
        session.clientConnection = clientConnection;
        session.clientConnectionTimestamp = Date.now(); // Track when connection was updated
        this.layers.display.connectClient(clientConnection);
        
        log(`✅ Client connection updated for session: ${sessionId}`);
        log(`   📡 New connection readyState: ${clientConnection.readyState}`);
        log(`   ⏰ Connection timestamp: ${new Date().toISOString()}`);
        log(`   📊 Session stats:`, {
            transcriptsProcessed: session.stats.transcriptsProcessed,
            aiResponsesGenerated: session.stats.aiResponsesGenerated
        });
        
        // ✅ TEST: Immediately send a test message to verify connection works
        try {
            clientConnection.send(JSON.stringify({
                type: 'welcome',
                sessionId: sessionId,
                message: 'Client reconnected successfully - transcription active',
                timestamp: new Date().toISOString()
            }));
            log('✅ Test welcome message sent successfully');
        } catch (testError) {
            console.error('❌ Failed to send test message - connection may be broken:', testError.message);
            return false; // Connection is broken
        }
        
        // ✅ IMPORTANT: Verify transcription layer is still active
        if (this.layers.transcription && this.layers.transcription.isTranscribing) {
            log('✅ Transcription layer is active and ready');
        } else {
            console.warn('⚠️ Transcription layer may not be active - starting it now');
            // Restart transcription layer asynchronously (don't block)
            this.layers.transcription.startTranscription(sessionId).catch(err => {
                console.error('❌ Failed to restart transcription:', err.message);
            });
        }
        
        return true;
    }
    
    async preloadMemory(sessionId, gameTitle) {
        try {
            const memoryContext = await this.memoryPreloader.preloadMemoryForSession(
                sessionId, 
                gameTitle
            );
            
            // Inject into Context Fusion Layer
            if (this.layers.context && typeof this.layers.context.setPreloadedMemory === 'function') {
                this.layers.context.setPreloadedMemory(sessionId, memoryContext);
            }
            
            // Inject into Voice Mode Layer (ElevenLabs) if active
            if (this.layers.voice && typeof this.layers.voice.setPreloadedMemory === 'function') {
                this.layers.voice.setPreloadedMemory(memoryContext);
            }
            
            log('🧠 AI warmed up with memory context');
        } catch (error) {
            console.error('❌ Memory preload failed:', error);
        }
    }
    
    async shutdown() {
        log('🛑 Shutting down GamingAssistantOrchestrator...');
        
        // Stop all active sessions
        const stopPromises = Array.from(this.activeSessions.keys()).map(sessionId => 
            this.stopSession(sessionId)
        );
        
        await Promise.all(stopPromises);
        
        // Clear performance timer
        if (this.performanceTimer) {
            clearInterval(this.performanceTimer);
            this.performanceTimer = null;
        }
        
        log('✅ GamingAssistantOrchestrator shut down complete');
        
        this.emit('orchestrator-shutdown');
    }
}

module.exports = GamingAssistantOrchestrator;
