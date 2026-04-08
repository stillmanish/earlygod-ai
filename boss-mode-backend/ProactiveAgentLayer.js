// Proactive Agent Layer - Comprehensive game state extraction from screenshots
// Extracts location, party stats, UI state, resources, events for AI coaching context
const { GoogleGenerativeAI } = require('@google/generative-ai');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class ProactiveAgentLayer {
    constructor(options = {}) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required for ProactiveAgentLayer');
        }

        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Use Gemini 2.5 Flash for fast vision analysis
        this.model = this.genAI.getGenerativeModel({
            model: options.model || "gemini-2.5-flash"
        });

        log('[PROACTIVE] Initialized with Gemini Vision for comprehensive game state extraction');
    }

    /**
     * Extract comprehensive game state from screenshots
     * @param {Object} params Analysis parameters
     * @param {String} params.currentScreenshot Current screenshot (base64)
     * @param {Array} params.previousScreenshots Previous screenshots with timestamps
     * @param {Object} params.guideData Current guide being followed
     * @param {Object} params.gameContext Game context
     * @param {Object} params.memory Short and long term memory
     * @returns {Object} Comprehensive game state including location, party, UI state, resources, events
     */
    async extractGameState(params) {
        try {
            const {
                currentScreenshot,
                previousScreenshots = [],
                guideData,
                gameContext,
                memory = {}
            } = params;

            log('[PROACTIVE] Extracting game state from', previousScreenshots.length + 1, 'screenshots for', gameContext?.gameTitle || 'Unknown');

            // Build comprehensive extraction prompt
            const prompt = this.buildGameStateExtractionPrompt(
                guideData,
                gameContext,
                memory
            );

            // Prepare image parts for Gemini (current + previous)
            const imageParts = [];

            // Add previous screenshots in chronological order
            for (const prevShot of previousScreenshots) {
                imageParts.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: prevShot.image
                    }
                });
            }

            // Add current screenshot last
            imageParts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: currentScreenshot
                }
            });

            // Call Gemini Vision with images
            const startTime = Date.now();
            const result = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        ...imageParts
                    ]
                }],
                generationConfig: {
                    temperature: 0.2, // Very low temperature for accurate text transcription
                    maxOutputTokens: 2048, // Increased for comprehensive game state extraction
                    topK: 10,
                    topP: 0.8
                }
            });

            const response = await result.response;
            const analysisText = response.text().trim();
            const analysisTime = Date.now() - startTime;

            // 🔍 LOG RAW GEMINI RESPONSE for debugging (full response for accuracy)
            log('[PROACTIVE] ═══════════════════════════════════════');
            log('[PROACTIVE] Full Gemini Response:');
            log(analysisText);
            log('[PROACTIVE] Response length:', analysisText.length, 'chars');
            log('[PROACTIVE] ═══════════════════════════════════════');

            // Parse comprehensive game state from response
            const gameState = this.parseGameState(analysisText);

            log('[PROACTIVE] Complete in', analysisTime + 'ms');
            if (gameState.location.area !== 'unknown') {
                log('  Location:', gameState.location.area, '|', gameState.location.specificLocation || 'no specific location');
            }
            if (gameState.party.length > 0) {
                log('  Party:', gameState.party.map(p => `${p.name}(Lv${p.level})`).join(', '));
            }
            if (gameState.events.length > 0) {
                log('  Events:', gameState.events.map(e => `${e.category}:${e.entityName}`).join(', '));
            }

            return {
                success: true,
                gameState,
                analysisTime,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('[PROACTIVE] Error:', error.message);
            return {
                success: false,
                error: error.message,
                gameState: this.getEmptyGameState()
            };
        }
    }

    getEmptyGameState() {
        return {
            location: { area: 'unknown', specificLocation: null, type: 'unknown', confidence: 0 },
            party: [],
            uiState: { menuOpen: false, menuType: 'none', options: [], inCombat: false, canSave: false },
            resources: { currency: 'not visible', healthStatus: 'unknown', items: 'not visible' },
            events: [],
            objectives: { visible: false, markers: [] },
            combat: { status: 'unknown', enemy: null, playerHealth: 'unknown' }
        };
    }

    buildGameStateExtractionPrompt(guideData, gameContext, memory) {
        const gameTitle = gameContext?.gameTitle || 'the game';

        // Build guide context
        let guideContext = '';
        if (guideData && guideData.steps && guideData.steps.length > 0) {
            const guideName = guideData.metadata?.title || 'Guide';
            guideContext = `\n📚 ACTIVE GUIDE: "${guideName}"\n`;
            guideContext += `Current focus: ${guideData.steps.slice(0, 3).map(s => s.title).join(', ')}\n`;
        }

        // Build memory context
        let memoryContext = '';
        if (memory.shortTerm && memory.shortTerm.length > 0) {
            const recentActions = memory.shortTerm.slice(-3).join('; ');
            memoryContext += `\n🧠 RECENT CONTEXT: ${recentActions}\n`;
        }
        if (memory.longTerm) {
            memoryContext += `📊 SESSION CONTEXT: ${memory.longTerm}\n`;
        }

        return `You are analyzing ${gameTitle} gameplay screenshots to extract COMPREHENSIVE GAME STATE information.

${guideContext}${memoryContext}

🎯 YOUR JOB: Extract ALL visible game state information from the screenshots.

STEP 1: EXTRACT ALL VISIBLE TEXT AND UI ELEMENTS

🚨 CRITICAL: READ THE ACTUAL TEXT - DO NOT DESCRIBE WHAT YOU SEE
- If you see text that says "Gustave", write "Gustave" (NOT "Character 1" or "red-haired character")
- If you see "Level 20", write "20" (NOT "high level" or "unknown")
- If you see "EXPEDITION - REST POINT", write that exact text
- If you see "Inside the Monolith", write that exact text
- If you see "Tainted cliffs" at the bottom, write that exact text

Read ACTUAL TEXT visible in the screenshots:
- Location names, area titles, zone names (exact text, not descriptions)
- Character names (EXACT names like "Gustave", "Maelle" - NOT "Character 1")
- Levels (EXACT numbers like "20", "18" - NOT "unknown" or descriptions)
- Stats, HP/MP/stamina values (actual numbers)
- Menu text, button prompts, UI labels, HUD elements
- Quest objectives, dialogue, notifications
- Numbers, counters, resource amounts (exact values)
- Status effects, buffs, debuffs
- Enemy names, boss names (exact names)

DO NOT DESCRIBE - TRANSCRIBE: Copy the text you see exactly as written.

STEP 2: CLASSIFY INFORMATION INTO STRUCTURED CATEGORIES

Output your analysis in this EXACT format (complete ALL sections):

EXAMPLE OUTPUT:
--------------
LOCATION:
Area: Tainted cliffs
Specific: Inside the Monolith
Type: checkpoint
Confidence: 0.9

PARTY:
Gustave | Level 20 | full | unknown
Maelle | Level 18 | full | unknown
Chrona | Level 17 | full | unknown
Sciel | Level 17 | full | unknown

UI_STATE:
Menu: yes | Type: rest
Combat: no
Options: Rest, Upgrade Attributes, Learn Skills
Can Save: yes

RESOURCES:
Currency: not visible
Health: full
Items: not visible

EVENTS:
EVENT|checkpoint|reached|Inside the Monolith - Tainted cliffs|0.90|Rest point menu open with location text visible

OBJECTIVES:
Quest: none visible
Markers: none

COMBAT:
Status: not_in_combat
Enemy: none visible
Player_Health: full
--------------

NOW OUTPUT YOUR ANALYSIS:

LOCATION:
Area: [main area/zone name or "unknown"]
Specific: [specific location name like "Inside the monolith" or "not visible"]
Type: [checkpoint/town/dungeon/overworld/combat/menu/unknown]
Confidence: [0.0-1.0]

PARTY:
[Format: EXACT_NAME | Level EXACT_NUMBER | HP status | Class/Role if visible]
Example: Gustave | Level 20 | full | Warrior
Example: Maelle | Level 18 | full | unknown
(List each visible party member with their EXACT name and level as shown in UI)
(If no party visible, write "PARTY: none visible")

UI_STATE:
Menu: [yes/no] | Type: [rest/inventory/map/combat/dialogue/none]
Combat: [yes/no]
Options: [comma-separated list of visible menu options or "none"]
Can Save: [yes/no/unknown]

RESOURCES:
Currency: [amount or "not visible"]
Health: [full/damaged/critical/unknown]
Items: [notable items/counts or "not visible"]

EVENTS:
[Format: EVENT|category|type|name|confidence|evidence]
Categories: checkpoint, levelup, boss, death, achievement, save, rest, etc.
(If no events, write "EVENTS: none")

OBJECTIVES:
Quest: [quest name/text or "none visible"]
Markers: [waypoint descriptions or "none"]

COMBAT:
Status: [in_combat/not_in_combat/unknown]
Enemy: [enemy name/type or "none visible"]
Player_Health: [full/damaged/critical/unknown]

🎯 CHECKPOINT DETECTION (IMPORTANT):

When you see checkpoint indicators, extract the FULL location information:
✅ "EXPEDITION - REST POINT" (menu) + "Inside the monolith" (main text) + "Tainted cliffs" (bottom text)
   → Area: Tainted cliffs, Specific: Inside the monolith, Type: checkpoint
   → EVENT|checkpoint|reached|Inside the monolith - Tainted cliffs|0.90|Rest point menu open with location text visible

✅ "Checkpoint - Cathedral Bonfire"
   → Area: Cathedral, Specific: Cathedral Bonfire, Type: checkpoint
   → EVENT|checkpoint|reached|Cathedral Bonfire|0.95|Explicit checkpoint text

✅ "Save Point" + "Manor Gardens" visible
   → Area: Manor Gardens, Specific: Manor Gardens, Type: checkpoint
   → EVENT|checkpoint|reached|Manor Gardens|0.90|Save point indicator with location name

🚨 CHECKPOINT RECOGNITION: If you see a REST menu open (with options like "Rest", "Upgrade Attributes", "Learn Skills") + location names visible, this IS a checkpoint! Set Type: checkpoint and create a checkpoint event.

🚫 WHAT NOT TO DO:
❌ Don't ignore character names/levels - extract them in PARTY section
❌ Don't ignore boss names - extract them in COMBAT or EVENTS section
❌ Don't hallucinate text - only report what you actually see
❌ Don't skip location details - extract BOTH area name AND specific location

📋 COMPREHENSIVE EXTRACTION RULES:
1. Extract EVERYTHING visible - this data helps the AI coach understand game state
2. Character stats, party composition, levels ARE important - always extract
3. Location should include both broad area (zone/region) AND specific location (checkpoint name, building name)
4. When menus are open, list all visible options
5. If something is not visible in the screenshot, mark as "not visible" or "unknown"
6. Be thorough but accurate - no hallucinations

⚠️ FINAL REMINDER - TEXT EXTRACTION:
- Your screenshots are now HIGH RESOLUTION (1920x1080 at 90% JPEG quality)
- You CAN read small text clearly - character names, levels, UI labels
- DO NOT write "Character 1" or "unknown" when text is clearly visible
- READ the actual text and TRANSCRIBE it exactly
- Example: If you see "Gustave Lv. 20" → write "Gustave | Level 20"
- Example: If you see "EXPEDITION - REST POINT" → write that EXACT text
- Example: If you see "Inside the Monolith" → write that EXACT text

🚨 IMPORTANT: Output ALL sections (LOCATION, PARTY, UI_STATE, RESOURCES, EVENTS, OBJECTIVES, COMBAT)
- Even if some sections have "not visible" or "unknown", output them
- Follow the EXACT format shown in the example above
- Don't skip sections - complete the full structured output

Now analyze the screenshots and extract comprehensive game state:`;
    }

    parseGameState(analysisText) {
        log('[PARSE] Parsing comprehensive game state...');

        const gameState = this.getEmptyGameState();
        const lines = analysisText.split('\n').map(l => l.trim()).filter(l => l);

        let currentSection = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const upper = line.toUpperCase();

            // Detect sections
            if (upper.startsWith('LOCATION:')) {
                currentSection = 'LOCATION';
                continue;
            } else if (upper.startsWith('PARTY:')) {
                currentSection = 'PARTY';
                // Check if "none visible" on same line
                if (upper.includes('NONE VISIBLE')) {
                    gameState.party = [];
                    currentSection = null;
                }
                continue;
            } else if (upper.startsWith('UI_STATE:')) {
                currentSection = 'UI_STATE';
                continue;
            } else if (upper.startsWith('RESOURCES:')) {
                currentSection = 'RESOURCES';
                continue;
            } else if (upper.startsWith('EVENTS:')) {
                currentSection = 'EVENTS';
                // Check if "none" on same line
                if (upper.includes('NONE') && !upper.includes('EVENT|')) {
                    gameState.events = [];
                    currentSection = null;
                }
                continue;
            } else if (upper.startsWith('OBJECTIVES:')) {
                currentSection = 'OBJECTIVES';
                continue;
            } else if (upper.startsWith('COMBAT:')) {
                currentSection = 'COMBAT';
                continue;
            }

            // Parse section content
            if (currentSection === 'LOCATION') {
                this.parseLocationLine(line, gameState.location);
            } else if (currentSection === 'PARTY') {
                this.parsePartyLine(line, gameState.party);
            } else if (currentSection === 'UI_STATE') {
                this.parseUIStateLine(line, gameState.uiState);
            } else if (currentSection === 'RESOURCES') {
                this.parseResourcesLine(line, gameState.resources);
            } else if (currentSection === 'EVENTS') {
                this.parseEventLine(line, gameState.events);
            } else if (currentSection === 'OBJECTIVES') {
                this.parseObjectivesLine(line, gameState.objectives);
            } else if (currentSection === 'COMBAT') {
                this.parseCombatLine(line, gameState.combat);
            }
        }

        log('[PARSE] Game state parsed successfully');
        return gameState;
    }

    parseLocationLine(line, location) {
        if (line.toLowerCase().startsWith('area:')) {
            location.area = line.substring(5).trim();
        } else if (line.toLowerCase().startsWith('specific:')) {
            const val = line.substring(9).trim();
            location.specificLocation = val === 'not visible' || val === 'unknown' ? null : val;
        } else if (line.toLowerCase().startsWith('type:')) {
            location.type = line.substring(5).trim();
        } else if (line.toLowerCase().startsWith('confidence:')) {
            location.confidence = parseFloat(line.substring(11).trim()) || 0;
        }
    }

    parsePartyLine(line, party) {
        // Format: Name | Level X | HP status | Class/Role
        if (line.includes('|')) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 2) {
                const member = {
                    name: parts[0],
                    level: parts[1].replace(/level/i, '').trim(),
                    hp: parts[2] || 'unknown',
                    role: parts[3] || 'unknown'
                };
                party.push(member);
            }
        }
    }

    parseUIStateLine(line, uiState) {
        const lower = line.toLowerCase();
        if (lower.startsWith('menu:')) {
            const parts = line.substring(5).split('|').map(p => p.trim());
            uiState.menuOpen = parts[0].toLowerCase().includes('yes');
            if (parts[1]) {
                const typeMatch = parts[1].match(/type:\s*(\w+)/i);
                if (typeMatch) uiState.menuType = typeMatch[1];
            }
        } else if (lower.startsWith('combat:')) {
            uiState.inCombat = line.toLowerCase().includes('yes');
        } else if (lower.startsWith('options:')) {
            const opts = line.substring(8).trim();
            if (opts !== 'none' && opts !== 'not visible') {
                uiState.options = opts.split(',').map(o => o.trim());
            }
        } else if (lower.startsWith('can save:')) {
            const val = line.substring(9).trim().toLowerCase();
            uiState.canSave = val === 'yes';
        }
    }

    parseResourcesLine(line, resources) {
        const lower = line.toLowerCase();
        if (lower.startsWith('currency:')) {
            resources.currency = line.substring(9).trim();
        } else if (lower.startsWith('health:')) {
            resources.healthStatus = line.substring(7).trim();
        } else if (lower.startsWith('items:')) {
            resources.items = line.substring(6).trim();
        }
    }

    parseEventLine(line, events) {
        // Format: EVENT|category|type|name|confidence|evidence
        if (line.toUpperCase().startsWith('EVENT|')) {
            const parts = line.substring(6).split('|').map(p => p.trim());
            if (parts.length >= 5) {
                const [category, eventType, entityName, confidenceStr, evidence] = parts;
                const confidence = parseFloat(confidenceStr);

                if (!isNaN(confidence) && confidence >= 0.8) {
                    events.push({
                        category: category.toLowerCase(),
                        eventType: eventType.toLowerCase(),
                        entityName: entityName,
                        confidence: confidence,
                        evidence: evidence || '',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
    }

    parseObjectivesLine(line, objectives) {
        const lower = line.toLowerCase();
        if (lower.startsWith('quest:')) {
            const val = line.substring(6).trim();
            objectives.visible = val !== 'none visible' && val !== 'none';
        } else if (lower.startsWith('markers:')) {
            const val = line.substring(8).trim();
            if (val !== 'none' && val !== 'not visible') {
                objectives.markers = val.split(',').map(m => m.trim());
            }
        }
    }

    parseCombatLine(line, combat) {
        const lower = line.toLowerCase();
        if (lower.startsWith('status:')) {
            combat.status = line.substring(7).trim();
        } else if (lower.startsWith('enemy:')) {
            const val = line.substring(6).trim();
            combat.enemy = val === 'none visible' || val === 'none' ? null : val;
        } else if (lower.startsWith('player_health:')) {
            combat.playerHealth = line.substring(14).trim();
        }
    }
}

module.exports = ProactiveAgentLayer;
