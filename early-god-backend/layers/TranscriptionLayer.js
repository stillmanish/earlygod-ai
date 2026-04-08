// Layer 2: Transcription (200-300ms) - Deepgram Streaming API
const { createClient } = require('@deepgram/sdk');
const EventEmitter = require('events');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class TranscriptionLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        if (!process.env.DEEPGRAM_API_KEY) {
            console.warn('⚠️ DEEPGRAM_API_KEY not configured, will use OpenAI Realtime API fallback');
            this.useDeepgram = false;
        } else {
            this.useDeepgram = true;
            this.deepgram = createClient(process.env.DEEPGRAM_API_KEY);
        }
        
        this.config = {
            sampleRate: options.sampleRate || 16000, // 16kHz as per Cluely architecture
            chunkSizeMs: options.chunkSizeMs || 100,  // 100ms audio chunks
            interimResults: options.interimResults !== false, // Enable interim results
            utteranceEndMs: options.utteranceEndMs || 1000, // Required for proper interim results (Deepgram docs)
            endpointing: options.endpointing || 300, // Faster finalization using VAD (Deepgram docs recommend 300ms)
            language: options.language || 'en',
            model: options.model || 'nova-3',  // Upgraded from nova-2 for better accuracy and latency
            smartFormat: true,
            punctuate: true
        };
        
        this.isTranscribing = false;
        this.currentConnection = null;
        this.sessionId = null;
        this.keepaliveInterval = null; // Track keepalive timer
        this.lastAudioTime = null; // Track when we last sent audio
        this.lastTranscriptTime = null; // Track when we last received a transcript
        this.lastProcessedTranscript = null; // Track last processed to prevent duplicates
        this.lastProcessedTime = 0;
        this.isReconnecting = false; // Track reconnection state to prevent concurrent reconnects
        this.flushTimer = null; // Timer for debounced flushing of stuck interims
        
        // Speech state tracking (VAD events)
        this.speechState = {
            isSpeaking: false,
            lastSpeechStart: null,
            lastUtteranceEnd: null,
            currentRequestId: null,
            requestStartTime: null
        };
        
        // Performance tracking
        this.stats = {
            chunksProcessed: 0,
            totalLatency: 0,
            avgLatency: 0,
            transcriptLength: 0,
            utteranceEndCount: 0,
            speechStartedCount: 0
        };
        
        log('🎤 TranscriptionLayer initialized:', {
            service: this.useDeepgram ? 'Deepgram' : 'OpenAI Fallback',
            sampleRate: `${this.config.sampleRate}Hz`,
            chunkSize: `${this.config.chunkSizeMs}ms`,
            model: this.config.model,
            interimResults: this.config.interimResults,
            utteranceEndMs: `${this.config.utteranceEndMs}ms`,
            endpointing: `${this.config.endpointing}ms`
        });
    }
    
    async startTranscription(sessionId) {
        if (this.isTranscribing) {
            console.warn('⚠️ Transcription already running');
            return;
        }
        
        this.sessionId = sessionId;
        this.isTranscribing = true;
        
        if (this.useDeepgram) {
            await this.startDeepgramTranscription();
        } else {
            await this.startFallbackTranscription();
        }
        
        this.emit('transcription-started', { sessionId });
    }
    
    async startDeepgramTranscription() {
        log('🚀 Starting Deepgram real-time transcription...');
        log('   🔑 API Key configured:', !!process.env.DEEPGRAM_API_KEY);
        log('   ⚙️ Config:', {
            model: this.config.model,
            language: this.config.language,
            sampleRate: this.config.sampleRate,
            encoding: 'linear16',
            channels: 1,
            interimResults: this.config.interimResults,
            utteranceEndMs: this.config.utteranceEndMs,
            endpointing: this.config.endpointing,
            vadEvents: true
        });
        
        try {
            // Create WebSocket connection to Deepgram
            log('🔍 About to call createDeepgramConnection()...');
            this.currentConnection = this.createDeepgramConnection();
            
            log('📡 Deepgram connection created successfully, setting up handlers...');
            log('   Connection type:', typeof this.currentConnection);
            log('   Has .on method:', typeof this.currentConnection?.on);
            
            // Handle connection open
            this.currentConnection.on('open', () => {
                log('✅ Deepgram WebSocket connection opened - ready for audio');
                
                // 🔥 PRE-WARM: Send initial audio to initialize VAD immediately (reduces first-word latency)
                setTimeout(() => this.preWarmDeepgram(), 100);
            });
            
            // Handle real-time transcription results
            this.currentConnection.on('Results', (data) => {
                this.handleTranscriptionResult(data);
            });
            
            // Also listen for 'transcript' event (SDK compatibility)
            this.currentConnection.on('transcript', (data) => {
                this.handleTranscriptionResult(data);
            });
            
            // Handle UtteranceEnd event (fired when speech gap detected)
            this.currentConnection.on('UtteranceEnd', (data) => {
                log('🔚 UtteranceEnd detected:', {
                    lastWordEnd: data.last_word_end,
                    timestamp: new Date().toISOString()
                });
                
                // Update speech state
                this.speechState.isSpeaking = false;
                this.speechState.lastUtteranceEnd = data.last_word_end;
                this.speechState.currentRequestId = null; // Reset for next request
                this.speechState.requestStartTime = null;
                this.stats.utteranceEndCount++;
                
                // Emit event for orchestrator
                this.emit('utterance-end', {
                    sessionId: this.sessionId,
                    lastWordEnd: data.last_word_end,
                    timestamp: new Date()
                });
            });
            
            // Handle SpeechStarted event (fired when speech begins after silence)
            this.currentConnection.on('SpeechStarted', (data) => {
                // Generate unique request ID for end-to-end tracking
                const requestId = `speech_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                const startTime = Date.now();
                
                log(`🎤 [${requestId}] SpeechStarted detected at ${startTime}`, {
                    timestamp: data.timestamp,
                    time: new Date().toISOString()
                });
                
                // Update speech state
                this.speechState.isSpeaking = true;
                this.speechState.lastSpeechStart = data.timestamp;
                this.speechState.currentRequestId = requestId;
                this.speechState.requestStartTime = startTime;
                this.stats.speechStartedCount++;
                
                // Emit event for orchestrator
                this.emit('speech-started', {
                    sessionId: this.sessionId,
                    requestId: requestId,
                    startTime: startTime,
                    speechTimestamp: data.timestamp,
                    timestamp: new Date()
                });

                // 🛑 VAD STUCK WATCHDOG: If speech started but no transcript follows in 2s, flush it.
                // This handles the case where VAD triggers on noise but ASR finds no words.
                if (this.flushTimer) clearTimeout(this.flushTimer);
                this.flushTimer = setTimeout(() => {
                    log('⏳ SpeechStarted but no transcript for 2s - injecting silence to flush...');
                    this.forceEndpointing();
                }, 2000);
            });
            
            // Handle metadata with full details
            this.currentConnection.on('Metadata', (metadata) => {
                log('📊 DEEPGRAM METADATA:', JSON.stringify(metadata, null, 2));
            });
            
            // Handle errors with full details
            this.currentConnection.on('error', (error) => {
                console.error('❌ DEEPGRAM ERROR:', JSON.stringify(error, null, 2));
                this.emit('transcription-error', {
                    sessionId: this.sessionId,
                    error: error.message,
                    timestamp: new Date()
                });
            });
            
            // Handle warnings with full details  
            this.currentConnection.on('warning', (warning) => {
                console.warn('⚠️ DEEPGRAM WARNING:', JSON.stringify(warning, null, 2));
            });
            
            this.currentConnection.on('close', (code, reason) => {
                console.error('🔌 [CRITICAL] Deepgram connection CLOSED:', { 
                    code, 
                    reason: reason?.toString(), 
                    timestamp: new Date().toISOString(),
                    wasTranscribing: this.isTranscribing,
                    hadKeepalive: !!this.keepaliveInterval,
                    isReconnecting: this.isReconnecting
                });
                console.warn('⚠️ Deepgram disconnected - will attempt auto-reconnect!');
                
                // 💓 Stop keepalive when connection closes
                this.stopKeepalive();
                
                // Clean up event listeners from closed connection
                if (this.currentConnection) {
                    try {
                        this.currentConnection.removeAllListeners();
                        log('   🧹 Cleaned up listeners from closed connection');
                    } catch (cleanupError) {
                        console.warn('   ⚠️ Error cleaning listeners:', cleanupError.message);
                    }
                }
                
                // Clear the current connection
                this.currentConnection = null;
                
                // Auto-reconnect after a brief delay to maintain session continuity
                if (this.isTranscribing && !this.isReconnecting) {
                    log('🔄 Attempting Deepgram reconnection in 500ms (fast recovery)...');
                    setTimeout(() => {
                        if (this.isTranscribing && !this.currentConnection) {
                            log('🔄 Auto-reconnecting to Deepgram...');
                            this.reconnectDeepgram();
                        }
                    }, 500); // 500ms for faster recovery
                }
            });
            
            // 🔄 START REAL KEEPALIVE - Send packets every 4 seconds during silence
            this.startKeepalive();
            
            log('✅ Deepgram connection handlers configured with REAL keepalive');
            
        } catch (error) {
            console.error('❌ Failed to start Deepgram transcription:', error.message);
            console.error('❌ Error stack:', error.stack);
            console.error('❌ Error details:', {
                name: error.name,
                message: error.message,
                hasV2: !!this.deepgram.listen.v2,
                listenMethods: Object.keys(this.deepgram.listen)
            });
            log('🔄 Falling back to OpenAI Realtime API...');
            this.useDeepgram = false;
            await this.startFallbackTranscription();
        }
    }
    
    async startFallbackTranscription() {
        log('🔄 Using OpenAI Realtime API for transcription (existing system)');
        // The existing OpenAI Realtime API system handles transcription
        // This layer will integrate with those results
        this.emit('fallback-transcription-ready', { sessionId: this.sessionId });
    }
    
    processAudioChunk(audioBuffer, timestamp) {
        if (!this.isTranscribing) {
            console.warn('⚠️ Transcription not active, ignoring audio chunk');
            return;
        }
        
        const processingStart = Date.now();
        
        if (this.useDeepgram && this.currentConnection) {
            try {
                // Send audio chunk to Deepgram
                this.currentConnection.send(audioBuffer);
                
                // 💓 Track when we last sent audio (for keepalive logic)
                this.lastAudioTime = Date.now();
                
                // Track chunk processing
                this.stats.chunksProcessed++;
                
                // 🔍 SMART WATCHDOG: Detect and Fix Stuck VAD
                // If we send audio but get NO transcripts (interim or final), Deepgram VAD is likely stuck on noise.
                // Solution: Inject silence to force endpointing (stream flushing).
                const timeSinceLastTranscript = this.lastTranscriptTime ? 
                    Date.now() - this.lastTranscriptTime : null;
                
                // Check every ~1 second (10 chunks)
                if (this.stats.chunksProcessed % 10 === 0 && timeSinceLastTranscript !== null) {
                    if (timeSinceLastTranscript > 8000) {
                        console.error(`🚨 [DEEPGRAM STUCK] No transcript for ${timeSinceLastTranscript}ms - FORCING RECONNECT`);
                        // Force immediate reconnection to unstick
                        this.reconnectDeepgram();
                        // Reset timer to prevent loop
                        this.lastTranscriptTime = Date.now(); 
                    } else if (timeSinceLastTranscript > 3000) {
                        log(`⚠️ [DEEPGRAM SLOW] No transcript for ${timeSinceLastTranscript}ms - Injecting silence to force flush...`);
                        this.forceEndpointing();
                        // Don't reset timer yet, see if it works. If not, 8s rule will hit.
                    }
                }
                
                // Log milestone chunks less frequently
                if (this.stats.chunksProcessed === 1 || this.stats.chunksProcessed % 100 === 0) {
                    log(`📊 [${this.sessionId}] Sent ${this.stats.chunksProcessed} audio chunks to Deepgram`);
                }
                
            } catch (error) {
                console.error('❌ [CRITICAL] Error sending audio to Deepgram:', error.message);
                console.error('❌ [CRITICAL] Connection details:', {
                    hasConnection: !!this.currentConnection,
                    connectionType: typeof this.currentConnection,
                    isTranscribing: this.isTranscribing,
                    chunksProcessed: this.stats.chunksProcessed
                });
            }
        } else {
            console.warn('⚠️ Deepgram not connected, audio chunk dropped');
        }
    }
    
    handleTranscriptionResult(data) {
        const processingTime = Date.now();
        
        try {
            // Verbose logging removed to prevent Railway rate limit
            // Only log on errors or final transcripts
            
            // Deepgram SDK v3+ structure - with proper defaults and trimming
            const alternative = data.channel?.alternatives?.[0] || 
                              data.results?.channels?.[0]?.alternatives?.[0];
            const transcript = alternative?.transcript?.trim() || '';
            const confidence = alternative?.confidence || 0;
            // Deepgram: speech_final=true means end of speech, is_final=true means final transcript
            const isFinal = data.speech_final === true || data.is_final === true;
            
            // Track when we receive transcripts (for stuck detection)
            this.lastTranscriptTime = Date.now();

            // 🔄 DEBOUNCED FLUSH: If we get an interim, schedule a forced flush
            // This prevents "hanging" utterances (like "Can...") from sticking for 10s
            if (!isFinal) {
                if (this.flushTimer) clearTimeout(this.flushTimer);
                this.flushTimer = setTimeout(() => {
                    log('⏳ Interim result stalled for 2s - injecting silence to flush...');
                    this.forceEndpointing();
                }, 2000);
            } else {
                // Final received, clear the safety flush
                if (this.flushTimer) clearTimeout(this.flushTimer);
            }
            
            // 🔍 DEBUG: Only log non-empty transcripts to reduce noise
            if (transcript && transcript.length > 0) {
                const requestId = this.speechState.currentRequestId || 'unknown';
                const latencyFromSpeech = this.speechState.requestStartTime ? 
                    Date.now() - this.speechState.requestStartTime : null;
                
                log(`🔍 [${requestId}] Transcript: "${transcript}", confidence: ${confidence.toFixed(2)}, isFinal: ${isFinal}, latency: ${latencyFromSpeech}ms`);
            }
            
            // ✅ FIX: Check for empty transcript (already trimmed in extraction)
            if (!transcript || transcript.length === 0) {
                // Empty finals are often Deepgram acknowledging Finalize - skip silently
                if (isFinal) {
                    // This is normal - Deepgram sends empty final after Finalize message
                    return;
                }
                // Empty interim - Nova-3 detected no speech, skip silently
                return; // Skip empty transcripts
            }
            
            // Calculate latency (approximate)
            const latency = processingTime - (data.start ? data.start * 1000 : processingTime);
            
            // ========================================
            // 🚀 CLUELY LOW-LATENCY: Process high-confidence interims immediately
            // ========================================
            // Let Orchestrator handle duplicate filtering and business logic
            // TranscriptionLayer role: emit all valid transcripts
            // ========================================
            const isProcessable = isFinal || (confidence > 0.5 && transcript.length > 2);

            if (!isProcessable) {
                // Low confidence or too short - Nova-3 uncertain, skip
                return;
            }
            
            
            // Update stats
            this.stats.totalLatency += Math.max(0, latency);
            this.stats.avgLatency = this.stats.totalLatency / (this.stats.chunksProcessed || 1);
            this.stats.transcriptLength += transcript.length;
            
            // Classify intent quickly
            const intentClassification = this.classifyIntent(transcript);
            
            // Emit transcription result
            const requestId = this.speechState.currentRequestId || 'unknown';
            const latencyFromSpeech = this.speechState.requestStartTime ? 
                Date.now() - this.speechState.requestStartTime : null;
            
            const transcriptData = {
                sessionId: this.sessionId,
                requestId: requestId,
                speechStartTime: this.speechState.requestStartTime,
                timestamp: new Date(processingTime),
                transcript: transcript,
                confidence: confidence || (transcript ? 0.95 : 0),
                isFinal: isFinal,  // Use actual Deepgram final flag
                isRealFinal: isFinal,     // Track actual finalization for debugging
                intentClassification,
                processingTimeMs: Math.max(0, latency),
                latencyFromSpeech: latencyFromSpeech,
                service: 'deepgram'
            };
            
            this.emit('transcription-result', transcriptData);
            
            // Log only final transcripts
            if (isFinal) {
                log(`📝 [${requestId}] FINAL "${transcript}" (${intentClassification})`);
                log(`   ⏱️ Latency: Deepgram=${Math.round(latency)}ms, FromSpeech=${latencyFromSpeech}ms`);
                
                // ❌ DON'T send Finalize - it closes the stream instead of resetting
                // Deepgram's VAD will automatically detect speech pauses and reset
            }
            
        } catch (error) {
            console.error('❌ Error processing transcription result:', error.message);
            console.error('   Stack:', error.stack);
            console.error('   Data was:', JSON.stringify(data).substring(0, 500));
        }
    }
    
    classifyIntent(transcript) {
        const text = transcript.toLowerCase();
        
        // Quick rule-based intent classification for gaming context
        const questionWords = ['what', 'where', 'how', 'when', 'why', 'which', 'who', 'can', 'should', 'is', 'are', 'do', 'does', 'help'];
        const commandWords = ['next', 'repeat', 'pause', 'resume', 'stop', 'skip', 'go', 'show', 'hide'];
        const urgentWords = ['help', 'stuck', 'lost', 'dead', 'dying', 'health', 'enemy', 'boss'];
        
        if (urgentWords.some(word => text.includes(word))) {
            return 'urgent_help';
        } else if (questionWords.some(word => text.startsWith(word + ' ') || text.includes(' ' + word + ' '))) {
            return 'question';
        } else if (commandWords.some(word => text.includes(word))) {
            return 'command';
        } else if (text.length > 5) {
            return 'conversation';
        }
        
        return 'unclear';
    }
    
    forceEndpointing() {
        if (!this.currentConnection) return;
        log('🤫 Injecting 500ms of silence to force Deepgram endpointing...');
        // Create 500ms of silence at 16kHz
        const silenceSamples = Math.floor(this.config.sampleRate * 0.5);
        const silenceBuffer = new Int16Array(silenceSamples).fill(0);
        try {
            this.currentConnection.send(silenceBuffer.buffer);
        } catch (e) {
            console.warn('⚠️ Failed to send silence frame:', e.message);
        }
    }

    startKeepalive() {
        // Clear any existing keepalive
        this.stopKeepalive();
        
        // Send keepalive packet every 4 seconds (within Deepgram's 3-5s recommendation, under 10s timeout)
        this.keepaliveInterval = setInterval(() => {
            if (this.currentConnection && this.isTranscribing) {
                try {
                    // Send keepalive and log for health monitoring
                    this.currentConnection.send(JSON.stringify({ type: 'KeepAlive' }));
                    log('💓 Keepalive sent (4s interval) - connection health OK');
                } catch (error) {
                    console.error('❌ Keepalive failed:', error.message);
                    console.error('   Connection is broken, triggering immediate reconnect');
                    // Connection is broken, trigger reconnect
                    this.reconnectDeepgram();
                }
            }
        }, 4000); // Every 4 seconds (Deepgram recommends 3-5s, timeout is 10s)
        
        log('💓 Keepalive timer started (4s intervals - within Deepgram 3-5s recommendation)');
    }
    
    stopKeepalive() {
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
            log('💓 Keepalive timer stopped');
        }
    }
    
    createDeepgramConnection() {
        // ✅ NOVA-3: Upgraded for better accuracy and word emission latency
        // NOTE: Flux (v2 endpoint) still not available in Node.js SDK - Python only
        log('🔍 Creating Deepgram connection (Nova-3, v1 endpoint)');
        
        return this.deepgram.listen.live({
            model: this.config.model,  // nova-3
            language: this.config.language,
            smart_format: this.config.smartFormat,
            interim_results: this.config.interimResults,
            utterance_end_ms: this.config.utteranceEndMs,  // Required for proper interim results
            endpointing: this.config.endpointing,  // VAD-based fast finalization (doesn't close connection)
            punctuate: this.config.punctuate,
            sample_rate: this.config.sampleRate,
            encoding: 'linear16',
            channels: 1,
            vad_events: true  // Enables SpeechStarted events
        });
    }
    
    preWarmDeepgram() {
        if (!this.currentConnection) {
            console.warn('⚠️ Cannot pre-warm: no active connection');
            return;
        }
        
        log('🔥 Pre-warming Deepgram VAD to reduce first-word latency...');
        
        // Send 300ms of very low-level noise to initialize VAD faster
        // This "teaches" Deepgram what silence sounds like in this environment
        // and gets the model ready to detect speech immediately
        const sampleRate = this.config.sampleRate; // 16000 Hz
        const duration = 0.3; // 300ms is sufficient for VAD initialization
        const samples = Math.floor(sampleRate * duration);
        
        // Generate low-level noise to initialize VAD (loud enough for Deepgram to detect)
        const warmupAudio = new Int16Array(samples);
        for (let i = 0; i < samples; i++) {
            // Moderate noise: -100 to +100 (loud enough for VAD detection, quiet enough not to transcribe)
            warmupAudio[i] = Math.floor(Math.random() * 200 - 100);
        }
        
        try {
            this.currentConnection.send(warmupAudio.buffer);
            log('✅ Deepgram VAD pre-warmed (300ms warmup audio sent)');
            log('   📊 Warmup audio size:', warmupAudio.buffer.byteLength, 'bytes');
        } catch (error) {
            console.warn('⚠️ Failed to pre-warm Deepgram:', error.message);
        }
    }
    
    async reconnectDeepgram() {
        if (!this.isTranscribing) {
            log('⏹️ Not transcribing, skipping reconnection');
            return;
        }
        
        // Prevent concurrent reconnection attempts
        if (this.isReconnecting) {
            log('⏸️ Already reconnecting, skipping duplicate reconnect attempt');
            return;
        }
        
        this.isReconnecting = true;
        
        try {
            log('🔄 Reconnecting to Deepgram...');
            
            // 🔧 CRITICAL: Clean up old connection to prevent event listener leaks
            if (this.currentConnection) {
                log('🧹 Cleaning up old connection before reconnecting...');
                try {
                    // Remove all event listeners to prevent stacking
                    this.currentConnection.removeAllListeners();
                    log('   ✅ Old event listeners removed');
                    
                    // Attempt graceful close
                    this.currentConnection.finish();
                    log('   ✅ Old connection closed');
                } catch (cleanupError) {
                    console.warn('   ⚠️ Error during old connection cleanup:', cleanupError.message);
                    // Continue anyway - we'll create new connection
                }
                this.currentConnection = null;
            }
            
            // Create new connection with clean state
            this.currentConnection = this.createDeepgramConnection();
            
            // Re-setup essential handlers
            this.currentConnection.on('open', () => {
                log('✅ Deepgram WebSocket reconnection successful');
                
                // 🔥 PRE-WARM: Re-initialize VAD after reconnection
                setTimeout(() => this.preWarmDeepgram(), 100);
            });
            
            // Handle transcription results
            this.currentConnection.on('Results', (data) => {
                this.handleTranscriptionResult(data);
            });
            
            // Also handle 'transcript' event
            this.currentConnection.on('transcript', (data) => {
                this.handleTranscriptionResult(data);
            });
            
            // Handle UtteranceEnd event
            this.currentConnection.on('UtteranceEnd', (data) => {
                log('🔚 UtteranceEnd detected (reconnected):', {
                    lastWordEnd: data.last_word_end,
                    timestamp: new Date().toISOString()
                });
                
                this.speechState.isSpeaking = false;
                this.speechState.lastUtteranceEnd = data.last_word_end;
                this.speechState.currentRequestId = null; // Reset for next request
                this.speechState.requestStartTime = null;
                this.stats.utteranceEndCount++;
                
                this.emit('utterance-end', {
                    sessionId: this.sessionId,
                    lastWordEnd: data.last_word_end,
                    timestamp: new Date()
                });
            });
            
            // Handle SpeechStarted event
            this.currentConnection.on('SpeechStarted', (data) => {
                // Generate unique request ID for end-to-end tracking
                const requestId = `speech_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                const startTime = Date.now();
                
                log(`🎤 [${requestId}] SpeechStarted detected (reconnected) at ${startTime}`, {
                    timestamp: data.timestamp,
                    time: new Date().toISOString()
                });
                
                this.speechState.isSpeaking = true;
                this.speechState.lastSpeechStart = data.timestamp;
                this.speechState.currentRequestId = requestId;
                this.speechState.requestStartTime = startTime;
                this.stats.speechStartedCount++;
                
                this.emit('speech-started', {
                    sessionId: this.sessionId,
                    requestId: requestId,
                    startTime: startTime,
                    speechTimestamp: data.timestamp,
                    timestamp: new Date()
                });
            });
            
            this.currentConnection.on('error', (error) => {
                console.error('❌ Deepgram reconnection error:', error.message);
            });
            
            // Handle future disconnects
            this.currentConnection.on('close', (code, reason) => {
                log('🔌 Deepgram connection closed again:', { code, reason: reason?.toString() });
                this.stopKeepalive(); // Stop keepalive on close
                this.currentConnection = null;
                if (this.isTranscribing) {
                    log('🔄 Scheduling another reconnection in 500ms (fast recovery)...');
                    setTimeout(() => this.reconnectDeepgram(), 500);
                }
            });
            
            // 💓 Restart keepalive after successful reconnection
            this.startKeepalive();
            
            log('✅ Deepgram reconnected with handlers and keepalive');
            this.isReconnecting = false; // Reset flag on success
            
        } catch (error) {
            console.error('❌ Failed to reconnect to Deepgram:', error.message);
            this.isReconnecting = false; // Reset flag on error
            
            if (this.isTranscribing) {
                log('🔄 Will retry reconnection in 1 second...');
                setTimeout(() => this.reconnectDeepgram(), 1000);
            }
        }
    }
    
    async stopTranscription() {
        if (!this.isTranscribing) {
            console.warn('⚠️ Transcription not running');
            return;
        }
        
        log('🛑 Stopping transcription');
        this.isTranscribing = false;
        
        // Clear duplicate tracking
        this.lastProcessedTranscript = null;
        this.lastProcessedTime = 0;
        this.lastTranscriptTime = null; // Reset transcript tracking
        
        // Reset speech state
        this.speechState = {
            isSpeaking: false,
            lastSpeechStart: null,
            lastUtteranceEnd: null,
            currentRequestId: null,
            requestStartTime: null
        };
        
        // 💓 Stop keepalive when stopping transcription
        this.stopKeepalive();
        
        // Clear debounced flush timer
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        
        // Reset reconnection flag
        this.isReconnecting = false;
        
        if (this.useDeepgram && this.currentConnection) {
            try {
                log('📤 Sending finish signal to Deepgram...');
                
                // Clean up event listeners before closing
                this.currentConnection.removeAllListeners();
                log('   🧹 Event listeners removed');
                
                this.currentConnection.finish();
                this.currentConnection = null;
                log('✅ Deepgram connection closed gracefully');
            } catch (error) {
                console.warn('⚠️ Error closing Deepgram connection:', error.message);
                this.currentConnection = null; // Ensure it's cleared even on error
            }
        }
        
        this.emit('transcription-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        this.sessionId = null;
    }
    
    // Integration point for existing OpenAI Realtime API transcriptions
    processOpenAITranscript(transcript, confidence) {
        if (!this.isTranscribing) return;
        
        const intentClassification = this.classifyIntent(transcript);
        
        this.emit('transcription-result', {
            sessionId: this.sessionId,
            timestamp: new Date(),
            transcript: transcript.trim(),  // Keep trim here as this comes from external source
            confidence: confidence || 0.90,
            isFinal: true,
            intentClassification,
            processingTimeMs: 250, // Estimated OpenAI latency
            service: 'openai'
        });
        
        log(`📝 OpenAI Transcription: "${transcript}"`);
        log(`   🎯 Intent: ${intentClassification}`);
    }
    
    getStats() {
        return {
            ...this.stats,
            isTranscribing: this.isTranscribing,
            service: this.useDeepgram ? 'deepgram' : 'openai',
            sessionId: this.sessionId,
            speechState: this.speechState,
            config: this.config
        };
    }
    
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        log('🔧 Transcription config updated:', newConfig);
        
        // Restart if running
        if (this.isTranscribing) {
            const sessionId = this.sessionId;
            this.stopTranscription();
            setTimeout(() => {
                this.startTranscription(sessionId);
            }, 100);
        }
    }
}

module.exports = TranscriptionLayer;
