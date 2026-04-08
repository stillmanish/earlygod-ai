// Layer 6: Output Generation (250-400ms) - ElevenLabs Streaming TTS + Pre-cached Audio
// 
// 🔇 TTS CURRENTLY DISABLED - TEXT RESPONSES ONLY
// 
// TO RE-ENABLE AUDIO RESPONSES:
// 1. Set this.useTTS = true in constructor (line ~15)
// 2. Uncomment all TTS methods (marked with /* ... */)
// 3. Test with both OpenAI TTS and ElevenLabs
// 4. Deploy and verify audio generation works
//
// ALL TTS CODE IS PRESERVED - just commented out for stability
//
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class OutputGenerationLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // 🔇 TTS COMPLETELY DISABLED FOR NOW (will re-enable soon)
        // Only text responses needed currently - no audio generation
        this.useTTS = false; // TODO: Set to true when ready to implement audio responses
        this.useElevenLabs = false;
        log('🔇 TTS disabled - text responses only (audio generation commented out)');
        
        this.config = {
            voice: options.voice || 'alloy', // OpenAI TTS voice (alloy, echo, fable, onyx, nova, shimmer)
            model: options.model || 'tts-1', // OpenAI TTS model (tts-1 is fastest)
            speed: options.speed || 1.0, // Speech speed (0.25 to 4.0)
            streamChunkSize: options.streamChunkSize || 1024,
            maxConcurrentTTS: options.maxConcurrentTTS || 1, // Reduced for Railway memory limits
            cacheDirectory: options.cacheDirectory || path.join(process.env.TMPDIR || '/tmp', 'early_god_audio_cache'),
            // Removed fallback config - no fallbacks allowed
        };
        
        this.isActive = false;
        this.sessionId = null;
        this.activeTTSRequests = new Map();
        
        // Pre-cached MP3s for common phrases (Cluely optimization)
        this.preCache = new Map();
        this.initializePreCache();
        
        // Performance tracking
        this.stats = {
            audioGenerated: 0,
            totalGenerationTime: 0,
            avgGenerationTime: 0,
            cacheHits: 0,
            streamingGenerated: 0,
            fallbacksUsed: 0
        };
        
        log('🔇 OutputGenerationLayer initialized:', {
            ttsEnabled: this.useTTS,
            status: 'TTS DISABLED - text responses only',
            futureService: 'OpenAI TTS (when re-enabled)',
            voice: this.config.voice,
            model: this.config.model,
            speed: this.config.speed,
            cacheDir: this.config.cacheDirectory
        });
    }
    
    async start(sessionId) {
        if (this.isActive) {
            console.warn('⚠️ Output generation already active');
            return;
        }
        
        this.sessionId = sessionId;
        this.isActive = true;
        
        // Ensure cache directory exists
        await this.ensureCacheDirectory();
        
        log('🔊 Starting audio output generation for session:', sessionId);
        this.emit('output-started', { sessionId });
    }
    
    initializePreCache() {
        // Pre-cached common gaming phrases for instant playback (Cluely secret sauce)
        const commonPhrases = [
            'Enemy behind!',
            'Low health!',
            'Dodge now!',
            'Heal immediately!',
            'Boss fight!',
            'Multiple enemies!',
            'Take cover!',
            'Watch out!',
            'Good job!',
            'Check your health',
            'Use your items',
            'Save your progress',
            'Enemy ahead',
            'Turn around',
            'Look up'
        ];
        
        // Initialize cache map (actual audio will be generated on first use)
        commonPhrases.forEach(phrase => {
            this.preCache.set(phrase.toLowerCase(), {
                text: phrase,
                audioBuffer: null,
                generatedAt: null,
                hitCount: 0
            });
        });
        
        log(`💾 Pre-cache initialized with ${commonPhrases.length} common phrases`);
    }
    
    async processAIResponse(aiResponseData) {
        if (!this.isActive) return;
        
        const { response, context, situationAnalysis } = aiResponseData;
        const generationStart = Date.now();
        const requestId = `tts_${generationStart}_${Math.random().toString(36).substr(2, 9)}`;
        
        // 🔇 TTS DISABLED - Use original flow but skip audio generation
        if (!this.useTTS) {
            log(`📝 Processing AI text response [${requestId}] - TTS disabled: "${response.text}"`);
            
            // Create mock audio result with null audio but proper structure (preserves RAG compatibility)
            const mockAudioResult = {
                audioBuffer: null,
                format: null,
                source: 'disabled',
                voice: this.config.voice,
                model: this.config.model,
                streaming: false,
                textOnly: true // Flag to indicate text-only mode
            };
            
            // Use the existing handleGeneratedAudio flow for compatibility with RAG
            this.handleGeneratedAudio(mockAudioResult, response, generationStart);
            
            log(`✅ Text response processed [${Date.now() - generationStart}ms] - no audio`);
            return;
        }
        
        // 🔊 ORIGINAL TTS CODE (commented out but preserved for future use)
        // TODO: Uncomment when ready to implement audio responses
        /*
        try {
            log(`🔊 Processing TTS request [${requestId}]: "${response.text}"`);
            log(`   ⚡ Urgency: ${response.urgencyLevel}/5`);
            
            // Check pre-cache first for instant responses
            const cachedAudio = await this.checkPreCache(response.text);
            if (cachedAudio) {
                this.handleCachedAudio(cachedAudio, response, generationStart);
                return;
            }
            
            // Check concurrent TTS limit
            if (this.activeTTSRequests.size >= this.config.maxConcurrentTTS) {
                console.warn('⚠️ TTS request limit reached, queuing...');
                setTimeout(() => this.processAIResponse(aiResponseData), 100);
                return;
            }
            
            // Track active request
            this.activeTTSRequests.set(requestId, {
                startTime: generationStart,
                text: response.text,
                urgency: response.urgencyLevel
            });
            
            // Generate audio
            const audioResult = await this.generateAudio(response.text, response.urgencyLevel, requestId);
            
            // Clean up and emit result
            this.activeTTSRequests.delete(requestId);
            this.handleGeneratedAudio(audioResult, response, generationStart);
            
            // Cache popular phrases for future use
            if (response.urgencyLevel >= 4 || this.isCommonPhrase(response.text)) {
                await this.updatePreCache(response.text, audioResult.audioBuffer);
            }
            
        } catch (error) {
            this.activeTTSRequests.delete(requestId);
            console.error(`❌ [CRITICAL] TTS processing error - preventing crash:`, error.message);
            console.error(`❌ [CRITICAL] Stack:`, error.stack);
            
            // Prevent process crash by handling error gracefully
            try {
                this.handleTTSError(error, response, generationStart);
            } catch (handlerError) {
                console.error(`❌ [CRITICAL] Error handler also failed:`, handlerError.message);
                // Don't let error handler crash the process either
            }
        }
        */
    }
    
    async generateAudio(text, urgencyLevel, requestId) {
        // 🔇 TTS DISABLED - This method is commented out
        log(`🔇 generateAudio called but TTS is disabled - skipping audio generation`);
        return null;
        
        // 🔊 ORIGINAL AUDIO GENERATION (commented out but preserved for future use)
        // TODO: Uncomment when ready to implement audio responses
        /*
        const timeout = urgencyLevel >= 4 ? 3000 : 5000; // More realistic timeouts for OpenAI TTS
        
        // Using OpenAI TTS only (stable and reliable)
        return await this.generateOpenAIAudio(text, timeout, requestId);
        */
    }
    
    // 🔇 ALL TTS METHODS COMMENTED OUT (preserved for future use)
    // TODO: Uncomment when ready to implement audio responses
    
    /*
    // ElevenLabs generation method removed for deployment stability
    
    async generateOpenAIAudio(text, timeout, requestId, retryCount = 0) {
        log(`🔊 Generating OpenAI TTS [${requestId}]${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not available for TTS fallback');
        }
        
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                console.warn(`⚠️ OpenAI TTS timeout after ${timeout}ms for text: "${text.substring(0, 50)}..."`);
                reject(new Error(`OpenAI TTS timeout after ${timeout}ms`));
            }, timeout);
        });
        
        try {
            const ttsPromise = openai.audio.speech.create({
                model: this.config.model, // Use tts-1 for speed (configured in constructor)
                voice: this.config.voice, // Use configured voice (alloy)
                input: text,
                speed: this.config.speed // Use configured speed
            });
            
            const mp3Response = await Promise.race([ttsPromise, timeoutPromise]);
            const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());
            
            log(`✅ OpenAI TTS generated [${requestId}]${retryCount > 0 ? ` after ${retryCount} retries` : ''}`);
            
            return {
                audioBuffer,
                service: 'openai',
                voice: this.config.voice,
                model: this.config.model,
                streaming: false
            };
        } catch (error) {
            // Retry logic for timeouts (up to 1 retry to prevent infinite loops)
            if ((error.message.includes('timeout') || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') && retryCount < 1) {
                const backoffDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s backoff
                log(`🔄 Retrying OpenAI TTS in ${backoffDelay}ms (attempt ${retryCount + 1}/3) - Error: ${error.message}`);
                
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                return this.generateOpenAIAudio(text, timeout, requestId, retryCount + 1);
            }
            
            console.error(`❌ OpenAI TTS failed after ${retryCount + 1} attempts:`, error.message);
            throw error;
        }
    }
    */
    
    async checkPreCache(text) {
        const normalizedText = text.toLowerCase().trim();
        
        // Check exact matches first
        if (this.preCache.has(normalizedText)) {
            const cached = this.preCache.get(normalizedText);
            if (cached.audioBuffer) {
                cached.hitCount++;
                this.stats.cacheHits++;
                log(`⚡ Pre-cache hit: "${text}" (${cached.hitCount} hits)`);
                return cached;
            }
        }
        
        // Check for fuzzy matches for common phrases
        for (const [cachedText, cached] of this.preCache.entries()) {
            if (this.calculateSimilarity(normalizedText, cachedText) > 0.8 && cached.audioBuffer) {
                cached.hitCount++;
                this.stats.cacheHits++;
                log(`⚡ Pre-cache fuzzy hit: "${text}" -> "${cachedText}"`);
                return cached;
            }
        }
        
        return null;
    }
    
    calculateSimilarity(str1, str2) {
        // Simple similarity calculation
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }
    
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    async updatePreCache(text, audioBuffer) {
        const normalizedText = text.toLowerCase().trim();
        
        if (this.preCache.has(normalizedText)) {
            const cached = this.preCache.get(normalizedText);
            cached.audioBuffer = audioBuffer;
            cached.generatedAt = Date.now();
            log(`💾 Pre-cache updated: "${text}"`);
        } else if (this.isCommonPhrase(text)) {
            // Add new common phrase to cache
            this.preCache.set(normalizedText, {
                text: text,
                audioBuffer: audioBuffer,
                generatedAt: Date.now(),
                hitCount: 0
            });
            log(`💾 Pre-cache added: "${text}"`);
        }
        
        // Save to disk for persistence
        await this.saveCacheToDisK();
    }
    
    isCommonPhrase(text) {
        const commonWords = ['enemy', 'health', 'heal', 'dodge', 'boss', 'help', 'watch', 'look', 'use'];
        const lowercaseText = text.toLowerCase();
        
        return commonWords.some(word => lowercaseText.includes(word)) && text.length < 50;
    }
    
    handleCachedAudio(cached, response, startTime) {
        const generationTime = Date.now() - startTime;
        
        log(`⚡ Instant audio: "${response.text}" [${generationTime}ms]`);
        
        this.emitAudioGenerated({
            audioBuffer: cached.audioBuffer,
            text: response.text,
            generationTime,
            fromCache: true,
            service: 'cache',
            voice: 'cached',
            urgencyLevel: response.urgencyLevel
        });
    }
    
    handleGeneratedAudio(audioResult, response, startTime) {
        const generationTime = Date.now() - startTime;
        
        // Handle both audio and text-only responses
        if (audioResult.textOnly || !audioResult.audioBuffer) {
            log(`📝 Text-only response: "${response.text}" [${generationTime}ms]`);
            log(`   🔇 TTS disabled - no audio generated`);
        } else {
            log(`🔊 Audio generated: "${response.text}" [${generationTime}ms]`);
            log(`   🎤 Service: ${audioResult.service}, Voice: ${audioResult.voice}`);
            log(`   💾 Size: ${(audioResult.audioBuffer.length / 1024).toFixed(1)}KB`);
        }
        
        this.updateStats(generationTime, audioResult.service);
        
        this.emitAudioGenerated({
            audioBuffer: audioResult.audioBuffer, // Can be null for text-only
            text: response.text,
            generationTime,
            fromCache: false,
            service: audioResult.service,
            voice: audioResult.voice,
            model: audioResult.model,
            urgencyLevel: response.urgencyLevel,
            streaming: audioResult.streaming,
            textOnly: audioResult.textOnly || !audioResult.audioBuffer
        });
    }
    
    handleTTSError(error, response, startTime) {
        const generationTime = Date.now() - startTime;
        
        console.error(`❌ TTS generation error [${generationTime}ms]:`, error.message);
        
        this.stats.fallbacksUsed++;
        
        // NO FALLBACK - Let TTS errors surface properly 
        this.emitTTSError(error, response, generationTime);
    }
    
    updateStats(generationTime, service) {
        this.stats.audioGenerated++;
        this.stats.totalGenerationTime += generationTime;
        this.stats.avgGenerationTime = this.stats.totalGenerationTime / this.stats.audioGenerated;
        
        // Stats tracking for audio service (including disabled TTS)
        if (service === 'openai' || service === 'disabled') {
            this.stats.streamingGenerated++;
        }
        
        // Log performance every 25 generations
        if (this.stats.audioGenerated % 25 === 0) {
            log(`📊 Audio generation: ${this.stats.audioGenerated} generated, ${this.stats.cacheHits} cached, avg ${Math.round(this.stats.avgGenerationTime)}ms`);
        }
    }
    
    emitAudioGenerated(audioData) {
        this.emit('audio-generated', {
            sessionId: this.sessionId,
            audio: audioData,
            timestamp: new Date()
        });
        
        // Emit urgent audio separately for immediate playback
        if (audioData.urgencyLevel >= 4) {
            this.emit('urgent-audio', {
                sessionId: this.sessionId,
                audio: audioData,
                urgencyLevel: audioData.urgencyLevel
            });
        }
    }
    
    emitTTSError(error, response, generationTime) {
        this.emit('tts-error', {
            sessionId: this.sessionId,
            error: error.message,
            text: response.text,
            generationTime,
            urgencyLevel: response.urgencyLevel
        });
    }
    
    async ensureCacheDirectory() {
        try {
            if (!fs.existsSync(this.config.cacheDirectory)) {
                fs.mkdirSync(this.config.cacheDirectory, { recursive: true });
                log(`📁 Created audio cache directory: ${this.config.cacheDirectory}`);
            }
        } catch (error) {
            console.warn('⚠️ Could not create audio cache directory:', error.message);
        }
    }
    
    async saveCacheToDisK() {
        try {
            const cacheData = {};
            for (const [key, value] of this.preCache.entries()) {
                if (value.audioBuffer) {
                    const filename = `${key.replace(/[^a-z0-9]/g, '_')}.mp3`;
                    const filepath = path.join(this.config.cacheDirectory, filename);
                    
                    if (!fs.existsSync(filepath)) {
                        fs.writeFileSync(filepath, value.audioBuffer);
                    }
                    
                    cacheData[key] = {
                        text: value.text,
                        filename: filename,
                        generatedAt: value.generatedAt,
                        hitCount: value.hitCount
                    };
                }
            }
            
            const cacheIndexPath = path.join(this.config.cacheDirectory, 'cache_index.json');
            fs.writeFileSync(cacheIndexPath, JSON.stringify(cacheData, null, 2));
            
            log(`💾 Saved ${Object.keys(cacheData).length} cached audio files`);
        } catch (error) {
            console.warn('⚠️ Could not save audio cache:', error.message);
        }
    }
    
    async loadCacheFromDisk() {
        try {
            const cacheIndexPath = path.join(this.config.cacheDirectory, 'cache_index.json');
            
            if (fs.existsSync(cacheIndexPath)) {
                const cacheData = JSON.parse(fs.readFileSync(cacheIndexPath, 'utf8'));
                
                for (const [key, data] of Object.entries(cacheData)) {
                    const filepath = path.join(this.config.cacheDirectory, data.filename);
                    
                    if (fs.existsSync(filepath)) {
                        const audioBuffer = fs.readFileSync(filepath);
                        this.preCache.set(key, {
                            text: data.text,
                            audioBuffer: audioBuffer,
                            generatedAt: data.generatedAt,
                            hitCount: data.hitCount
                        });
                    }
                }
                
                log(`📂 Loaded ${Object.keys(cacheData).length} cached audio files from disk`);
            }
        } catch (error) {
            console.warn('⚠️ Could not load audio cache from disk:', error.message);
        }
    }
    
    async stop() {
        if (!this.isActive) {
            console.warn('⚠️ Output generation not active');
            return;
        }
        
        log('🛑 Stopping audio output generation');
        this.isActive = false;
        
        // Cancel active TTS requests
        for (const [requestId, request] of this.activeTTSRequests) {
            log(`🚫 Canceling TTS request: ${requestId}`);
        }
        this.activeTTSRequests.clear();
        
        // Save cache before stopping
        await this.saveCacheToDisK();
        
        this.emit('output-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        this.sessionId = null;
    }
    
    getStats() {
        return {
            ...this.stats,
            isActive: this.isActive,
            sessionId: this.sessionId,
            activeTTSRequests: this.activeTTSRequests.size,
            preCacheSize: this.preCache.size,
            service: 'openai',
            config: this.config
        };
    }
    
    getCacheStats() {
        const cacheStats = {};
        for (const [key, value] of this.preCache.entries()) {
            cacheStats[key] = {
                hitCount: value.hitCount,
                hasAudio: !!value.audioBuffer,
                generatedAt: value.generatedAt
            };
        }
        return cacheStats;
    }
    
    async preGenerateCommonPhrases() {
        log('🎯 Pre-generating common phrases for cache...');
        
        const phrasesToGenerate = Array.from(this.preCache.entries())
            .filter(([_, cached]) => !cached.audioBuffer)
            .slice(0, 5); // Generate 5 at a time to avoid rate limits
        
        for (const [text, cached] of phrasesToGenerate) {
            try {
                log(`🎯 Pre-generating: "${cached.text}"`);
                const audioResult = await this.generateAudio(cached.text, 2, 'pre-gen');
                await this.updatePreCache(cached.text, audioResult.audioBuffer);
                
                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.warn(`⚠️ Failed to pre-generate "${cached.text}":`, error.message);
            }
        }
        
        log(`✅ Pre-generation completed`);
    }
}

module.exports = OutputGenerationLayer;
