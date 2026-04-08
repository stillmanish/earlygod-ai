// Event Detector - Hybrid detection with confidence scoring and AI validation
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class EventDetector {
    constructor() {
        this.gameRules = this.loadGameRules();
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    }
    
    loadGameRules() {
        // Load all JSON files from game-rules/
        const rules = {};
        const rulesDir = path.join(__dirname, '..', 'game-rules');
        
        if (!fs.existsSync(rulesDir)) {
            console.warn('⚠️ game-rules directory not found');
            return rules;
        }
        
        const files = fs.readdirSync(rulesDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                try {
                    const gameRule = JSON.parse(fs.readFileSync(path.join(rulesDir, file), 'utf8'));
                    rules[gameRule.gameTitle.toLowerCase()] = gameRule;
                    log(`✅ Loaded game rules for: ${gameRule.gameTitle}`);
                } catch (error) {
                    console.error(`❌ Failed to load game rule ${file}:`, error.message);
                }
            }
        });
        
        return rules;
    }
    
    // Hybrid detection with confidence scoring and AI validation
    async detectEvents(text, gameTitle) {
        const rules = this.gameRules[gameTitle.toLowerCase()];
        if (!rules) {
            log(`⚠️ No game rules found for: ${gameTitle}`);
            return [];
        }

        const events = [];
        const textLower = text.toLowerCase();

        // Check each event category
        for (const [category, keywords] of Object.entries(rules.eventKeywords)) {
            // 1. Keyword match (fast, cheap)
            const keywordMatches = keywords.filter(keyword => textLower.includes(keyword));

            if (keywordMatches.length === 0) continue;

            // 2. Calculate confidence based on keyword specificity
            const confidence = this.calculateKeywordConfidence(keywordMatches, category);

            // 3. High confidence (>0.9) - trust it immediately
            if (confidence > 0.9) {
                const entities = await this.extractEntities(text, rules.entityPatterns, category, gameTitle);
                events.push({
                    category,
                    entities,
                    rawText: text,
                    confidence,
                    validated: false,
                    timestamp: new Date()
                });
            }
            // 4. Low confidence (0.5-0.9) - validate with AI
            else if (confidence > 0.5) {
                const validated = await this.validateWithAI(text, category);
                if (validated) {
                    const entities = await this.extractEntities(text, rules.entityPatterns, category, gameTitle);
                    events.push({
                        category,
                        entities,
                        rawText: text,
                        confidence: 0.95,
                        validated: true,
                        timestamp: new Date()
                    });
                }
            }
            // 5. Very low confidence (<0.5) - skip
        }

        return events;
    }
    
    calculateKeywordConfidence(matches, category) {
        // Specific keywords = higher confidence
        const specificKeywords = {
            boss: ['defeated', 'killed', 'beat', 'boss down', 'finally got'],
            location: ['reached', 'arrived at', 'made it to', 'now in'],
            quest: ['completed', 'finished', 'started'],
            weapon: ['equipped', 'obtained', 'got', 'using'],
            item: ['obtained', 'found', 'got'],
            floor: ['reached', 'cleared', 'completed'],
            skill: ['unlocked', 'learned', 'upgraded']
        };
        
        const specific = specificKeywords[category] || [];
        const hasSpecific = matches.some(m => specific.includes(m));
        
        // High confidence if specific keyword found
        if (hasSpecific) return 0.95;
        
        // Medium confidence if multiple generic keywords
        if (matches.length > 1) return 0.75;
        
        // Low confidence if single generic keyword
        return 0.6;
    }
    
    async validateWithAI(text, category) {
        const prompt = `Does this text mention a ${category} event? "${text}"\nReply with ONLY "YES" or "NO".`;
        
        try {
            const result = await this.model.generateContent(prompt);
            const response = result.response.text().trim().toUpperCase();
            return response.includes('YES');
        } catch (error) {
            console.error('AI validation failed:', error);
            return false; // Fail safe - don't store uncertain events
        }
    }
    
    async extractEntities(text, patterns, category, gameTitle = '') {
        const entities = {};

        // HYBRID APPROACH: Try regex first, fallback to Gemini for complex cases
        
        // 1. Try regex patterns (fast, free, works for well-formed text)
        const relevantPatterns = {
            boss: ['boss_name'],
            location: ['location_name'],
            weapon: ['item_name'],
            armor: ['item_name'],
            item: ['item_name'],
            build: ['level_number'],
            floor: ['floor_number'],
            skill: ['skill_name'],
            unit: ['unit_name'],
            building: ['building_name'],
            civilization: ['civilization_name']
        };
        
        const patternsToTry = relevantPatterns[category] || [];
        let regexMatches = [];
        
        patternsToTry.forEach(patternKey => {
            if (patterns[patternKey]) {
                const regex = new RegExp(patterns[patternKey], 'gi');
                const matches = [...text.matchAll(regex)];
                if (matches.length > 0) {
                    regexMatches = matches.map(m => m[1]);
                }
            }
        });
        
        // 2. If regex found matches, use them (high confidence)
        if (regexMatches.length > 0) {
            entities[category] = regexMatches;
            entities.confidence = 0.95;
            entities.method = 'regex';
            return entities;
        }
        
        // 3. Regex failed - use Gemini for extraction (handles casual language)
        // Examples: "finally got margit!", "margit is down", "beat the tree boss"
        const geminiExtracted = await this.extractWithGemini(text, category, gameTitle);
        if (geminiExtracted) {
            entities[category] = [geminiExtracted];
            entities.confidence = 0.85;
            entities.method = 'gemini';
            return entities;
        }
        
        return entities;
    }
    
    async extractWithGemini(text, category, gameTitle = '') {
        const gameContext = gameTitle ? ` The player is playing "${gameTitle}".` : '';
        const prompts = {
            boss: `Extract the boss/enemy name from this voice transcript: "${text}".${gameContext} This is casual speech from a gamer — they may mispronounce names, use nicknames, or say things like "that guy" or "the big one". Return ONLY the correct boss name, or "NONE" if no boss is mentioned.`,
            location: `Extract the location/area name from this voice transcript: "${text}".${gameContext} The player may describe where they are casually. Return ONLY the location name, or "NONE" if none mentioned.`,
            weapon: `Extract the weapon name from this voice transcript: "${text}".${gameContext} Return ONLY the weapon name, or "NONE" if no weapon mentioned.`,
            item: `Extract the item name from this voice transcript: "${text}".${gameContext} Return ONLY the item name, or "NONE" if no item mentioned.`,
            quest: `Extract the quest or NPC name from this voice transcript: "${text}".${gameContext} Return ONLY the name, or "NONE" if none mentioned.`,
            skill: `Extract the skill/ability name from this voice transcript: "${text}".${gameContext} Return ONLY the name, or "NONE" if none mentioned.`,
            floor: `Extract the floor/level number from: "${text}". Return ONLY the number, or "NONE" if none mentioned.`,
            unit: `Extract the unit type from: "${text}".${gameContext} Return ONLY the unit name, or "NONE" if none mentioned.`,
            building: `Extract the building name from: "${text}".${gameContext} Return ONLY the building name, or "NONE" if none mentioned.`
        };

        try {
            const result = await this.model.generateContent(prompts[category] || prompts.item);
            const extracted = result.response.text().trim();

            if (extracted === 'NONE' || extracted.length === 0 || extracted.length > 100) {
                return null;
            }

            return extracted;
        } catch (error) {
            console.error('Gemini extraction failed:', error);
            return null;
        }
    }
    
    // Extract from screenshot using game-specific regions
    async extractFromScreen(screenshot, gameTitle) {
        const rules = this.gameRules[gameTitle.toLowerCase()];
        if (!rules) return {};
        
        const extracted = {};
        
        for (const [key, region] of Object.entries(rules.screenRegions)) {
            // Crop screenshot to region first (reduces processing cost)
            const cropped = this.cropImage(screenshot, region);
            
            // Extract based on type with hybrid approach
            switch (region.type) {
                case 'number':
                    // Try Tesseract first (free, fast for simple numbers)
                    const ocrResult = await this.tesseractOCR(cropped, 'number');
                    if (ocrResult.confidence >= 80) {
                        extracted[key] = ocrResult.text;
                    } else {
                        // Fallback to Gemini Flash for low confidence
                        extracted[key] = await this.geminiExtract(cropped, 'number');
                    }
                    break;
                    
                case 'text':
                    // Use Gemini Flash for text (better accuracy for game fonts)
                    extracted[key] = await this.geminiExtract(cropped, 'text');
                    break;
                    
                case 'bar_percentage':
                    // Pure image processing (no OCR/AI needed)
                    extracted[key] = this.calculateBarPercentage(cropped);
                    break;
                    
                case 'fraction':
                    // Try Tesseract first
                    const fractionOCR = await this.tesseractOCR(cropped, 'fraction');
                    if (fractionOCR.confidence >= 80) {
                        extracted[key] = fractionOCR.text;
                    } else {
                        // Fallback to Gemini Flash
                        extracted[key] = await this.geminiExtract(cropped, 'fraction');
                    }
                    break;
            }
        }
        
        return extracted;
    }
    
    cropImage(screenshot, region) {
        // TODO: Implement image cropping using sharp or jimp
        // For now, return the full screenshot
        return screenshot;
    }
    
    // Tesseract OCR for simple text/numbers
    async tesseractOCR(croppedImage, expectedType) {
        try {
            const Tesseract = require('tesseract.js');
            
            // Configure based on expected type
            const config = {
                number: { tessedit_char_whitelist: '0123456789' },
                fraction: { tessedit_char_whitelist: '0123456789/' },
                text: {} // Default config
            };
            
            const result = await Tesseract.recognize(croppedImage, 'eng', {
                ...config[expectedType]
            });
            
            return {
                text: result.data.text.trim(),
                confidence: result.data.confidence
            };
        } catch (error) {
            console.error('Tesseract OCR failed:', error);
            return { text: '', confidence: 0 };
        }
    }
    
    // Gemini Flash for complex extraction
    async geminiExtract(croppedImage, expectedType) {
        const prompts = {
            number: "Extract only the number from this image. Return just the number, nothing else.",
            text: "Extract only the text from this image. Return just the text, nothing else.",
            fraction: "Extract the fraction (e.g., 50/100) from this image. Return just the fraction, nothing else."
        };
        
        try {
            const result = await this.model.generateContent([
                prompts[expectedType],
                {
                    inlineData: {
                        data: croppedImage.toString('base64'),
                        mimeType: 'image/jpeg'
                    }
                }
            ]);
            
            return result.response.text().trim();
        } catch (error) {
            console.error('Gemini extraction failed:', error);
            return '';
        }
    }
    
    calculateBarPercentage(croppedImage) {
        // TODO: Implement bar percentage calculation using pixel analysis
        // For now, return 100
        return 100;
    }
}

module.exports = EventDetector;

