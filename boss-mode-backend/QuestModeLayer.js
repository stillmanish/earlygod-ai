// Quest Mode Layer - Real-time quest progress tracking and guidance
const EventEmitter = require('events');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class QuestModeLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required for QuestModeLayer');
        }
        
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Use Gemini 2.5 Pro for deep quest progress analysis and strategic guidance
        this.model = this.genAI.getGenerativeModel({ 
            model: options.model || "gemini-2.5-pro"
        });
        
        this.config = {
            screenshotInterval: options.screenshotInterval || 2000,     // Request every 2s
            guidanceInterval: options.guidanceInterval || 60000,        // Generate every 60s (1 minute) for quest updates
            maxQueueSize: options.maxQueueSize || 10,                   // Keep last 10 screenshots (5 minutes of context)
            screenshotsToAnalyze: options.screenshotsToAnalyze || 5,    // Analyze last 5 screenshots for progression tracking
            maxOutputTokens: options.maxOutputTokens || 8192,           // Allow detailed responses
            temperature: options.temperature || 0.3,                     // Lower temperature for more grounded responses
            questTimeout: options.questTimeout || 3600000               // 60 minute max (longer than boss mode)
        };
        
        // Quest mode state
        this.isActive = false;
        this.sessionId = null;
        this.gameContext = null;
        this.guideData = null;  // RAG guide for quest progress tracking
        
        // Screenshot queue (non-blocking buffer)
        this.screenshotQueue = [];
        
        // Timers
        this.screenshotRequestTimer = null;
        this.guidanceGenerationTimer = null;
        this.timeoutTimer = null;
        
        // Quest progress tracking
        this.questState = {
            startTime: null,
            lastKnownStep: null,
            updateCount: 0,
            screenshotCount: 0
        };
        
        // Guidance memory (track last 10 messages to avoid repetition and provide context)
        this.guidanceHistory = [];
        
        log('📍 QuestModeLayer initialized:', {
            model: options.model || "gemini-2.5-pro",
            screenshotInterval: `${this.config.screenshotInterval}ms`,
            guidanceInterval: `${this.config.guidanceInterval}ms`,
            maxQueueSize: this.config.maxQueueSize,
            screenshotsToAnalyze: this.config.screenshotsToAnalyze,
            temperature: this.config.temperature
        });
    }
    
    async activate(sessionId, gameContext = {}, guideData = null) {
        if (this.isActive) {
            console.warn('⚠️ Quest mode already active');
            return false;
        }
        
        this.sessionId = sessionId;
        this.gameContext = gameContext;
        this.guideData = guideData;  // Store RAG guide for context
        this.isActive = true;
        
        // Reset quest state and guidance history
        this.questState = {
            startTime: Date.now(),
            lastKnownStep: null,
            updateCount: 0,
            screenshotCount: 0
        };
        this.guidanceHistory = []; // Start fresh each quest session
        
        log('📍 Quest mode activated for session:', sessionId);
        log('   🎮 Game:', gameContext.gameTitle || 'Unknown');
        log('   📋 Guide steps available:', guideData?.steps?.length || 0);
        
        // Start screenshot request loop (every 2s)
        this.startScreenshotLoop();
        
        // Start guidance generation loop (every 60s)
        this.startGuidanceLoop();
        
        // Start timeout failsafe
        this.timeoutTimer = setTimeout(() => {
            log('⏰ Quest mode timeout (60 minutes) - auto-ending');
            this.deactivate('timeout');
        }, this.config.questTimeout);
        
        // Generate initial briefing from RAG guide
        await this.generateInitialBriefing();
        
        this.emit('quest-mode-activated', {
            sessionId,
            gameContext,
            timestamp: new Date()
        });
        
        return true;
    }
    
    async generateInitialBriefing() {
        try {
            if (this.guideData && this.guideData.steps && this.guideData.steps.length > 0) {
                // Use ALL available quest steps for maximum RAG context
                const allSteps = this.guideData.steps
                    .map((step, idx) => `Step ${idx + 1}: ${step.action || step.title || step.description}`)
                    .filter(s => s && s.length > 0);
                
                // Message 1: Quest Mode Activation
                let message1 = '📍 QUEST MODE ACTIVATED';
                if (this.guideData.metadata?.title || this.gameContext.gameTitle) {
                    message1 += `\nGuide: ${this.guideData.metadata?.title || this.gameContext.gameTitle}`;
                }
                message1 += '\nReal-time quest progress tracking active. I will analyze your gameplay and guide you through the quest steps.';
                
                // Message 2: Quest Overview (first few steps)
                const firstSteps = allSteps.slice(0, 3).join('\n');
                let message2 = `📋 QUEST OVERVIEW\n${firstSteps}`;
                if (allSteps.length > 3) {
                    message2 += `\n... and ${allSteps.length - 3} more steps`;
                }
                
                // Message 3: Tracking info
                let message3 = '⚡ QUEST TRACKING\n';
                message3 += `Total steps: ${this.guideData.steps.length}\n`;
                message3 += 'I will check your progress every minute and provide guidance based on your current location and the quest guide.';
                
                // Emit messages with delays
                this.emitBriefingMessage(message1, 0);      // Immediate
                this.emitBriefingMessage(message2, 1500);   // 1.5s delay  
                this.emitBriefingMessage(message3, 3000);   // 3s delay
                
            } else {
                // Fallback messages without RAG data
                this.emitBriefingMessage('📍 QUEST MODE ACTIVATED\nReal-time quest progress tracking active. Waiting for quest guide data...', 0);
            }
            
            log('📋 Initial briefing sequence started');
            
        } catch (error) {
            console.error('❌ Failed to generate initial briefing:', error.message);
        }
    }
    
    emitBriefingMessage(message, delay) {
        setTimeout(() => {
            this.emit('quest-briefing', {
                sessionId: this.sessionId,
                briefing: message,
                timestamp: new Date()
            });
        }, delay);
    }
    
    async deactivate(reason = 'manual') {
        if (!this.isActive) {
            console.warn('⚠️ Quest mode not active');
            return false;
        }
        
        log('🛑 Deactivating quest mode, reason:', reason);
        
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
        
        const duration = Date.now() - this.questState.startTime;
        const stats = {
            duration: Math.round(duration / 1000),
            updateCount: this.questState.updateCount,
            screenshotCount: this.questState.screenshotCount
        };
        
        log('📊 Quest mode stats:', stats);
        
        this.isActive = false;
        
        this.emit('quest-mode-deactivated', {
            sessionId: this.sessionId,
            reason,
            stats,
            timestamp: new Date()
        });
        
        // Generate summary
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
        log('📍 Starting quest update generation loop (every 60s)');
        
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
        
        this.questState.screenshotCount++;
        
        log(`📸 [QUEST] Screenshot queued: ${this.screenshotQueue.length}/${this.config.maxQueueSize}`);
    }
    
    async generateGuidance() {
        try {
            // Get multiple screenshots for progression analysis
            const numToAnalyze = Math.min(this.config.screenshotsToAnalyze, this.screenshotQueue.length);
            if (numToAnalyze === 0) return;
            
            // Get last N screenshots from queue
            const screenshots = this.screenshotQueue.slice(-numToAnalyze);
            
            log(`📍 [QUEST] Generating quest update from ${screenshots.length} screenshot${screenshots.length > 1 ? 's' : ''}...`);
            const guidanceStart = Date.now();
            
            // Build quest tracking prompt with MAXIMUM RAG usage and multi-screenshot analysis
            const prompt = this.buildQuestGuidancePrompt(screenshots.length);
            
            // Build parts array: prompt text followed by all screenshot images
            const parts = [{ text: prompt }];
            
            // Add all screenshots as inline data
            for (let i = 0; i < screenshots.length; i++) {
                parts.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: screenshots[i].image
                    }
                });
            }
            
            // Call Gemini 2.5 Pro Vision API with multiple screenshots
            const result = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: parts
                }],
                generationConfig: {
                    temperature: this.config.temperature,
                    maxOutputTokens: this.config.maxOutputTokens,
                    topK: 20,      // Increased for better sampling with Pro model
                    topP: 0.85     // Increased for more diverse quality responses
                }
            });
            
            const response = await result.response;
            const guidance = response.text().trim();
            
            const guidanceTime = Date.now() - guidanceStart;
            
            // Debug: Log full response details
            if (!guidance || guidance.length === 0) {
                console.error('❌ [QUEST] Empty guidance received!');
                console.error('   Full result:', JSON.stringify(result, null, 2).substring(0, 500));
                return; // Skip empty guidance
            }
            
            log(`📍 [QUEST] Quest update generated in ${guidanceTime}ms:`, guidance.substring(0, 100));
            
            // 🔒 ENHANCED RAG VALIDATION: Verify response adheres to guide
            const validationResult = this.validateGuidanceRAG(guidance);
            if (!validationResult.valid) {
                console.error(`❌ [QUEST] RAG validation failed: ${validationResult.reason}`);
                console.error(`   Rejected guidance: ${guidance.substring(0, 200)}`);
                return; // Skip invalid/hallucinated guidance
            }
            
            log(`✅ [QUEST] RAG validation passed - guidance grounded in guide step ${validationResult.stepNumber}`);
            
            // Emit quest update (with [Quest] prefix added in frontend)
            this.emit('quest-update', {
                sessionId: this.sessionId,
                guidance: guidance.trim(),
                timestamp: new Date(),
                generationTime: guidanceTime
            });
            
            this.questState.updateCount++;
            
            // Store in guidance history (keep last 10 for context)
            this.guidanceHistory.push(guidance);
            if (this.guidanceHistory.length > 10) {
                this.guidanceHistory.shift();
            }
            
        } catch (error) {
            console.error('❌ Quest guidance generation error:', error.message);
            console.error('❌ Stack:', error.stack);
            // Continue - don't break quest mode on single error
        }
    }
    
    validateGuidanceRAG(guidance) {
        // Simple validation to ensure guidance is grounded in the quest guide (high RAG score)
        // Keep it minimal to avoid rejecting valid responses
        
        // 1. Check if guidance cites a step number (CRITICAL for RAG)
        const stepMatch = guidance.match(/step (\d+)/i);
        if (!stepMatch) {
            return {
                valid: false,
                reason: 'No step number cited from guide'
            };
        }
        
        const stepNum = parseInt(stepMatch[1]);
        const maxSteps = this.guideData?.steps?.length || 0;
        
        // 2. Verify step number is within valid range (CRITICAL for RAG)
        if (stepNum < 1 || stepNum > maxSteps) {
            return {
                valid: false,
                reason: `Invalid step number ${stepNum} (guide has ${maxSteps} steps)`,
                stepNumber: stepNum
            };
        }
        
        // 3. Verify the cited step exists in guide data
        const citedStep = this.guideData?.steps?.[stepNum - 1];
        if (!citedStep) {
            return {
                valid: false,
                reason: `Step ${stepNum} not found in guide data`,
                stepNumber: stepNum
            };
        }
        
        // That's it! Keep validation simple - the strong prompt instructions handle the rest
        const wordCount = guidance.split(/\s+/).length;
        
        return {
            valid: true,
            stepNumber: stepNum,
            citedStep: citedStep,
            wordCount: wordCount
        };
    }
    
    buildQuestGuidancePrompt(numScreenshots = 1) {
        const gameTitle = this.gameContext.gameTitle || 'game';
        
        // Build COMPLETE guide context with ALL steps (MAXIMUM RAG usage with ENHANCED DETAILS)
        let guideContext = '';
        if (this.guideData && this.guideData.steps && this.guideData.steps.length > 0) {
            // Include ALL steps with RICH details for comprehensive grounding
            const allSteps = this.guideData.steps
                .map((step, idx) => {
                    let stepText = `Step ${idx + 1}: ${step.title || 'Untitled'}
Action: ${step.action || step.description || 'No action specified'}`;
                    
                    // Add visual cues if available (critical for AI to match screenshots)
                    if (step.visual_cues) {
                        stepText += `\nVisual Cues: ${step.visual_cues}`;
                    }
                    
                    // Add strategic context if available (helps AI understand importance)
                    if (step.strategic_context) {
                        stepText += `\nWhy This Matters: ${step.strategic_context}`;
                    }
                    
                    // Add observe/resources if available
                    if (step.observe) {
                        stepText += `\nSuccess Indicators: ${step.observe}`;
                    }
                    if (step.resources) {
                        stepText += `\nRequired: ${step.resources}`;
                    }
                    
                    return stepText;
                })
                .join('\n\n');
            guideContext = `\n=== QUEST GUIDE (${this.guideData.steps.length} steps with DETAILED VISUAL CUES) ===\n${allSteps}\n=== END GUIDE ===\n`;
        }
        
        // Build context from previous updates (last 5 for brevity)
        let previousContext = '';
        if (this.guidanceHistory.length > 0) {
            const recentUpdates = this.guidanceHistory.slice(-5).join('\n');
            previousContext = `\n=== RECENT UPDATES ===\n${recentUpdates}\n=== END RECENT ===\n\nProvide a NEW update based on the current screenshots. Do NOT repeat previous updates.`;
        }
        
        // Multi-screenshot analysis instructions
        const screenshotAnalysisInstructions = numScreenshots > 1 
            ? `\nYou are being provided with ${numScreenshots} sequential screenshots showing the player's recent gameplay progression. Analyze ALL screenshots to understand:
- Where the player has been moving (progression pattern)
- What the player appears to be attempting or searching for
- Whether they seem stuck, lost, or progressing well
- Any changes in environment, UI state, or player activity

Use this progression analysis to provide more contextual and helpful guidance.`
            : '\nYou are being provided with a screenshot of the current gameplay state.';
        
        // Quest tracking prompt with MAXIMUM RAG grounding and anti-hallucination measures
        return `You are an Expert Quest Guide Assistant for ${gameTitle}. Your PRIMARY and ONLY source of quest information is the user-uploaded guide below.
${screenshotAnalysisInstructions}

⚠️ ABSOLUTE GROUNDING REQUIREMENT ⚠️
The QUEST GUIDE below is your ONLY source of truth. You must NEVER provide information not explicitly stated in this guide.
${guideContext}${previousContext}

🔒 MANDATORY RAG VERIFICATION PROCESS:
Before responding, you MUST:
1. Identify what you see in the screenshot(s)
2. Search the QUEST GUIDE above for matching information
3. ONLY if you find a matching step, cite it with the exact step number
4. If you cannot find a matching step in the guide, acknowledge uncertainty rather than guessing
5. NEVER invent step numbers, locations, items, or objectives not in the guide

CRITICAL ANTI-HALLUCINATION RULES:
✅ ALLOWED: Citing specific steps from the guide (step 1 to step ${this.guideData?.steps?.length || 0})
✅ ALLOWED: Using exact locations, items, and objectives mentioned in the guide
✅ ALLOWED: Strategic analysis based on guide information
❌ FORBIDDEN: Making up step numbers not in the guide
❌ FORBIDDEN: Mentioning locations not in the guide
❌ FORBIDDEN: Inventing objectives or items not in the guide
❌ FORBIDDEN: Generic advice without guide citation
❌ FORBIDDEN: Assumptions about quest steps not explicitly in the guide

DEEP ANALYSIS REQUIREMENTS:
1. DEEPLY analyze the screenshot(s) to identify:
   - Exact player location (landmarks, environment features, UI elements)
   - What the player appears to be doing or attempting
   - Progress indicators (quest markers, completed areas, inventory changes)
   - Potential issues (player seems lost, going wrong direction, missing key items)
2. Match observations to the most relevant guide step from the guide above
3. Think strategically using ONLY guide information: Why does this step matter? What does it unlock?
4. Provide CONCISE, actionable guidance with 40-80 words that truly helps the player

ENHANCED OUTPUT REQUIREMENTS (40-80 WORDS - CONCISE AND DIRECT):
Your response MUST be:
- CONCISE: No fluff, filler, or unnecessary words
- DIRECT: Get straight to the point with actionable guidance
- CLEAR: Easy to read quickly during gameplay

Your response MUST include (ALL sourced from the guide):
- What you observe in the screenshot(s) (player location/activity) - BRIEF
- The EXACT guide step number (verified to exist in guide)
- The EXACT objective from that guide step
- Clear, specific directions QUOTED from the guide - DIRECT AND CONCISE
- Strategic context derived from guide information only - BRIEF

MANDATORY OUTPUT FORMAT (cite guide step, 40-80 words):
"I see you are [brief observation]. In the guide that is step [NUMBER] where by [action from guide], you can [objective from guide]. [Brief strategic tip from guide]."

⚠️ CONCISENESS REQUIREMENTS:
- Keep responses between 40-80 words
- Remove all unnecessary words and filler
- Be direct and actionable
- No elaborate explanations - just essential info

⚠️ VERIFICATION CHECKPOINT:
Before submitting your response, verify:
✓ Step number exists in guide (between 1 and ${this.guideData?.steps?.length || 0})
✓ Action/direction is quoted from the guide
✓ Objective is stated in the guide
✓ No invented information
✓ Response is 40-80 words (CONCISE)

EXCELLENT Examples (40-80 words, concise and direct):
"I see you are near the gravesite plains grace site. In the guide that is step 3 where by going north east to the Church of Marika, you can obtain the bleed dagger of Margitt. This weapon is crucial for upcoming boss encounters with its bleed effect. Watch for hostile enemies on the path and check behind the altar when you arrive."

"I see you are in Limgrave's starting area near the first grace site. In the guide that is step 1 where by heading south to the cliffside ruins at night, you can meet Melina and unlock Torrent, your spirit horse. This unlocks fast traversal and leveling at Sites of Grace. Rest at the grace to trigger the event."

"I see you are approaching Stormveil Castle's main gate. In the guide that is step 7 where by entering the main gate, you can face Margit the Fell Omen. Recommend upgrading to +3 weapon and level 25 first. Find Smithing Stones in nearby mines and Golden Runes from Limgrave enemies before this challenging fight."

BAD Examples (NEVER DO THIS):
- Generic without step: "You're near a castle. Follow the guide to progress."
- No guide citation: "Keep going forward to find items."
- HALLUCINATION: "Go to the secret cave in step 15" (when step 15 doesn't mention a cave)
- Made-up step: "Do step 99" (when only ${this.guideData?.steps?.length || 0} steps exist)
- Invented location: "Head to the hidden temple" (not in guide)
- Too short: "Do step 3 now." (under 40 words)
- Too wordy: Long paragraphs with unnecessary details (over 80 words)
- Multiple paragraphs, bullet points, or lists

🎯 YOUR TASK:
Provide CONCISE, DIRECT GUIDANCE (40-80 words) that:
1. Cites a specific verified step from the guide
2. Uses ONLY information from the guide
3. Is brief, clear, and actionable - no fluff
4. Never hallucinates or invents information

YOUR RESPONSE (grounded in guide, 40-80 words, CONCISE):`;
    }
    
    async generateSummary(reason, stats) {
        let summaryMessage = '';
        
        if (reason === 'timeout') {
            summaryMessage = `Quest session concluded (${Math.round(stats.duration / 60)} minutes). Provided ${stats.updateCount} quest updates. Quest mode deactivated.`;
        } else {
            summaryMessage = `Quest mode ended. Provided ${stats.updateCount} quest updates over ${Math.round(stats.duration / 60)} minutes.`;
        }
        
        this.emit('quest-summary', {
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
            questState: this.questState,
            config: this.config
        };
    }
}

module.exports = QuestModeLayer;

