/**
 * Event Detection and Parsing Tests
 * Tests for ProactiveAgent event detection from Gemini responses
 */

describe('Event Detection and Parsing', () => {
    // Copy parseEvents function for testing
    function parseEvents(analysisText) {
        const events = [];

        // Check for "EVENTS: NONE"
        if (analysisText.toUpperCase().includes('EVENTS: NONE') ||
            analysisText.toUpperCase().includes('EVENTS:NONE')) {
            return events;
        }

        // Parse format: EVENT|category|type|name|confidence|evidence
        const lines = analysisText.split('\n').filter(line => line.trim());

        for (const line of lines) {
            // Look for lines starting with EVENT|
            if (line.trim().toUpperCase().startsWith('EVENT|')) {
                const parts = line.substring(6).split('|').map(p => p.trim());

                if (parts.length >= 5) {
                    const [category, eventType, entityName, confidenceStr, evidence] = parts;
                    const confidence = parseFloat(confidenceStr);

                    // Validate category
                    const validCategories = ['boss', 'checkpoint', 'item', 'death', 'location', 'level'];
                    if (!validCategories.includes(category.toLowerCase())) {
                        continue;
                    }

                    // Validate confidence threshold
                    if (isNaN(confidence) || confidence < 0.7) {
                        continue;
                    }

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

        return events;
    }

    describe('parseEvents', () => {
        it('should parse boss defeat event correctly', () => {
            const analysisText = `
TIPS: NONE

EVENTS:
EVENT|boss|defeated|Luna|0.95|Victory screen showing "Luna Defeated" with XP +5000
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('boss');
            expect(events[0].eventType).toBe('defeated');
            expect(events[0].entityName).toBe('Luna');
            expect(events[0].confidence).toBe(0.95);
            expect(events[0].evidence).toContain('Victory screen');
        });

        it('should parse checkpoint event correctly', () => {
            const analysisText = `
EVENT|checkpoint|reached|Grand Meadow|0.85|Checkpoint flag UI visible
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('checkpoint');
            expect(events[0].entityName).toBe('Grand Meadow');
        });

        it('should parse item obtained event', () => {
            const analysisText = `
EVENT|item|obtained|Resin|0.90|Item popup showing "Resin" acquired
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('item');
            expect(events[0].eventType).toBe('obtained');
            expect(events[0].entityName).toBe('Resin');
        });

        it('should parse death event', () => {
            const analysisText = `
EVENT|death|died_to|Twilight Sentinel|0.80|Death screen with "Killed by Twilight Sentinel"
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('death');
            expect(events[0].entityName).toBe('Twilight Sentinel');
        });

        it('should parse location event', () => {
            const analysisText = `
EVENT|location|entered|Moonlit Plains|0.85|Area name displayed center screen
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('location');
            expect(events[0].entityName).toBe('Moonlit Plains');
        });

        it('should parse multiple events', () => {
            const analysisText = `
TIPS:
immediate|Check stamina|Low stamina detected

EVENTS:
EVENT|boss|defeated|Luna|0.95|Victory screen
EVENT|checkpoint|reached|Grand Meadow|0.85|Checkpoint UI
EVENT|item|obtained|Resin|0.90|Item popup
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(3);
            expect(events[0].entityName).toBe('Luna');
            expect(events[1].entityName).toBe('Grand Meadow');
            expect(events[2].entityName).toBe('Resin');
        });

        it('should return empty array for EVENTS: NONE', () => {
            const analysisText = `
TIPS:
immediate|Dodge left|Boss attack incoming

EVENTS: NONE
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(0);
        });

        it('should filter out events with confidence < 0.7', () => {
            const analysisText = `
EVENT|boss|defeated|Unknown Boss|0.65|Uncertain victory screen
EVENT|boss|defeated|Luna|0.95|Clear victory screen
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].entityName).toBe('Luna');
            expect(events[0].confidence).toBe(0.95);
        });

        it('should filter out invalid categories', () => {
            const analysisText = `
EVENT|invalid_category|something|Test|0.90|Some evidence
EVENT|boss|defeated|Luna|0.95|Victory screen
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('boss');
        });

        it('should handle malformed event lines', () => {
            const analysisText = `
EVENT|boss|defeated|Luna
EVENT|boss|defeated|Renata|0.95|Victory screen
            `;

            const events = parseEvents(analysisText);

            // Should only parse the valid line
            expect(events).toHaveLength(1);
            expect(events[0].entityName).toBe('Renata');
        });

        it('should normalize category and event type to lowercase', () => {
            const analysisText = `
EVENT|BOSS|DEFEATED|Luna|0.95|Victory
            `;

            const events = parseEvents(analysisText);

            expect(events[0].category).toBe('boss');
            expect(events[0].eventType).toBe('defeated');
        });

        it('should trim whitespace from parsed values', () => {
            const analysisText = `
EVENT| boss | defeated | Luna | 0.95 | Victory screen |
            `;

            const events = parseEvents(analysisText);

            expect(events[0].category).toBe('boss');
            expect(events[0].entityName).toBe('Luna');
            expect(events[0].evidence).toBe('Victory screen');
        });

        it('should add timestamp to events', () => {
            const analysisText = `
EVENT|boss|defeated|Luna|0.95|Victory
            `;

            const beforeTime = Date.now();
            const events = parseEvents(analysisText);
            const afterTime = Date.now();

            expect(events[0].timestamp).toBeDefined();
            const eventTime = new Date(events[0].timestamp).getTime();
            expect(eventTime).toBeGreaterThanOrEqual(beforeTime - 1000); // Allow 1s margin
            expect(eventTime).toBeLessThanOrEqual(afterTime + 1000);
        });

        it('should handle events without evidence field', () => {
            const analysisText = `
EVENT|boss|defeated|Luna|0.95|
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].evidence).toBe('');
        });

        it('should handle EVENTS:NONE without space', () => {
            const analysisText = `
EVENTS:NONE
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(0);
        });

        it('should validate all 6 categories', () => {
            const analysisText = `
EVENT|boss|defeated|Luna|0.95|Victory
EVENT|checkpoint|reached|Meadow|0.85|Flag
EVENT|item|obtained|Resin|0.90|Popup
EVENT|death|died_to|Enemy|0.80|Death screen
EVENT|location|entered|Plains|0.85|Name display
EVENT|level|reached_level|25|0.95|Level up
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(6);
            const categories = events.map(e => e.category);
            expect(categories).toContain('boss');
            expect(categories).toContain('checkpoint');
            expect(categories).toContain('item');
            expect(categories).toContain('death');
            expect(categories).toContain('location');
            expect(categories).toContain('level');
        });

        it('should handle confidence at threshold boundary', () => {
            const analysisText = `
EVENT|boss|defeated|Boss1|0.69|Below threshold
EVENT|boss|defeated|Boss2|0.70|At threshold
EVENT|boss|defeated|Boss3|1.00|Max confidence
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(2);
            expect(events[0].entityName).toBe('Boss2');
            expect(events[0].confidence).toBe(0.70);
            expect(events[1].entityName).toBe('Boss3');
            expect(events[1].confidence).toBe(1.00);
        });
    });

    describe('Event Confidence Scoring', () => {
        it('should accept events with confidence 0.7-1.0', () => {
            const confidences = [0.70, 0.85, 0.95, 1.00];

            confidences.forEach(conf => {
                const analysisText = `EVENT|boss|defeated|Luna|${conf}|Evidence`;
                const events = parseEvents(analysisText);
                expect(events).toHaveLength(1);
                expect(events[0].confidence).toBe(conf);
            });
        });

        it('should reject events with confidence < 0.7', () => {
            const confidences = [0.0, 0.3, 0.5, 0.69];

            confidences.forEach(conf => {
                const analysisText = `EVENT|boss|defeated|Luna|${conf}|Evidence`;
                const events = parseEvents(analysisText);
                expect(events).toHaveLength(0);
            });
        });

        it('should handle invalid confidence values', () => {
            const analysisText = `
EVENT|boss|defeated|Luna|invalid|Evidence
EVENT|boss|defeated|Renata|0.95|Good evidence
            `;

            const events = parseEvents(analysisText);

            expect(events).toHaveLength(1);
            expect(events[0].entityName).toBe('Renata');
        });
    });
});
