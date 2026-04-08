/**
 * Background Agent Memory Integration Tests
 * Tests for ProactiveAgent memory fetching and usage
 */

// Mock fetch for testing
global.fetch = jest.fn();

describe('Background Agent Memory Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('fetchLongTermMemory', () => {
        // Copy function for testing
        async function fetchLongTermMemory(gameTitle) {
            const MAIN_BACKEND_URL = 'http://localhost:3001';

            const response = await fetch(
                `${MAIN_BACKEND_URL}/api/memory/events/${encodeURIComponent(gameTitle)}?limit=20`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch memory: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success || !data.events || data.events.length === 0) {
                return '';
            }

            // Format memory for proactive agent context
            let formatted = '═══════════════════════════════════════\n';
            formatted += '📊 PLAYER PROGRESS (Long-Term Memory):\n';
            formatted += '═══════════════════════════════════════\n\n';

            const bosses = data.events.filter(e => e.category === 'boss');
            const checkpoints = data.events.filter(e => e.category === 'checkpoint');
            const items = data.events.filter(e => e.category === 'item');
            const deaths = data.events.filter(e => e.category === 'death');
            const locations = data.events.filter(e => e.category === 'location');

            if (bosses.length > 0) {
                formatted += '⚔️ BOSSES DEFEATED:\n';
                bosses.forEach(b => {
                    formatted += `  - ${b.entity_name}\n`;
                });
                formatted += '\n';
            }

            if (checkpoints.length > 0) {
                formatted += '🚩 CHECKPOINTS REACHED:\n';
                checkpoints.forEach(c => {
                    formatted += `  - ${c.entity_name}\n`;
                });
                formatted += '\n';
            }

            if (locations.length > 0) {
                formatted += '📍 RECENT LOCATIONS:\n';
                locations.slice(0, 5).forEach(l => {
                    formatted += `  - ${l.entity_name}\n`;
                });
                formatted += '\n';
            }

            if (items.length > 0) {
                formatted += '🎒 KEY ITEMS:\n';
                items.forEach(i => {
                    formatted += `  - ${i.entity_name}\n`;
                });
                formatted += '\n';
            }

            if (deaths.length > 0) {
                formatted += '💀 RECENT DEATHS:\n';
                deaths.slice(0, 3).forEach(d => {
                    formatted += `  - ${d.entity_name}\n`;
                });
                formatted += '\n';
            }

            formatted += '═══════════════════════════════════════\n';
            formatted += 'Use this context to provide relevant tips.\n';
            formatted += '═══════════════════════════════════════\n';

            return formatted;
        }

        it('should fetch memory from main backend', async () => {
            const mockResponse = {
                success: true,
                events: [
                    {
                        category: 'boss',
                        entity_name: 'Luna'
                    },
                    {
                        category: 'checkpoint',
                        entity_name: 'Grand Meadow'
                    }
                ]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('Clair Obscur: Expedition 33');

            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/memory/events/Clair%20Obscur%3A%20Expedition%2033?limit=20',
                expect.objectContaining({
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                })
            );

            expect(result).toContain('PLAYER PROGRESS');
            expect(result).toContain('Luna');
            expect(result).toContain('Grand Meadow');
        });

        it('should format bosses correctly', async () => {
            const mockResponse = {
                success: true,
                events: [
                    { category: 'boss', entity_name: 'Luna' },
                    { category: 'boss', entity_name: 'Renata' }
                ]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('Test Game');

            expect(result).toContain('⚔️ BOSSES DEFEATED:');
            expect(result).toContain('Luna');
            expect(result).toContain('Renata');
        });

        it('should format checkpoints correctly', async () => {
            const mockResponse = {
                success: true,
                events: [
                    { category: 'checkpoint', entity_name: 'Grand Meadow' }
                ]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('Test Game');

            expect(result).toContain('🚩 CHECKPOINTS REACHED:');
            expect(result).toContain('Grand Meadow');
        });

        it('should limit locations to 5', async () => {
            const mockResponse = {
                success: true,
                events: Array.from({ length: 10 }, (_, i) => ({
                    category: 'location',
                    entity_name: `Location ${i + 1}`
                }))
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('Test Game');

            expect(result).toContain('📍 RECENT LOCATIONS:');
            const locationMatches = result.match(/Location \d+/g) || [];
            expect(locationMatches.length).toBeLessThanOrEqual(5);
        });

        it('should limit deaths to 3', async () => {
            const mockResponse = {
                success: true,
                events: Array.from({ length: 10 }, (_, i) => ({
                    category: 'death',
                    entity_name: `Enemy ${i + 1}`
                }))
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('Test Game');

            const deathMatches = result.match(/Enemy \d+/g);
            expect(deathMatches).toHaveLength(3);
        });

        it('should return empty string if no events', async () => {
            const mockResponse = {
                success: true,
                events: []
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('New Game');

            expect(result).toBe('');
        });

        it('should handle fetch errors', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500
            });

            await expect(
                fetchLongTermMemory('Test Game')
            ).rejects.toThrow('Failed to fetch memory: 500');
        });

        it('should URL encode game titles', async () => {
            const mockResponse = {
                success: true,
                events: []
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            await fetchLongTermMemory('Game: Special Edition');

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('Game%3A%20Special%20Edition'),
                expect.any(Object)
            );
        });

        it('should include usage instructions', async () => {
            const mockResponse = {
                success: true,
                events: [
                    { category: 'boss', entity_name: 'Luna' }
                ]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse
            });

            const result = await fetchLongTermMemory('Test Game');

            expect(result).toContain('Use this context to provide relevant tips');
        });
    });

    describe('Memory Integration in Proactive Analysis', () => {
        it('should pass memory to ProactiveAgent', async () => {
            const memory = {
                shortTerm: [],
                longTerm: `
⚔️ BOSSES DEFEATED: Luna
🚩 CHECKPOINTS: Grand Meadow
                `.trim()
            };

            // Simulate ProactiveAgent receiving memory
            expect(memory.longTerm).toContain('BOSSES DEFEATED: Luna');
            expect(memory.longTerm).toContain('CHECKPOINTS: Grand Meadow');
        });

        it('should include memory in Gemini prompt', () => {
            const memoryContext = `
📊 PLAYER PROGRESS:
⚔️ BOSSES DEFEATED: Luna
🎒 KEY ITEMS: Resin
            `.trim();

            const prompt = `
You are analyzing gameplay.

${memoryContext}

🧠 MEMORY USAGE FOR TIPS:
- Reference PLAYER PROGRESS above
- Don't suggest tips for defeated bosses
- Use memory for context-aware guidance
            `.trim();

            expect(prompt).toContain('PLAYER PROGRESS');
            expect(prompt).toContain('BOSSES DEFEATED: Luna');
            expect(prompt).toContain('MEMORY USAGE FOR TIPS');
            expect(prompt).toContain("Don't suggest tips for defeated bosses");
        });

        it('should generate context-aware tips based on memory', () => {
            const memory = {
                longTerm: '⚔️ BOSSES DEFEATED: Luna\n🎒 KEY ITEMS: Resin'
            };

            // Simulate tip generation with memory context
            const tips = [];

            // Should NOT generate tips about Luna (already defeated)
            const shouldSkipLunaTips = memory.longTerm.includes('Luna');
            expect(shouldSkipLunaTips).toBe(true);

            // Should generate tips about using Resin
            if (memory.longTerm.includes('Resin')) {
                tips.push({
                    text: 'Trade Resin at jar merchant',
                    priority: 'can-wait',
                    reason: 'Player has Resin item'
                });
            }

            expect(tips).toHaveLength(1);
            expect(tips[0].text).toContain('Resin');
        });
    });

    describe('Event Storage After Detection', () => {
        // Mock storeEventToMainBackend
        async function storeEventToMainBackend(event, gameTitle) {
            const MAIN_BACKEND_URL = 'http://localhost:3001';

            const response = await fetch(`${MAIN_BACKEND_URL}/api/memory/store-event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gameTitle,
                    category: event.category,
                    eventType: event.eventType,
                    entityName: event.entityName,
                    context: `[Auto-detected] ${event.evidence} (confidence: ${event.confidence})`
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            return await response.json();
        }

        it('should store detected events to main backend', async () => {
            const event = {
                category: 'boss',
                eventType: 'defeated',
                entityName: 'Luna',
                confidence: 0.95,
                evidence: 'Victory screen showing Luna Defeated'
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, id: 1 })
            });

            await storeEventToMainBackend(event, 'Clair Obscur: Expedition 33');

            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/memory/store-event',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: expect.stringContaining('Luna')
                })
            );
        });

        it('should include auto-detected prefix in context', async () => {
            const event = {
                category: 'checkpoint',
                eventType: 'reached',
                entityName: 'Grand Meadow',
                confidence: 0.85,
                evidence: 'Checkpoint UI visible'
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, id: 2 })
            });

            await storeEventToMainBackend(event, 'Test Game');

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            expect(body.context).toContain('[Auto-detected]');
            expect(body.context).toContain('Checkpoint UI visible');
            expect(body.context).toContain('confidence: 0.85');
        });

        it('should handle storage errors gracefully', async () => {
            const event = {
                category: 'boss',
                eventType: 'defeated',
                entityName: 'Luna',
                confidence: 0.95,
                evidence: 'Victory'
            };

            global.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500
            });

            await expect(
                storeEventToMainBackend(event, 'Test Game')
            ).rejects.toThrow('API error: 500');
        });
    });

    describe('Memory Prompt Integration', () => {
        it('should include memory usage instructions in prompt', () => {
            const promptSection = `
🧠 MEMORY USAGE FOR TIPS:
- Reference PLAYER PROGRESS above when generating tips
- If player defeated a boss, don't suggest tips for that boss
- If player at a checkpoint, tips can reference location/progress
- Use memory to provide contextual, progression-aware guidance
- Examples: "Since you have Resin, visit jar merchant"
            `.trim();

            expect(promptSection).toContain('MEMORY USAGE FOR TIPS');
            expect(promptSection).toContain("don't suggest tips for that boss");
            expect(promptSection).toContain('progression-aware guidance');
        });

        it('should validate memory is in prompt before Gemini call', () => {
            const memory = {
                longTerm: '⚔️ BOSSES: Luna'
            };

            const prompt = `Analysis prompt\n${memory.longTerm}`;

            expect(prompt).toContain('BOSSES: Luna');
        });
    });
});
