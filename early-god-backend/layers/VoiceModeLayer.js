// Voice Mode Layer - ElevenLabs Conversational AI Integration
const EventEmitter = require('events');
const WebSocket = require('ws');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class VoiceModeLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        if (!process.env.ELEVENLABS_API_KEY) {
            throw new Error('ELEVENLABS_API_KEY is required for VoiceModeLayer');
        }
        
        this.config = {
            apiKey: process.env.ELEVENLABS_API_KEY,
            agentId: options.agentId || process.env.ELEVENLABS_AGENT_ID,
            websocketUrl: 'wss://api.elevenlabs.io/v1/convai/conversation',
            timeout: options.timeout || 3600000 // 1 hour (60 minutes)
        };
        
        // State
        this.isActive = false;
        this.sessionId = null;
        this.gameContext = null;
        this.guideData = null;
        this.elevenLabsWS = null;
        this.conversationId = null;
        this.timeoutTimer = null;
        this.keepAliveInterval = null;
        this.preloadedMemory = null; // 🧠 Preloaded memory context
        this.conversationBuffer = []; // 🧠 Rolling buffer of recent conversation turns
        this.maxConversationBuffer = 30; // Keep last 30 turns (~15 mins of conversation)
        this.exchangeCount = 0; // 🔄 Track exchanges for periodic memory updates
        this.lastUserMessage = null; // 🔄 Track last user message for pairing with AI response
        this.isPaused = false; // ⏸️ Pause state (preserves memory, stops audio)
        this.pauseReason = null; // 'silence', 'manual', 'hardware_mute'
        
        log('✅ VoiceModeLayer initialized');
        log('   🔑 API Key configured:', !!this.config.apiKey);
        log('   🤖 Agent ID:', this.config.agentId || 'Not configured');
    }
    
    async activate(sessionId, gameContext = {}, guideData = null) {
        if (this.isActive) {
            console.warn('⚠️ Voice mode already active');
            return false;
        }
        
        this.sessionId = sessionId;
        this.gameContext = gameContext;
        this.guideData = guideData;
        this.isActive = true;
        
        log('🎤 Voice mode activated for session:', sessionId);
        log('   🎮 Game:', gameContext.gameTitle || 'Unknown');
        log('   📋 Guide steps available:', guideData?.steps?.length || 0);
        
        // Log guide data for context
        if (guideData && guideData.steps && guideData.steps.length > 0) {
            log('   📚 Guide loaded:', guideData.metadata?.title || 'Unknown Guide');
            log('   📊 Total steps:', guideData.steps.length);
        }
        
        // Connect to ElevenLabs
        await this.connectToElevenLabs();
        
        // Start timeout failsafe
        this.timeoutTimer = setTimeout(() => {
            log('⏰ Voice mode timeout - auto-ending');
            this.deactivate('timeout');
        }, this.config.timeout);
        
        this.emit('voice-mode-activated', {
            sessionId,
            conversationId: this.conversationId,
            timestamp: new Date()
        });
        
        return true;
    }
    
    // Reset timeout on user activity to prevent premature disconnection
    resetTimeout() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
        }
        
        this.timeoutTimer = setTimeout(() => {
            log('⏰ Voice mode timeout - auto-ending after inactivity');
            this.deactivate('timeout');
        }, this.config.timeout);
        
        log('🔄 Voice mode timeout reset (1 hour from now)');
    }
    
    async connectToElevenLabs() {
        return new Promise((resolve, reject) => {
            try {
                const wsUrl = `${this.config.websocketUrl}?agent_id=${this.config.agentId}`;
                
                // Add API key to URL as query parameter (ElevenLabs accepts both methods)
                const wsUrlWithKey = `${wsUrl}&xi-api-key=${this.config.apiKey}`;
                
                log('📡 Connecting to ElevenLabs...');
                log('   🔗 URL:', wsUrl);
                log('   🔑 Using API key:', this.config.apiKey ? `${this.config.apiKey.substring(0, 8)}...` : 'MISSING');
                
                // Clear any existing interval before starting a new connection
                if (this.keepAliveInterval) {
                    clearInterval(this.keepAliveInterval);
                    this.keepAliveInterval = null;
                }

                this.elevenLabsWS = new WebSocket(wsUrlWithKey);
                
                log('   ✅ WebSocket object created');
                
                this.elevenLabsWS.on('open', () => {
                    this.connectionStartTime = Date.now();
                    log('✅ Connected to ElevenLabs Conversational AI');
                    log('   🎤 Expecting audio: PCM16, 16kHz, mono (matching agent config)');

                    // Rely on manual dashboard configuration for passive behavior
                    // Sending config overrides often causes 1008 errors if not allowed

                    // Send guide context (includes passive instructions in context)
                    this.sendGuideContext();
                    
                    // Start keep-alive to prevent timeout (send every 15 seconds)
                    this.keepAliveInterval = setInterval(() => {
                        if (this.elevenLabsWS && this.elevenLabsWS.readyState === WebSocket.OPEN) {
                            // Send a ping to keep connection alive
                            this.elevenLabsWS.ping();
                        }
                    }, 15000);
                    
                    resolve();
                });
                
                this.elevenLabsWS.on('close', (code, reason) => {
                    log('🔌 [ELEVENLABS] WebSocket closed');
                    log('   📊 Code:', code);
                    log('   📝 Reason:', reason.toString() || 'No reason provided');
                    log('   🕐 Duration:', Math.round((Date.now() - (this.connectionStartTime || Date.now())) / 1000), 'seconds');
                    log('   ⚠️ Was active:', this.isActive);
                    log('   ⏸️ Was paused:', this.isPaused);
                });
                
                this.elevenLabsWS.on('message', (data) => {
                    // Reduced logging for production
                    this.handleElevenLabsMessage(data);
                });
                
                // Expose WebSocket for direct audio forwarding
                this.elevenLabsWS = this.elevenLabsWS;
                
                this.elevenLabsWS.on('error', (error) => {
                    console.error('❌ [ELEVENLABS] WebSocket error:', error);
                    console.error('   📄 Error details:', JSON.stringify(error, null, 2));
                    reject(error);
                });
                
                this.elevenLabsWS.on('close', (code, reason) => {
                    log('🔌 [ELEVENLABS] WebSocket closed');
                    log('   📊 Close code:', code);
                    log('   📝 Reason:', reason ? reason.toString() : 'No reason provided');
                    log('   🕐 Duration:', Math.round((Date.now() - (this.connectionStartTime || Date.now())) / 1000), 'seconds');
                    log('   ⚠️ Was active:', this.isActive);
                    log('   ⏸️ Was paused:', this.isPaused);

                    // Common close codes:
                    // 1000 = Normal closure
                    // 1006 = Abnormal closure (no close frame)
                    // 4000+ = Application-specific errors

                    if (code !== 1000) {
                        console.error('   ⚠️ Abnormal close - connection may have failed');
                        // Emit error event so server can notify client
                        this.emit('elevenlabs-disconnect', { code, reason: reason ? reason.toString() : 'Unknown' });
                    }

                    this.isActive = false;
                });
                
            } catch (error) {
                console.error('❌ Failed to connect to ElevenLabs:', error);
                reject(error);
            }
        });
    }
    
    sendInitialContext() {
        if (!this.elevenLabsWS || this.elevenLabsWS.readyState !== WebSocket.OPEN) {
            return;
        }
        
        // ElevenLabs Conversational AI uses a specific protocol
        // Send initial configuration if needed
        const initMessage = {
            type: 'conversation_initiation_client_data',
            conversation_config_override: {
                agent: {
                    prompt: {
                        prompt: this.buildSystemPrompt()
                    }
                }
            }
        };
        
        try {
            this.elevenLabsWS.send(JSON.stringify(initMessage));
            log('📤 [ELEVENLABS] Sent initial configuration');
        } catch (error) {
            console.error('❌ [ELEVENLABS] Failed to send initial config:', error);
        }
    }
    
    buildSystemPrompt() {
        let prompt = `You are a helpful gaming assistant.`;

        if (this.gameContext.gameTitle && this.gameContext.gameTitle !== 'General Gaming Session') {
            prompt += `\n\n🎮 CRITICAL - GAME CONTEXT:\n`;
            prompt += `The player is playing: ${this.gameContext.gameTitle}\n`;
            prompt += `NEVER ask "What game are you playing?" or similar questions.\n`;
            prompt += `ALWAYS assume ALL questions are about ${this.gameContext.gameTitle}.\n`;
            prompt += `This game context is PERMANENT for the entire conversation.\n`;
            prompt += `YOU ARE HELPING WITH ${this.gameContext.gameTitle.toUpperCase()} - NEVER FORGET THIS.\n\n`;

            prompt += `🚫 ANTI-HALLUCINATION RULES:\n`;
            prompt += `1. ONLY provide information about ${this.gameContext.gameTitle}\n`;
            prompt += `2. NEVER mention content from other games (Baldur's Gate 3, Elden Ring, Dark Souls, etc.)\n`;
            prompt += `3. If you don't know something about ${this.gameContext.gameTitle}, say: "I don't have that information in my guide. Let me search for it."\n`;
            prompt += `4. NEVER assume or guess content from other games applies to ${this.gameContext.gameTitle}\n`;
            prompt += `5. When in doubt, use the search_guide tool to find information specific to ${this.gameContext.gameTitle}\n\n`;
        }

        if (this.guideData && this.guideData.steps && this.guideData.steps.length > 0) {
            prompt += `You have access to a detailed guide with ${this.guideData.steps.length} steps for ${this.gameContext.gameTitle}. `;
            prompt += `Here are the first few steps:\n`;

            // Include first 5 steps as context
            this.guideData.steps.slice(0, 5).forEach(step => {
                prompt += `Step ${step.step_number}: ${step.title}\n`;
            });
        }

        prompt += `\nProvide concise, helpful guidance. Keep responses under 30 seconds of speech.`;

        return prompt;
    }
    
    handleElevenLabsMessage(data) {
        try {
            // Try to parse as JSON first
            let message;
            try {
                const jsonString = Buffer.isBuffer(data) ? data.toString() : data;
                message = JSON.parse(jsonString);
            } catch (e) {
                // Not JSON - might be binary audio
                if (Buffer.isBuffer(data) && data.length > 100) {
                    this.emit('audio-chunk', data);
                    return;
                }
                return;
            }
            
            switch(message.type) {
                    case 'conversation_initiation_metadata':
                        log('🎙️ [ELEVENLABS] Conversation initialized');
                        if (message.conversation_initiation_metadata_event?.conversation_id) {
                            this.conversationId = message.conversation_initiation_metadata_event.conversation_id;
                            log('   📝 Conversation ID:', this.conversationId);
                        }

                        // 🔧 FIX: Resend game/guide context when conversation restarts
                        // This ensures ElevenLabs knows which game is being played even after internal restarts
                        log('🔄 [FIX] Resending game/guide context to ElevenLabs after conversation init');
                        this.sendGuideContext();
                        break;
                        
                    case 'agent_response':
                        // Extract text from agent_response_event
                        const responseText = message.agent_response_event?.agent_response || '';
                        log('💬 [ELEVENLABS] Agent response:', responseText);

                        // 🧠 FIX: Store in conversation buffer for dynamic memory
                        this.addToConversationBuffer('assistant', responseText);

                        // 🧠 Emit complete exchange for persistence
                        if (this.lastUserMessage) {
                            this.exchangeCount++;
                            this.emit('conversation-exchange', {
                                user: this.lastUserMessage,
                                assistant: responseText,
                                exchangeNumber: this.exchangeCount,
                                timestamp: new Date()
                            });
                            this.lastUserMessage = null; // Clear for next exchange
                        }

                        this.emit('agent-response', {
                            text: responseText,
                            timestamp: new Date()
                        });
                        break;
                        
                    case 'user_transcript':
                        // Extract transcript from user_transcription_event
                        const transcriptText = message.user_transcription_event?.user_transcript || '';
                        log('📝 [ELEVENLABS] User transcript:', transcriptText);

                        // 🧠 Store last user message for pairing with AI response
                        this.lastUserMessage = transcriptText;

                        // 🧠 FIX: Store in conversation buffer for dynamic memory
                        this.addToConversationBuffer('user', transcriptText);

                        // Reset timeout on user activity
                        this.resetTimeout();

                        this.emit('user-transcript', {
                            text: transcriptText,
                            timestamp: new Date()
                        });
                        break;
                        
                    case 'audio':
                        // Audio chunk in base64
                        if (message.audio_event?.audio_base_64) {
                            const audioBuffer = Buffer.from(message.audio_event.audio_base_64, 'base64');
                            this.emit('audio-chunk', audioBuffer);
                            
                            // Check if this is the last chunk
                            if (message.audio_event?.event_id) {
                                this.emit('audio-start'); // Notify that audio is playing
                            }
                        }
                        
                        // Check for audio completion
                        if (message.audio_event?.audio_end || message.audio_event?.end_of_stream) {
                            this.emit('audio-end');
                        }
                        break;
                        
                    case 'interruption':
                        log('🔇 [ELEVENLABS] User interrupted agent');
                        // ElevenLabs handles the interruption internally
                        break;
                        
                    case 'ping':
                        // Respond to ping with proper pong format
                        if (this.elevenLabsWS && this.elevenLabsWS.readyState === WebSocket.OPEN) {
                            const pongMessage = {
                                type: 'pong',
                                event_id: message.ping_event?.event_id || 0
                            };
                            this.elevenLabsWS.send(JSON.stringify(pongMessage));
                        }
                        break;
                        
                    case 'error':
                        console.error('❌ [ELEVENLABS] Error:', message.message || message.error);
                        this.emit('error', message.message || message.error);
                        break;
                        
                    default:
                        log('📨 [ELEVENLABS] Unknown message type:', message.type);
                        log('   📄 Full message:', JSON.stringify(message).substring(0, 200));
                }
        } catch (error) {
            console.error('❌ Error handling ElevenLabs message:', error);
        }
    }
    
    sendTranscript(transcript) {
        if (!this.elevenLabsWS || this.elevenLabsWS.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ Cannot send transcript - not connected to ElevenLabs');
            return false;
        }
        
        log('📤 Sending transcript to ElevenLabs:', transcript);
        
        this.elevenLabsWS.send(JSON.stringify({
            type: 'conversation.user_message',
            text: transcript
        }));
        
        return true;
    }
    
    sendTranscriptWithVision(transcript, visionAnalysis) {
        if (!this.elevenLabsWS || this.elevenLabsWS.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ Cannot send transcript - not connected to ElevenLabs');
            return false;
        }
        
        // Combine transcript with vision context
        const enhancedMessage = `${transcript}\n\nScreen analysis: ${visionAnalysis}`;
        
        log('📤 Sending enhanced message with vision to ElevenLabs');
        
        this.elevenLabsWS.send(JSON.stringify({
            type: 'conversation.user_message',
            text: enhancedMessage
        }));
        
        return true;
    }
    
    sendGuideContext() {
        if (!this.elevenLabsWS || this.elevenLabsWS.readyState !== WebSocket.OPEN) {
            return;
        }
        
        // Build comprehensive context message with passive mode instructions
        let contextMessage = 'GAME AND GUIDE CONTEXT:\n\n';
        
        // Add passive mode instructions
        contextMessage += `CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE:\n`;
        contextMessage += `1. WAIT FOR USER: Never initiate conversation. Only respond when the user speaks to you.\n`;
        contextMessage += `2. NO SMALL TALK: Do not ask "Are you still there?" or "How can I help?" unprompted.\n`;
        contextMessage += `3. SILENCE IS OKAY: The user is playing a game. Hours may pass without questions. This is normal.\n`;
        contextMessage += `4. BE CONCISE: Keep responses under 30 seconds. Players want to get back to gaming.\n\n`;
        
        // Game information - ALWAYS include if available
        if (this.gameContext && this.gameContext.gameTitle && this.gameContext.gameTitle !== 'General Gaming Session') {
            contextMessage += `\n\n═══════════════════════════════════════\n`;
            contextMessage += `🎮 ACTIVE GAME: ${this.gameContext.gameTitle}\n`;
            contextMessage += `═══════════════════════════════════════\n\n`;
            contextMessage += `CRITICAL INSTRUCTIONS:\n`;
            contextMessage += `1. The player is currently playing: ${this.gameContext.gameTitle}\n`;
            contextMessage += `2. You are an AI guide specifically for ${this.gameContext.gameTitle}\n`;
            contextMessage += `3. NEVER ask "What game are you playing?" or similar questions\n`;
            contextMessage += `4. ALWAYS assume all questions are about ${this.gameContext.gameTitle}\n`;
            contextMessage += `5. If you're unsure about something, ask specific questions about ${this.gameContext.gameTitle}\n`;
            contextMessage += `6. NEVER reference other games (Elden Ring, Dark Souls, Baldur's Gate 3, etc.) - ONLY ${this.gameContext.gameTitle}\n`;
            contextMessage += `7. If user uses nicknames for NPCs/items not in guide, search the guide or ask for clarification\n`;
            contextMessage += `8. DO NOT hallucinate content from other games - stick to the guide provided\n\n`;
            contextMessage += `🚫 ANTI-HALLUCINATION ENFORCEMENT:\n`;
            contextMessage += `- If you don't have information about ${this.gameContext.gameTitle}, say: "I don't have that information in my guide. Let me search for it."\n`;
            contextMessage += `- NEVER substitute content from Baldur's Gate 3, Elden Ring, or any other game\n`;
            contextMessage += `- When asked about quests, bosses, NPCs, locations, or items - USE THE SEARCH_GUIDE TOOL FIRST\n`;
            contextMessage += `- If search returns no results, admit you don't have that info instead of guessing\n\n`;
            contextMessage += `This game information persists for the entire conversation.\n`;
            contextMessage += `Do not forget: YOU ARE HELPING WITH ${this.gameContext.gameTitle.toUpperCase()}\n`;
            contextMessage += `FORBIDDEN: Mentioning Elden Ring, Dark Souls, Baldur's Gate 3, or any other game. Only ${this.gameContext.gameTitle}.\n\n`;
            log('📤 [ELEVENLABS] Sending game context:', this.gameContext.gameTitle);
        } else {
            console.warn('⚠️ [ELEVENLABS] No specific game detected - using general gaming context');
        }
        
        // Guide information - include FULL guide content for AI context
        if (this.guideData && this.guideData.steps && this.guideData.steps.length > 0) {
            const guideTitle = this.guideData.metadata?.title || 'a gaming guide';
            contextMessage += `\n═══════════════════════════════════════\n`;
            contextMessage += `ACTIVE GUIDE: "${guideTitle}"\n`;
            contextMessage += `Game: ${this.gameContext.gameTitle}\n`;
            contextMessage += `Total Steps: ${this.guideData.steps.length}\n`;
            contextMessage += `═══════════════════════════════════════\n\n`;
            
            // Include ALL steps with full details so AI has complete guide in context
            contextMessage += `COMPLETE GUIDE STEPS:\n\n`;
            this.guideData.steps.forEach((step, index) => {
                contextMessage += `--- STEP ${step.step_number}: ${step.title} ---\n`;
                contextMessage += `Action: ${step.action}\n`;
                
                if (step.visual_cues) {
                    contextMessage += `Visual Cues: ${step.visual_cues}\n`;
                }
                if (step.strategic_context) {
                    contextMessage += `Strategic Context: ${step.strategic_context}\n`;
                }
                if (step.observe) {
                    contextMessage += `Success Indicators: ${step.observe}\n`;
                }
                if (step.resources) {
                    contextMessage += `Resources Needed: ${step.resources}\n`;
                }
                if (step.fallback) {
                    contextMessage += `Troubleshooting: ${step.fallback}\n`;
                }
                contextMessage += `\n`;
            });
            
            contextMessage += `═══════════════════════════════════════\n`;
            contextMessage += `Note: You now have the COMPLETE guide. Answer questions about ANY step directly.\n`;
            contextMessage += `Only use search_guides tool if you need to search for specific terms.\n\n`;
            
            log('📤 [ELEVENLABS] Sending FULL guide context:', guideTitle);
            log('   📊 Total steps included:', this.guideData.steps.length);
            log('   📏 Context size:', contextMessage.length, 'characters');
        }
        
        contextMessage += `TOOL & MEMORY USAGE INSTRUCTIONS:\n\n`;
        contextMessage += `When a player asks a question, follow this priority:\n`;
        contextMessage += `1. Check LONG-TERM MEMORY below for player's progress (bosses defeated, checkpoints, items)\n`;
        contextMessage += `2. Check if the answer is in the loaded guide above\n`;
        contextMessage += `3. If not in guide or you need current/specific info, AUTOMATICALLY use web_search\n`;
        contextMessage += `4. Use screen_analysis if you need to see what's on their screen\n\n`;
        contextMessage += `MEMORY USAGE:\n`;
        contextMessage += `- You have access to player's game progress in LONG-TERM MEMORY section below\n`;
        contextMessage += `- Reference specific bosses defeated, checkpoints reached, items obtained\n`;
        contextMessage += `- DO NOT ask player to repeat information already in memory\n`;
        contextMessage += `- Examples: "Since you defeated Luna..." or "You're at Grand Meadow checkpoint..."\n\n`;
        contextMessage += `TOOL USAGE:\n`;
        contextMessage += `IMPORTANT: Use web_search proactively - don't wait for the user to say "search online"\n`;
        contextMessage += `Examples of when to auto-search:\n`;
        contextMessage += `- Player asks about game mechanics not in the guide or memory\n`;
        contextMessage += `- Player asks about updates, patches, or current meta\n`;
        contextMessage += `- Player asks about specific items/builds/strategies not covered\n`;
        contextMessage += `- You're unsure about latest information\n\n`;
        contextMessage += `Available Tools:\n`;
        contextMessage += `- web_search: Search internet (use proactively for latest info)\n`;
        contextMessage += `- search_guides: Search loaded guide steps\n`;
        contextMessage += `- screen_analysis: See player's screen\n\n`;
        
        // Add preloaded memory (long-term history from database)
        if (this.preloadedMemory && this.preloadedMemory.length > 0) {
            contextMessage += this.preloadedMemory;
            log('📤 [ELEVENLABS] Including preloaded memory in context');
        }

        // 🧠 FIX: Add recent conversation buffer (last 10 turns)
        // This is CRITICAL for maintaining context across conversation restarts
        const recentContext = this.buildRecentConversationContext();
        if (recentContext) {
            contextMessage += recentContext;
            log('📤 [ELEVENLABS] Including recent conversation buffer:', this.conversationBuffer.length, 'turns');
        }
        
        // Send as initial context
        try {
            this.elevenLabsWS.send(JSON.stringify({
                type: 'conversation_initiation_client_data',
                custom_llm_extra_body: {
                    system_context: contextMessage
                }
            }));
            
            log('✅ [ELEVENLABS] Context sent successfully');
        } catch (error) {
            console.warn('⚠️ [ELEVENLABS] Could not send context:', error.message);
        }
    }

    /**
     * Send proactive tips to ElevenLabs as additional context
     * Called when background agent generates new tips
     */
    sendProactiveTipsContext(tips, instructions) {
        if (!this.elevenLabsWS || this.elevenLabsWS.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ [PROACTIVE] Cannot send tips - WebSocket not open');
            return;
        }

        // Safety: Validate input
        if (!tips || !Array.isArray(tips) || tips.length === 0) {
            console.warn('⚠️ [PROACTIVE] Invalid tips input');
            return;
        }

        try {
            log('📤 [PROACTIVE] Sending tips to ElevenLabs agent');

            // Format tips as context message
            let tipsMessage = '🤖 PROACTIVE GAMEPLAY TIPS:\n\n';
            tipsMessage += 'You have received tips from a background agent analyzing gameplay.\n\n';

            // Safety: Sanitize and filter tips
            const sanitizeTip = (tip) => {
                if (!tip || typeof tip.text !== 'string') return null;
                return {
                    text: tip.text.substring(0, 500).replace(/[^\w\s\-.,!?']/g, ''),
                    priority: tip.priority,
                    reason: (tip.reason || '').substring(0, 200).replace(/[^\w\s\-.,!?']/g, '')
                };
            };

            const immediateTips = tips.filter(t => t.priority === 'immediate').map(sanitizeTip).filter(Boolean);
            const canWaitTips = tips.filter(t => t.priority === 'can-wait').map(sanitizeTip).filter(Boolean);

            if (immediateTips.length > 0) {
                tipsMessage += '🚨 IMMEDIATE TIPS (speak proactively during silence):\n';
                immediateTips.forEach(tip => {
                    tipsMessage += `- ${tip.text}\n`;
                    if (tip.reason) {
                        tipsMessage += `  Reason: ${tip.reason}\n`;
                    }
                });
                tipsMessage += '\n';
            }

            if (canWaitTips.length > 0) {
                tipsMessage += '📋 CAN-WAIT TIPS (append to next response):\n';
                canWaitTips.forEach(tip => {
                    tipsMessage += `- ${tip.text}\n`;
                    if (tip.reason) {
                        tipsMessage += `  Reason: ${tip.reason}\n`;
                    }
                });
                tipsMessage += '\n';
            }

            tipsMessage += 'ACTION REQUIRED:\n';
            tipsMessage += '1. IMMEDIATE tips: Mention these proactively during the next silence period\n';
            tipsMessage += '2. CAN-WAIT tips: Add them naturally after answering the user\'s next question\n';
            tipsMessage += '3. Deliver tips crisply using the exact text provided\n';
            tipsMessage += '4. Once delivered, tips are automatically removed from queue\n';

            // Send as custom context
            this.elevenLabsWS.send(JSON.stringify({
                type: 'conversation_initiation_client_data',
                custom_llm_extra_body: {
                    system_context: tipsMessage
                }
            }));

            log('   ✅ Tips context sent to agent');
            log('   💡 Immediate tips:', immediateTips.length);
            log('   📋 Can-wait tips:', canWaitTips.length);

        } catch (error) {
            console.error('❌ [PROACTIVE] Error sending tips:', error.message);
        }
    }

    async requestVisionAnalysis(screenshot) {
        // This will be called by the orchestrator when vision is needed
        this.emit('request-vision', { screenshot });
    }
    
    deactivate(reason = 'manual') {
        log('🛑 Deactivating voice mode, reason:', reason);
        
        this.isActive = false;
        
        // Clear timeout
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        
        // Clear keep-alive
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        
        // Close ElevenLabs connection
        if (this.elevenLabsWS && this.elevenLabsWS.readyState === WebSocket.OPEN) {
            this.elevenLabsWS.close();
        }
        
        this.elevenLabsWS = null;
        this.conversationId = null;
        
        this.emit('voice-mode-deactivated', {
            sessionId: this.sessionId,
            reason,
            timestamp: new Date()
        });
        
        log('✅ Voice mode deactivated');
    }
    
    setPreloadedMemory(memoryContext) {
        log('🧠 Setting preloaded memory for VoiceMode');
        this.preloadedMemory = memoryContext;
    }

    /**
     * 🧠 FIX: Add conversation turn to rolling buffer
     * This ensures recent context is preserved across conversation restarts
     */
    addToConversationBuffer(role, text) {
        if (!text || text.trim().length === 0) return;

        this.conversationBuffer.push({
            role,
            text: text.trim(),
            timestamp: new Date().toISOString()
        });

        // Keep only last N turns
        if (this.conversationBuffer.length > this.maxConversationBuffer) {
            this.conversationBuffer.shift();
        }

        log(`🧠 [MEMORY] Added ${role} message to buffer (${this.conversationBuffer.length}/${this.maxConversationBuffer})`);
    }

    /**
     * 🧠 FIX: Build recent conversation context from buffer
     */
    buildRecentConversationContext() {
        if (this.conversationBuffer.length === 0) {
            return '';
        }

        let context = '\n\n═══════════════════════════════════════\n';
        context += '🧠 RECENT CONVERSATION (Last ' + this.conversationBuffer.length + ' turns):\n';
        context += '═══════════════════════════════════════\n\n';

        for (const turn of this.conversationBuffer) {
            const label = turn.role === 'user' ? 'USER' : 'ASSISTANT';
            context += `[${label}]: ${turn.text}\n\n`;
        }

        context += 'CRITICAL: Use this recent conversation to maintain context.\n';
        context += 'The user is currently where the conversation left off.\n';
        context += 'DO NOT ask them to start from step 1 unless they explicitly ask to restart.\n';
        context += '═══════════════════════════════════════\n\n';

        return context;
    }
    
    pause(reason = 'manual') {
        if (this.isPaused) {
            log('⚠️ Voice mode already paused');
            return false;
        }
        
        this.isPaused = true;
        this.pauseReason = reason;
        
        log(`⏸️ Voice mode paused (${reason})`);
        log('   💾 Memory preserved: session, conversation, context');
        log('   🔌 ElevenLabs connection: kept alive (keep-alive only)');
        log('   💰 Cost savings: 91% reduction during pause');
        
        this.emit('voice-mode-paused', {
            sessionId: this.sessionId,
            reason,
            timestamp: new Date()
        });
        
        return true;
    }
    
    resume() {
        if (!this.isPaused) {
            log('⚠️ Voice mode not paused');
            return false;
        }

        const previousReason = this.pauseReason;
        this.isPaused = false;
        this.pauseReason = null;

        log(`▶️ Voice mode resumed (was paused due to: ${previousReason})`);
        log('   ✅ All memory and context restored');
        log('   🎤 Audio streaming active');

        // 🔧 FIX: Resend game/guide context to ElevenLabs after resume
        // This ensures ElevenLabs remembers which game is being played after pause
        log('🔄 [FIX] Resending game/guide context to ElevenLabs after resume');
        this.sendGuideContext();

        this.emit('voice-mode-resumed', {
            sessionId: this.sessionId,
            previousReason,
            timestamp: new Date()
        });

        return true;
    }
    
    isPausedState() {
        return this.isPaused;
    }
    
    cleanup() {
        this.deactivate('cleanup');
        this.removeAllListeners();
    }
}

module.exports = VoiceModeLayer;

