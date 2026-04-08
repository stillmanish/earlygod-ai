/**
 * Memory Formatting Tests
 * Tests for formatLongTermMemory helper function
 */

describe('formatLongTermMemory', () => {
    // Copy the function for testing
    function formatLongTermMemory(events) {
        if (!events || events.length === 0) {
            return '';
        }

        let formatted = '═══════════════════════════════════════\n';
        formatted += '📊 LONG-TERM MEMORY (Key Milestones):\n';
        formatted += '═══════════════════════════════════════\n\n';

        // Group events by category
        const bosses = events.filter(e => e.category === 'boss');
        const checkpoints = events.filter(e => e.category === 'checkpoint');
        const items = events.filter(e => e.category === 'item');
        const deaths = events.filter(e => e.category === 'death');
        const locations = events.filter(e => e.category === 'location');
        const levels = events.filter(e => e.category === 'level');

        // Format bosses
        if (bosses.length > 0) {
            formatted += '⚔️ BOSSES DEFEATED:\n';
            bosses.forEach(b => {
                const date = new Date(b.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                formatted += `  - ${b.entity_name} (${date})`;
                if (b.context && !b.context.startsWith('[Auto-detected]')) {
                    formatted += ` - ${b.context}`;
                }
                formatted += '\n';
            });
            formatted += '\n';
        }

        // Format checkpoints
        if (checkpoints.length > 0) {
            formatted += '🚩 CHECKPOINTS REACHED:\n';
            checkpoints.forEach(c => {
                const date = new Date(c.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                formatted += `  - ${c.entity_name} (${date})\n`;
            });
            formatted += '\n';
        }

        // Format locations
        if (locations.length > 0) {
            formatted += '📍 LOCATIONS VISITED:\n';
            const recentLocations = locations.slice(0, 5);
            recentLocations.forEach(l => {
                const date = new Date(l.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                formatted += `  - ${l.entity_name} (${date})\n`;
            });
            formatted += '\n';
        }

        // Format important items
        if (items.length > 0) {
            formatted += '🎒 IMPORTANT ITEMS:\n';
            items.forEach(i => {
                const date = new Date(i.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                formatted += `  - ${i.entity_name} (${date})`;
                if (i.context && !i.context.startsWith('[Auto-detected]')) {
                    formatted += ` - ${i.context}`;
                }
                formatted += '\n';
            });
            formatted += '\n';
        }

        // Format deaths (last 3 only)
        if (deaths.length > 0) {
            formatted += '💀 RECENT DEATHS:\n';
            const recentDeaths = deaths.slice(0, 3);
            recentDeaths.forEach(d => {
                const date = new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                formatted += `  - ${d.entity_name} (${date})\n`;
            });
            formatted += '\n';
        }

        // Format levels
        if (levels.length > 0) {
            const latestLevel = levels[0];
            formatted += `🆙 CURRENT LEVEL: ${latestLevel.entity_name}\n\n`;
        }

        formatted += '═══════════════════════════════════════\n';
        formatted += 'CONTEXT USAGE INSTRUCTIONS:\n';
        formatted += '- Use this information to provide accurate, context-aware guidance\n';
        formatted += '- Reference specific bosses/checkpoints when relevant\n';
        formatted += '- DO NOT ask player to repeat information already in memory\n';
        formatted += '- Player is continuing from where they left off\n';
        formatted += '═══════════════════════════════════════\n';

        return formatted;
    }

    it('should return empty string for null events', () => {
        const result = formatLongTermMemory(null);
        expect(result).toBe('');
    });

    it('should return empty string for empty events array', () => {
        const result = formatLongTermMemory([]);
        expect(result).toBe('');
    });

    it('should format boss defeat events correctly', () => {
        const events = [
            {
                category: 'boss',
                entity_name: 'Luna',
                timestamp: '2026-01-01T12:00:00Z',
                context: 'Defeated after 3 attempts'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('⚔️ BOSSES DEFEATED:');
        expect(result).toContain('Luna');
        expect(result).toContain('Defeated after 3 attempts');
        expect(result).toContain('LONG-TERM MEMORY');
    });

    it('should format checkpoint events correctly', () => {
        const events = [
            {
                category: 'checkpoint',
                entity_name: 'Grand Meadow',
                timestamp: '2026-01-01T12:00:00Z'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('🚩 CHECKPOINTS REACHED:');
        expect(result).toContain('Grand Meadow');
    });

    it('should format item events correctly', () => {
        const events = [
            {
                category: 'item',
                entity_name: 'Resin',
                timestamp: '2026-01-01T12:00:00Z'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('🎒 IMPORTANT ITEMS:');
        expect(result).toContain('Resin');
    });

    it('should format mixed events correctly', () => {
        const events = [
            {
                category: 'boss',
                entity_name: 'Luna',
                timestamp: '2026-01-01T10:00:00Z'
            },
            {
                category: 'checkpoint',
                entity_name: 'Grand Meadow',
                timestamp: '2026-01-01T11:00:00Z'
            },
            {
                category: 'item',
                entity_name: 'Resin',
                timestamp: '2026-01-01T12:00:00Z'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('⚔️ BOSSES DEFEATED:');
        expect(result).toContain('Luna');
        expect(result).toContain('🚩 CHECKPOINTS REACHED:');
        expect(result).toContain('Grand Meadow');
        expect(result).toContain('🎒 IMPORTANT ITEMS:');
        expect(result).toContain('Resin');
    });

    it('should exclude auto-detected context from display', () => {
        const events = [
            {
                category: 'boss',
                entity_name: 'Luna',
                timestamp: '2026-01-01T12:00:00Z',
                context: '[Auto-detected] Victory screen visible'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('Luna');
        expect(result).not.toContain('[Auto-detected]');
        expect(result).not.toContain('Victory screen visible');
    });

    it('should limit locations to 5 most recent', () => {
        const events = Array.from({ length: 10 }, (_, i) => ({
            category: 'location',
            entity_name: `Location ${i + 1}`,
            timestamp: new Date(2026, 0, i + 1).toISOString()
        }));

        const result = formatLongTermMemory(events);

        expect(result).toContain('📍 LOCATIONS VISITED:');
        // Should only show 5 locations
        const locationMatches = result.match(/Location \d+/g);
        expect(locationMatches).toHaveLength(5);
    });

    it('should limit deaths to 3 most recent', () => {
        const events = Array.from({ length: 10 }, (_, i) => ({
            category: 'death',
            entity_name: `Enemy ${i + 1}`,
            timestamp: new Date(2026, 0, i + 1).toISOString()
        }));

        const result = formatLongTermMemory(events);

        expect(result).toContain('💀 RECENT DEATHS:');
        // Should only show 3 deaths
        const deathMatches = result.match(/Enemy \d+/g);
        expect(deathMatches).toHaveLength(3);
    });

    it('should include context usage instructions', () => {
        const events = [
            {
                category: 'boss',
                entity_name: 'Luna',
                timestamp: '2026-01-01T12:00:00Z'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('CONTEXT USAGE INSTRUCTIONS:');
        expect(result).toContain('Use this information to provide accurate, context-aware guidance');
        expect(result).toContain('DO NOT ask player to repeat information already in memory');
    });

    it('should format dates in readable format', () => {
        const events = [
            {
                category: 'boss',
                entity_name: 'Luna',
                timestamp: '2026-01-15T12:00:00Z'
            }
        ];

        const result = formatLongTermMemory(events);

        // Should contain month and day in format like "Jan 15"
        expect(result).toMatch(/Jan \d+|Feb \d+|Mar \d+/);
    });

    it('should show current level for level events', () => {
        const events = [
            {
                category: 'level',
                entity_name: '25',
                timestamp: '2026-01-01T12:00:00Z'
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('🆙 CURRENT LEVEL: 25');
    });

    it('should handle events without context gracefully', () => {
        const events = [
            {
                category: 'boss',
                entity_name: 'Luna',
                timestamp: '2026-01-01T12:00:00Z'
                // No context field
            }
        ];

        const result = formatLongTermMemory(events);

        expect(result).toContain('Luna');
        expect(result).not.toContain('undefined');
        expect(result).not.toContain('null');
    });
});
