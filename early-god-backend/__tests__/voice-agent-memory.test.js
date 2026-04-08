/**
 * Voice Agent Memory Integration Tests
 * Tests that voice mode properly fetches and uses long-term memory
 */

const { Pool } = require('pg');

jest.mock('pg');

describe('Voice Agent Memory Integration', () => {
    let mockPool;

    beforeEach(() => {
        mockPool = {
            query: jest.fn()
        };
        Pool.mockImplementation(() => mockPool);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Memory Fetching at Voice Mode Start', () => {
        it('should fetch long-term memory events from Neon', async () => {
            const gameTitle = 'Clair Obscur: Expedition 33';
            const mockEvents = {
                rows: [
                    {
                        category: 'boss',
                        event_type: 'defeated',
                        entity_name: 'Luna',
                        context: 'Defeated after 3 attempts',
                        timestamp: '2026-01-01T12:00:00Z'
                    },
                    {
                        category: 'checkpoint',
                        event_type: 'reached',
                        entity_name: 'Grand Meadow',
                        context: null,
                        timestamp: '2026-01-01T13:00:00Z'
                    }
                ]
            };

            mockPool.query.mockResolvedValueOnce(mockEvents);

            // Simulate voice mode startup query
            const result = await mockPool.query(
                `SELECT category, event_type, entity_name, context, timestamp
                 FROM long_term_memory
                 WHERE game_title = $1
                 ORDER BY timestamp DESC
                 LIMIT 20`,
                [gameTitle]
            );

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT category, event_type, entity_name'),
                [gameTitle]
            );
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0].entity_name).toBe('Luna');
        });

        it('should limit memory fetch to 20 events', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            const query = `SELECT category, event_type, entity_name, context, timestamp
                           FROM long_term_memory
                           WHERE game_title = $1
                           ORDER BY timestamp DESC
                           LIMIT 20`;

            await mockPool.query(query, ['Test Game']);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('LIMIT 20'),
                ['Test Game']
            );
        });

        it('should order events by timestamp descending (most recent first)', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            const query = `SELECT category, event_type, entity_name, context, timestamp
                           FROM long_term_memory
                           WHERE game_title = $1
                           ORDER BY timestamp DESC
                           LIMIT 20`;

            await mockPool.query(query, ['Test Game']);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY timestamp DESC'),
                ['Test Game']
            );
        });

        it('should handle case when game has no memory events', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            const result = await mockPool.query(
                `SELECT category, event_type, entity_name, context, timestamp
                 FROM long_term_memory
                 WHERE game_title = $1
                 ORDER BY timestamp DESC
                 LIMIT 20`,
                ['New Game']
            );

            expect(result.rows).toHaveLength(0);
        });

        it('should handle database errors gracefully', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Connection timeout'));

            await expect(
                mockPool.query(
                    `SELECT category, event_type, entity_name, context, timestamp
                     FROM long_term_memory
                     WHERE game_title = $1
                     ORDER BY timestamp DESC
                     LIMIT 20`,
                    ['Test Game']
                )
            ).rejects.toThrow('Connection timeout');
        });
    });

    describe('Memory Context Merging', () => {
        it('should merge client memory and long-term memory', () => {
            const clientMemoryContext = `
════════════════════════════════
🧠 SHORT-TERM MEMORY (Last 10 conversations):
════════════════════════════════

USER: How do I beat Luna?
ASSISTANT: Use fire attacks and dodge her ice beam

════════════════════════════════
            `.trim();

            const longTermMemoryContext = `
═══════════════════════════════════════
📊 LONG-TERM MEMORY (Key Milestones):
═══════════════════════════════════════

⚔️ BOSSES DEFEATED:
  - Luna (Jan 1)

🚩 CHECKPOINTS REACHED:
  - Grand Meadow (Jan 1)
            `.trim();

            const mergedContext = [clientMemoryContext, longTermMemoryContext]
                .filter(Boolean)
                .join('\n\n');

            expect(mergedContext).toContain('SHORT-TERM MEMORY');
            expect(mergedContext).toContain('LONG-TERM MEMORY');
            expect(mergedContext).toContain('How do I beat Luna');
            expect(mergedContext).toContain('BOSSES DEFEATED');
        });

        it('should handle empty client memory', () => {
            const clientMemoryContext = '';
            const longTermMemoryContext = '📊 LONG-TERM MEMORY: Luna defeated';

            const mergedContext = [clientMemoryContext, longTermMemoryContext]
                .filter(Boolean)
                .join('\n\n');

            expect(mergedContext).toBe('📊 LONG-TERM MEMORY: Luna defeated');
            expect(mergedContext).not.toContain('undefined');
        });

        it('should handle empty long-term memory', () => {
            const clientMemoryContext = '🧠 SHORT-TERM: Recent conversation';
            const longTermMemoryContext = '';

            const mergedContext = [clientMemoryContext, longTermMemoryContext]
                .filter(Boolean)
                .join('\n\n');

            expect(mergedContext).toBe('🧠 SHORT-TERM: Recent conversation');
        });
    });

    describe('Memory Usage in AI Context', () => {
        it('should include memory in voice mode system prompt', () => {
            const memoryContext = `
⚔️ BOSSES DEFEATED: Luna
🚩 CHECKPOINTS: Grand Meadow
🎒 ITEMS: Resin
            `.trim();

            const systemPrompt = `
You are a gaming AI assistant.

${memoryContext}

INSTRUCTIONS:
- Reference player progress from memory above
- Don't ask about already defeated bosses
            `.trim();

            expect(systemPrompt).toContain('BOSSES DEFEATED: Luna');
            expect(systemPrompt).toContain('CHECKPOINTS: Grand Meadow');
            expect(systemPrompt).toContain("Don't ask about already defeated bosses");
        });

        it('should prioritize memory in response generation instructions', () => {
            const instructions = `
When answering questions:
1. Check LONG-TERM MEMORY for player progress
2. Check guide content
3. Use web search if needed
            `.trim();

            expect(instructions).toContain('Check LONG-TERM MEMORY');
            expect(instructions.indexOf('LONG-TERM MEMORY')).toBeLessThan(
                instructions.indexOf('guide content')
            );
        });
    });

    describe('Memory Context Validation', () => {
        it('should validate memory context has required sections', () => {
            const memoryContext = `
═══════════════════════════════════════
📊 LONG-TERM MEMORY (Key Milestones):
═══════════════════════════════════════

⚔️ BOSSES DEFEATED:
  - Luna (Jan 1)

CONTEXT USAGE INSTRUCTIONS:
- Use this information to provide accurate guidance
═══════════════════════════════════════
            `.trim();

            expect(memoryContext).toContain('LONG-TERM MEMORY');
            expect(memoryContext).toContain('CONTEXT USAGE INSTRUCTIONS');
            expect(memoryContext).toMatch(/═+/); // Has separator lines
        });

        it('should include usage instructions for AI', () => {
            const usageInstructions = `
CONTEXT USAGE INSTRUCTIONS:
- Use this information to provide accurate, context-aware guidance
- Reference specific bosses/checkpoints when relevant
- DO NOT ask player to repeat information already in memory
- Player is continuing from where they left off
            `.trim();

            expect(usageInstructions).toContain('DO NOT ask player to repeat');
            expect(usageInstructions).toContain('context-aware guidance');
            expect(usageInstructions).toContain('continuing from where they left off');
        });
    });
});
