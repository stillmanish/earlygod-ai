// Layer 4: Context Fusion (50-100ms) - Combine Vision + Audio + Game Context
const EventEmitter = require('events');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class ContextFusionLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            maxHistoryItems: options.maxHistoryItems || 20, // Keep last N context items
            urgencyTimeWindow: options.urgencyTimeWindow || 5000, // 5 seconds for urgent detection
            contextExpiryTime: options.contextExpiryTime || 30000, // 30 seconds context expiry
            priorityThresholds: {
                health: options.healthThreshold || 25,
                enemies: options.enemyThreshold || 2,
                urgencyLevel: options.urgencyThreshold || 4
            }
        };
        
        this.isActive = false;
        this.sessionId = null;
        this.gameContext = {};
        
        // Session memory (in-memory only, no DB in hot path)
        this.sessions = new Map();
        
        // Context storage
        this.visionHistory = [];
        this.audioHistory = [];
        this.gameEventHistory = [];
        this.fusedContextHistory = [];
        
        // Current state
        this.currentVisionState = null;
        this.currentAudioTranscript = null;
        this.currentGameState = null;
        this.currentGuideContext = null; // 🎯 RAG guide context
        this.consecutiveEmptyTranscripts = 0; // Track empty transcript attempts
        this.preloadedMemory = null; // 🧠 Preloaded memory context
        
        // Performance tracking
        this.stats = {
            contextItemsProcessed: 0,
            urgentSituationsDetected: 0,
            questionTriggersDetected: 0,
            totalFusionTime: 0,
            avgFusionTime: 0
        };
        
        log('🔗 ContextFusionLayer initialized:', {
            maxHistory: this.config.maxHistoryItems,
            urgencyWindow: `${this.config.urgencyTimeWindow}ms`
        });
    }
    
    async start(sessionId, gameContext = {}) {
        if (this.isActive) {
            console.warn('⚠️ Context fusion already active');
            return;
        }
        
        this.sessionId = sessionId;
        this.gameContext = gameContext;
        this.isActive = true;
        
        // Create session memory
        this.createSession(sessionId, gameContext);
        
        log('🔗 Starting context fusion for session:', sessionId);
        this.emit('fusion-started', { sessionId, gameContext });
        
        // 🔇 CLEANUP TIMER DISABLED - testing if this causes empty transcript loops
        // TODO: Re-enable after fixing empty transcript bug
        /*
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredContext();
        }, 10000); // Cleanup every 10 seconds
        */
        log('🔇 Context cleanup timer disabled for debugging');
    }
    
    createSession(sessionId, gameContext) {
        const session = {
            // Core context (always included)
            game: {
                title: gameContext.gameTitle || 'Unknown Game',
                type: gameContext.gameType || 'action'
            },
            
            // Sliding window (last 5 turns only for token management)
            recentTurns: [], // [{user: "...", ai: "...", timestamp}]
            
            // Current state (updated continuously)
            state: {
                objective: null,
                location: null,
                lastVision: null
            },
            
            // RAG context (optional, guide-specific)
            rag: {
                active: false,
                guideId: null,
                guideTitle: null,
                currentStep: null,
                stepNumber: 0,
                totalSteps: 0,
                allSteps: []
            },
            
            // Preloaded memory (set async after session creation)
            preloadedMemory: null  // ✅ CRITICAL: Initialize to ensure consistent session structure
        };
        
        this.sessions.set(sessionId, session);
        log('💾 Session memory created:', sessionId);
        return session;
    }
    
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    
    addTurnToHistory(sessionId, userMessage, aiResponse) {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        // Add new turn
        session.recentTurns.push({
            user: userMessage,
            ai: aiResponse,
            timestamp: Date.now()
        });
        
        // Sliding window: Keep only last 5 turns for token management
        if (session.recentTurns.length > 5) {
            session.recentTurns.shift();
        }
    }
    
    updateState(sessionId, updates) {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        session.state = { ...session.state, ...updates };
    }
    
    processVisionData(visionData) {
        if (!this.isActive) return;
        
        const fusionStart = Date.now();
        
        // Store vision data
        this.currentVisionState = visionData.analysis;
        this.addToHistory(this.visionHistory, {
            timestamp: visionData.frameTimestamp,
            type: 'vision',
            data: visionData.analysis
        });
        
        // Trigger fusion process
        this.performContextFusion('vision', fusionStart);
    }
    
    processAudioData(audioData) {
        if (!this.isActive) return;
        
        // Only filter empty transcripts for AI processing, not for display
        const hasContent = audioData.transcript && audioData.transcript.trim().length > 0;
        
        const fusionStart = Date.now();
        
        // Check if this is a significant update worth processing
        const isSignificantUpdate = !this.currentAudioTranscript || 
                                    audioData.transcript.length > (this.currentAudioTranscript.transcript?.length || 0) + 3 ||
                                    audioData.isFinal;
        
        if (!isSignificantUpdate) {
            log('⏭️ Skipping minor interim update');
            return;
        }
        
        log('🎤 Context fusion received audio:', {
            transcript: audioData.transcript?.substring(0, 50),
            intent: audioData.intentClassification,
            confidence: audioData.confidence,
            isFinal: audioData.isFinal
        });
        
        // Store audio data
        this.currentAudioTranscript = audioData;
        this.addToHistory(this.audioHistory, {
            timestamp: audioData.timestamp,
            type: 'audio',
            data: audioData
        });
        
        // ✅ FIX: Preserve pipeline start time for latency calculation
        if (audioData.pipelineStartTime) {
            this.currentPipelineStartTime = audioData.pipelineStartTime;
        }
        
        // Trigger fusion process only for final OR significantly longer transcripts (with valid content)
        if ((audioData.isFinal && audioData.transcript.trim().length > 0) || audioData.transcript.length > 10) {
            this.performContextFusion('audio', fusionStart);
        } else {
            log('⏭️ Not triggering fusion - transcript too short or empty');
        }
        
        // Reset transcript state after processing final transcripts to allow new questions
        if (audioData.isFinal) {
            log('🔄 Resetting transcript state for next question');
            this.currentAudioTranscript = null;
        }
    }
    
    processGameEvent(gameEvent) {
        if (!this.isActive) return;
        
        const fusionStart = Date.now();
        
        // Store game event
        this.addToHistory(this.gameEventHistory, {
            timestamp: gameEvent.timestamp || new Date(),
            type: 'game_event',
            data: gameEvent
        });
        
        // Trigger fusion process
        this.performContextFusion('game_event', fusionStart);
    }
    
    // 🎯 NEW: Set guide context for RAG integration (Path A - Direct guide questions)
    setGuideContext(guideContext) {
        try {
            // 🛡️ SAFE GUIDE CONTEXT HANDLING - prevent crashes
            this.currentGuideContext = guideContext;
            
            if (guideContext) {
                log('🎯 Path A guide context updated:', {
                    hasGuide: !!guideContext,
                    title: guideContext?.title || 'Unknown',
                    currentStep: guideContext?.currentStep?.step_number || 'None',
                    progress: guideContext?.progress || 0,
                    relevantSteps: guideContext?.relevantSteps?.length || 0
                });
            } else {
                log('🎯 Path A guide context cleared');
            }
        } catch (error) {
            console.error('❌ [CRITICAL] Error setting guide context:', error.message);
            console.error('❌ [CRITICAL] Stack:', error.stack);
            console.error('❌ [CRITICAL] Falling back to null guide context');
            this.currentGuideContext = null; // Fail safe
        }
    }
    
    // 🎯 NEW: Update guide step - keeps BOTH Path A and Path B synchronized
    updateGuideStep(sessionId, newStepNumber) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.rag || !session.rag.active) {
            console.warn('⚠️ Cannot update guide step - no active RAG session');
            return false;
        }
        
        if (newStepNumber < 0 || newStepNumber >= session.rag.totalSteps) {
            console.warn('⚠️ Invalid step number:', newStepNumber);
            return false;
        }
        
        // Update Path B (session.rag)
        session.rag.stepNumber = newStepNumber;
        session.rag.currentStep = session.rag.allSteps[newStepNumber];
        
        const progress = Math.round((newStepNumber / session.rag.totalSteps) * 100);
        
        // Update Path A (currentGuideContext) to stay synchronized
        if (this.currentGuideContext) {
            this.currentGuideContext.stepNumber = newStepNumber;
            this.currentGuideContext.currentStep = session.rag.currentStep;
            this.currentGuideContext.progress = progress;
            
            // Update relevant steps (current + next 2)
            const startIdx = newStepNumber;
            const endIdx = Math.min(startIdx + 3, session.rag.totalSteps);
            this.currentGuideContext.relevantSteps = session.rag.allSteps.slice(startIdx, endIdx);
        }
        
        log('🎯 [DUAL RAG] Updated both paths:', {
            sessionId,
            newStep: newStepNumber + 1,
            title: session.rag.currentStep?.title,
            progress: progress + '%',
            pathASync: !!this.currentGuideContext,
            pathBSync: true
        });
        
        return true;
    }
    
    performContextFusion(triggerType, startTime) {
        try {
            log('🔍 [CRITICAL DEBUG] performContextFusion called:', {
                triggerType: triggerType,
                stackTrace: new Error().stack.split('\n').slice(1, 4).join('\n'), // Show caller stack
                timestamp: new Date().toISOString(),
                hasCurrentAudio: !!this.currentAudioTranscript,
                currentAudioTranscript: this.currentAudioTranscript ? JSON.stringify(this.currentAudioTranscript.transcript) : 'null'
            });
            
            // Create fused context object
            const fusedContext = this.createFusedContext();
            
            // Detect situations that need AI intervention
            const situationAnalysis = this.analyzeSituation(fusedContext);
            
            log('🔗 Context fusion complete:', {
                trigger: triggerType,
                needsAI: situationAnalysis.needsAIResponse,
                urgency: situationAnalysis.urgencyLevel,
                reasons: situationAnalysis.triggerReasons,
                transcript: fusedContext.currentState?.audio?.transcript || 'NO_TRANSCRIPT'
            });
            
            // Store fused context
            this.addToHistory(this.fusedContextHistory, {
                timestamp: new Date(),
                type: 'fused_context',
                data: fusedContext,
                analysis: situationAnalysis,
                triggerType
            });
            
            const fusionTime = Date.now() - startTime;
            this.updateStats(fusionTime, situationAnalysis);
            
            // Emit fused context
            this.emitFusedContext(fusedContext, situationAnalysis, triggerType);
            
        } catch (error) {
            console.error('❌ Context fusion error:', error.message);
            this.emit('fusion-error', {
                sessionId: this.sessionId,
                error: error.message,
                triggerType
            });
        }
    }
    
    createFusedContext() {
        const now = new Date();
        const session = this.sessions.get(this.sessionId);
        
        // Get recent context items (within time window)
        const recentVision = this.getRecentContext(this.visionHistory, 5000); // 5 seconds
        const recentAudio = this.getRecentContext(this.audioHistory, 10000); // 10 seconds
        const recentEvents = this.getRecentContext(this.gameEventHistory, 15000); // 15 seconds
        
        // Extract current state - handle null transcripts properly
        const currentState = {
            vision: this.currentVisionState || {},
            audio: this.currentAudioTranscript || { transcript: null, isFinal: false }, // Explicit null transcript
            gameState: this.extractGameState(recentVision, recentEvents),
            playerStatus: this.extractPlayerStatus(),
            environment: this.extractEnvironmentInfo()
        };
        
        // Build contextual narrative
        const narrative = this.buildContextualNarrative(currentState, recentAudio);
        
        // Calculate RAG relevance if transcript exists
        let ragRelevance = 0;
        if (session && currentState.audio?.transcript) {
            ragRelevance = this.calculateRAGRelevance(currentState.audio.transcript, session.rag);
        }
        
        const fusedContext = {
            sessionId: this.sessionId,
            timestamp: now,
            currentState,
            recentHistory: {
                vision: recentVision.slice(-3), // Last 3 vision analyses
                audio: recentAudio.slice(-5),   // Last 5 audio transcripts
                events: recentEvents.slice(-3)  // Last 3 game events
            },
            narrative,
            gameContext: this.gameContext,
            guideContext: this.currentGuideContext || null, // 🎯 Include guide RAG data (safe)
            confidence: this.calculateContextConfidence(currentState),
            
            // Session memory (sliding window)
            sessionMemory: session ? {
                game: session.game,
                recentTurns: session.recentTurns,
                state: session.state,
                rag: session.rag,
                ragRelevance: ragRelevance,
                preloadedMemory: session.preloadedMemory  // ✅ CRITICAL: Include preloaded memory for AI context
            } : null
        };
        
        // 🔍 DEBUG: Log what we're sending to AI layer
        log('🔍 [DEBUG] FusedContext created:', {
            hasCurrentState: !!fusedContext.currentState,
            hasAudio: !!fusedContext.currentState?.audio,
            transcript: fusedContext.currentState?.audio?.transcript || 'MISSING',
            transcriptLength: fusedContext.currentState?.audio?.transcript?.length || 0,
            hasGuideContext: !!fusedContext.guideContext,
            hasSessionMemory: !!fusedContext.sessionMemory,
            recentTurnsCount: fusedContext.sessionMemory?.recentTurns?.length || 0,
            ragRelevance: ragRelevance.toFixed(2)
        });
        
        return fusedContext;
    }
    
    calculateRAGRelevance(transcript, rag) {
        if (!rag || !rag.active) return 0;
        
        const text = transcript.toLowerCase();
        
        // High relevance keywords
        const directGuideKeywords = [
            'next', 'what now', 'what should i do', 
            'where do i go', 'guide', 'step', 'objective'
        ];
        
        if (directGuideKeywords.some(kw => text.includes(kw))) {
            return 1.0; // Definitely include RAG
        }
        
        // Check if question mentions items/locations from current step
        if (rag.currentStep) {
            const currentStepText = (rag.currentStep.action || '').toLowerCase();
            const overlap = this.calculateTextOverlap(text, currentStepText);
            
            if (overlap > 0.3) {
                return 0.8; // Likely relevant
            }
        }
        
        // Generic question keywords (low relevance)
        const genericKeywords = ['why', 'tell me about', 'explain', 'lore'];
        if (genericKeywords.some(kw => text.includes(kw))) {
            return 0.2; // Probably not guide-related
        }
        
        // Default: medium relevance
        return 0.5;
    }
    
    calculateTextOverlap(text1, text2) {
        const words1 = new Set(text1.split(' ').filter(w => w.length > 3));
        const words2 = new Set(text2.split(' ').filter(w => w.length > 3));
        const intersection = [...words1].filter(w => words2.has(w)).length;
        return intersection / Math.max(words1.size, 1);
    }
    
    analyzeSituation(fusedContext) {
        const analysis = {
            needsAIResponse: false,
            urgencyLevel: 1,
            triggerReasons: [],
            suggestedResponseType: 'none',
            timeToRespond: 5000 // Default 5 seconds
        };
        
        const state = fusedContext.currentState;
        
        // 🔍 DEBUG: Log situation analysis inputs
        log('🔍 [DEBUG] analyzeSituation inputs:', {
            hasAudio: !!state.audio,
            transcript: JSON.stringify(state.audio?.transcript),
            transcriptLength: state.audio?.transcript?.length || 0,
            intentClassification: state.audio?.intentClassification,
            hasVision: !!state.vision
        });
        
        // 🛡️ SAFETY: Don't trigger ANY AI responses for empty transcripts (moved to top)
        if (!state.audio || !state.audio.transcript || typeof state.audio.transcript !== 'string' || state.audio.transcript.trim().length === 0) {
            log('⏭️ [SAFETY] Blocking ALL AI analysis for empty/invalid transcript - including urgent situations');
            log('   📊 Transcript details:', {
                hasAudio: !!state.audio,
                hasTranscript: !!state.audio?.transcript,
                transcriptType: typeof state.audio?.transcript,
                transcriptValue: state.audio?.transcript
            });
            return analysis; // Return default (needsAIResponse: false) - blocks everything
        }
        
        // Check for urgent situations (health, enemies, boss fights) - only with valid transcripts
        if (this.isUrgentSituation(state)) {
            log('🚨 [DEBUG] Triggered: urgent_situation');
            analysis.needsAIResponse = true;
            analysis.urgencyLevel = 5;
            analysis.triggerReasons.push('urgent_situation');
            analysis.suggestedResponseType = 'urgent_warning';
            analysis.timeToRespond = 500; // Respond within 500ms
        }
        
        // Check for player questions
        else if (this.hasPlayerQuestion(state.audio)) {
            log('❓ [DEBUG] Triggered: player_question');
            analysis.needsAIResponse = true;
            analysis.urgencyLevel = 3;
            analysis.triggerReasons.push('player_question');
            analysis.suggestedResponseType = 'answer';
            analysis.timeToRespond = 2000; // Respond within 2 seconds
        }
        
        // Check for confusion or being stuck
        else if (this.isPlayerStuck(state, fusedContext.recentHistory)) {
            log('🤔 [DEBUG] Triggered: player_stuck');
            analysis.needsAIResponse = true;
            analysis.urgencyLevel = 2;
            analysis.triggerReasons.push('player_stuck');
            analysis.suggestedResponseType = 'guidance';
            analysis.timeToRespond = 3000;
        }
        
        // Check for good timing for proactive tips
        else if (this.isGoodTipTiming(state, fusedContext.recentHistory)) {
            log('💡 [DEBUG] Triggered: proactive_tip');
            analysis.needsAIResponse = true;
            analysis.urgencyLevel = 1;
            analysis.triggerReasons.push('proactive_tip');
            analysis.suggestedResponseType = 'tip';
            analysis.timeToRespond = 5000;
        }
        
        // NEW: Respond to ANY player speech (gaming assistant should always engage)
        // ✅ FIX: Strengthen validation to prevent phantom AI requests
        // Lowered threshold from >5 to >=3 to allow short responses like "Okay", "Yes", "Help"
        else if (state.audio && 
                 state.audio.transcript && 
                 typeof state.audio.transcript === 'string' && 
                 state.audio.transcript.trim().length >= 3) {
            log('💬 [DEBUG] Triggered: player_communication');
            analysis.needsAIResponse = true;
            analysis.urgencyLevel = 2;
            analysis.triggerReasons.push('player_communication');
            analysis.suggestedResponseType = 'conversation';
            analysis.timeToRespond = 3000;
            log('💬 Player said something - will respond');
        }
        
        // 🔍 DEBUG: Log if no triggers matched
        if (!analysis.needsAIResponse) {
            log('⏭️ [DEBUG] No AI triggers matched - no response needed');
        }
        
        // 🛡️ FINAL SAFETY: Never trigger AI without valid transcript (safety override)
        if (analysis.needsAIResponse && (!state.audio?.transcript || state.audio.transcript.trim().length === 0)) {
            console.error('🚨 [CRITICAL] AI was about to be triggered with empty transcript! Overriding to prevent timeout.');
            console.error('🚨 [CRITICAL] Trigger was:', analysis.triggerReasons);
            console.error('🚨 [CRITICAL] Audio state:', JSON.stringify(state.audio));
            console.error('🚨 [CRITICAL] Recent audio history length:', fusedContext.recentHistory?.audio?.length || 0);
            console.error('🚨 [CRITICAL] Current audio transcript state:', this.currentAudioTranscript ? JSON.stringify(this.currentAudioTranscript) : 'null');
            
            analysis.needsAIResponse = false; // Override - prevent AI processing
            analysis.triggerReasons = ['empty_transcript_override'];
        }
        
        return analysis;
    }
    
    isUrgentSituation(state) {
        const vision = state.vision;
        
        // Low health with enemies
        if (vision.health_percentage !== null && 
            vision.health_percentage < this.config.priorityThresholds.health &&
            vision.enemies_visible) {
            return true;
        }
        
        // High enemy threat level
        if (vision.enemy_threat_level === 'critical' || vision.enemy_threat_level === 'high') {
            return true;
        }
        
        // Multiple enemies
        if (vision.enemy_count >= this.config.priorityThresholds.enemies) {
            return true;
        }
        
        // AI detected urgent situation
        if (vision.urgent_situation) {
            return true;
        }
        
        return false;
    }
    
    hasPlayerQuestion(audio) {
        if (!audio || !audio.transcript) return false;
        
        return audio.intentClassification === 'question' || 
               audio.intentClassification === 'urgent_help';
    }
    
    isPlayerStuck(state, history) {
        // Check if player hasn't made progress or keeps asking for help
        const recentAudio = history.audio || [];
        const stuckKeywords = ['stuck', 'lost', 'help', 'confused', 'where', "can't find"];
        
        const recentStuckMentions = recentAudio.filter(item => {
            const transcript = item.data?.transcript?.toLowerCase() || '';
            return stuckKeywords.some(keyword => transcript.includes(keyword));
        });
        
        return recentStuckMentions.length >= 2; // Multiple mentions of being stuck
    }
    
    isGoodTipTiming(state, history) {
        // Good timing: calm moment, no recent AI responses, player seems engaged
        const vision = state.vision;
        
        // Calm situation
        const isCalm = !vision.urgent_situation && 
                      vision.enemy_threat_level === 'low' && 
                      (vision.health_percentage === null || vision.health_percentage > 50);
        
        if (!isCalm) return false;
        
        // Check if we haven't given advice recently
        const lastResponse = this.getLastAIResponse();
        if (lastResponse && (Date.now() - lastResponse.timestamp) < 30000) { // 30 seconds
            return false;
        }
        
        return true;
    }
    
    buildContextualNarrative(currentState, recentAudio) {
        const parts = [];
        
        // Player status
        if (currentState.vision.health_percentage !== null) {
            parts.push(`Player health: ${currentState.vision.health_percentage}%`);
        }
        
        // Environment
        if (currentState.vision.enemies_visible) {
            parts.push(`${currentState.vision.enemy_count} enemies detected (${currentState.vision.enemy_threat_level} threat)`);
        }
        
        // Recent player communication
        const lastTranscript = recentAudio[recentAudio.length - 1];
        if (lastTranscript && lastTranscript.data?.transcript) {
            parts.push(`Player said: "${lastTranscript.data.transcript}"`);
        }
        
        // Current objective
        if (currentState.vision.current_objective) {
            parts.push(`Objective: ${currentState.vision.current_objective}`);
        }
        
        return parts.join('; ');
    }
    
    extractGameState(recentVision, recentEvents) {
        const latest = recentVision[recentVision.length - 1];
        return {
            screen_analysis: latest?.data || {},
            recent_events: recentEvents.map(e => e.data),
            activity_level: this.calculateActivityLevel(recentVision)
        };
    }
    
    extractPlayerStatus() {
        if (!this.currentVisionState) return {};
        
        return {
            health: this.currentVisionState.health_percentage,
            threat_level: this.currentVisionState.enemy_threat_level,
            in_combat: this.currentVisionState.enemies_visible,
            urgency: this.currentVisionState.urgency_level
        };
    }
    
    extractEnvironmentInfo() {
        if (!this.currentVisionState) return {};
        
        return {
            ui_visible: this.currentVisionState.ui_elements?.length > 0,
            objectives_shown: this.currentVisionState.objectives_visible,
            game_paused: this.isGamePaused()
        };
    }
    
    calculateActivityLevel(recentVision) {
        // Simple activity calculation based on screen changes
        if (recentVision.length < 2) return 'unknown';
        
        const changes = recentVision.slice(-5).reduce((count, current, index, array) => {
            if (index === 0) return count;
            const prev = array[index - 1];
            if (current.data?.situation_description !== prev.data?.situation_description) {
                return count + 1;
            }
            return count;
        }, 0);
        
        if (changes >= 3) return 'high';
        if (changes >= 2) return 'medium';
        if (changes >= 1) return 'low';
        return 'static';
    }
    
    isGamePaused() {
        // Simple heuristic: if the same screen analysis has been seen multiple times
        return this.visionHistory.slice(-3).every((item, index, array) => 
            index === 0 || item.data?.situation_description === array[0].data?.situation_description
        );
    }
    
    calculateContextConfidence(currentState) {
        let confidence = 0.5;
        
        if (currentState.vision?.confidence_score) {
            confidence += currentState.vision.confidence_score * 0.3;
        }
        
        if (currentState.audio?.confidence) {
            confidence += currentState.audio.confidence * 0.2;
        }
        
        return Math.min(1.0, confidence);
    }
    
    getRecentContext(history, timeWindowMs) {
        const cutoff = Date.now() - timeWindowMs;
        return history.filter(item => 
            new Date(item.timestamp).getTime() > cutoff
        );
    }
    
    addToHistory(history, item) {
        history.push(item);
        
        // Maintain size limit
        if (history.length > this.config.maxHistoryItems) {
            history.shift();
        }
    }
    
    cleanupExpiredContext() {
        const expiryCutoff = Date.now() - this.config.contextExpiryTime;
        
        [this.visionHistory, this.audioHistory, this.gameEventHistory, this.fusedContextHistory]
            .forEach(history => {
                const originalLength = history.length;
                history = history.filter(item => 
                    new Date(item.timestamp).getTime() > expiryCutoff
                );
                
                if (history.length !== originalLength) {
                    log(`🧹 Cleaned up ${originalLength - history.length} expired context items`);
                }
            });
    }
    
    updateStats(fusionTime, situationAnalysis) {
        this.stats.contextItemsProcessed++;
        this.stats.totalFusionTime += fusionTime;
        this.stats.avgFusionTime = this.stats.totalFusionTime / this.stats.contextItemsProcessed;
        
        if (situationAnalysis.urgencyLevel >= 4) {
            this.stats.urgentSituationsDetected++;
        }
        
        if (situationAnalysis.triggerReasons.includes('player_question')) {
            this.stats.questionTriggersDetected++;
        }
        
        // Log performance every 100 fusions
        if (this.stats.contextItemsProcessed % 100 === 0) {
            log(`📊 Context fusion: ${this.stats.contextItemsProcessed} items, avg ${Math.round(this.stats.avgFusionTime)}ms, ${this.stats.urgentSituationsDetected} urgent`);
        }
    }
    
    emitFusedContext(fusedContext, situationAnalysis, triggerType) {
        log('🔗 [DEBUG] About to emit context-fused event');
        
        this.emit('context-fused', {
            sessionId: this.sessionId,
            fusedContext,
            situationAnalysis,
            triggerType,
            timestamp: new Date(),
            pipelineStartTime: this.currentPipelineStartTime  // ✅ FIX: Include pipeline start time for latency calculation
        });
        
        // Emit specific events for high-priority situations
        if (situationAnalysis.needsAIResponse) {
            log('🤖 [DEBUG] About to emit ai-response-needed event');
            log('🤖 [DEBUG] Guide context type:', typeof fusedContext.guideContext);
            log('🤖 [DEBUG] Guide context value:', fusedContext.guideContext);
            
            this.emit('ai-response-needed', {
                sessionId: this.sessionId,
                fusedContext: fusedContext,  // AI layer expects fusedContext
                situationAnalysis: situationAnalysis,  // AI layer expects situationAnalysis
                urgencyLevel: situationAnalysis.urgencyLevel,
                responseType: situationAnalysis.suggestedResponseType,
                timeToRespond: situationAnalysis.timeToRespond,
                reasons: situationAnalysis.triggerReasons
            });
            
            log('🤖 [DEBUG] ai-response-needed event emitted');
        }
    }
    
    getLastAIResponse() {
        const lastFused = this.fusedContextHistory[this.fusedContextHistory.length - 1];
        return lastFused?.analysis?.needsAIResponse ? lastFused : null;
    }
    
    async stop() {
        if (!this.isActive) {
            console.warn('⚠️ Context fusion not active');
            return;
        }
        
        log('🛑 Stopping context fusion');
        this.isActive = false;
        
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        
        this.emit('fusion-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        // Clear state
        this.sessionId = null;
        this.gameContext = {};
        this.currentVisionState = null;
        this.currentAudioTranscript = null;
        this.currentGameState = null;
    }
    
    getStats() {
        return {
            ...this.stats,
            isActive: this.isActive,
            sessionId: this.sessionId,
            historyLengths: {
                vision: this.visionHistory.length,
                audio: this.audioHistory.length,
                events: this.gameEventHistory.length,
                fused: this.fusedContextHistory.length
            },
            config: this.config
        };
    }
    
    getCurrentContext() {
        if (!this.isActive) return null;
        
        return {
            vision: this.currentVisionState,
            audio: this.currentAudioTranscript,
            gameState: this.currentGameState,
            lastFused: this.fusedContextHistory[this.fusedContextHistory.length - 1]
        };
    }
    
    setPreloadedMemory(sessionId, memoryContext) {
        log(`🧠 Setting preloaded memory for session: ${sessionId}`);
        this.preloadedMemory = memoryContext;
        
        // Also store in session memory
        const session = this.sessions.get(sessionId);
        if (session) {
            session.preloadedMemory = memoryContext;
        }
    }
}

module.exports = ContextFusionLayer;
