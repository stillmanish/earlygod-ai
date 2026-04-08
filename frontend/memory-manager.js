// Client-Side Memory Manager
// Stores recent conversation history in LocalStorage (Electron persistent storage)
// Prevents memory loss on backend restarts
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class ClientMemoryManager {
    constructor() {
        this.storageKey = 'earlygod_memory';
        this.maxConversations = 15; // Last 15 exchanges per game
        this.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

        // Auto-prune on initialization
        this._autoPrune();

        // Set up periodic auto-pruning (every 6 hours)
        this.pruneInterval = setInterval(() => {
            this._autoPrune();
        }, 6 * 60 * 60 * 1000);

        log('✅ Client-side memory manager initialized with auto-pruning');
    }

    // Get all memories for a specific game
    getGameMemory(gameTitle) {
        const allMemory = this._loadFromStorage();
        const gameMemory = allMemory[gameTitle] || [];

        // Filter out old memories (>7 days)
        const cutoffTime = Date.now() - this.maxAge;
        const recentMemory = gameMemory.filter(m => m.timestamp > cutoffTime);

        // Keep only last 15
        return recentMemory.slice(-this.maxConversations);
    }

    // Add a new conversation turn
    addConversation(gameTitle, userMessage, aiResponse) {
        const allMemory = this._loadFromStorage();

        if (!allMemory[gameTitle]) {
            allMemory[gameTitle] = [];
        }

        // Add new conversation
        allMemory[gameTitle].push({
            userMessage,
            aiResponse,
            timestamp: Date.now(),
            gameTitle
        });

        // Keep only last 15
        if (allMemory[gameTitle].length > this.maxConversations) {
            allMemory[gameTitle] = allMemory[gameTitle].slice(-this.maxConversations);
        }

        this._saveToStorage(allMemory);
    }

    // Get formatted context string for AI prompts
    getFormattedContext(gameTitle) {
        const memory = this.getGameMemory(gameTitle);

        if (memory.length === 0) {
            return '';
        }

        let context = `\n## RECENT CONVERSATION (Last ${memory.length} exchanges)\n`;

        memory.forEach((turn, index) => {
            context += `\n${index + 1}. User: ${turn.userMessage}\n`;
            context += `   AI: ${turn.aiResponse.substring(0, 150)}${turn.aiResponse.length > 150 ? '...' : ''}\n`;
        });

        return context;
    }

    // Clear memory for a specific game
    clearGameMemory(gameTitle) {
        const allMemory = this._loadFromStorage();
        delete allMemory[gameTitle];
        this._saveToStorage(allMemory);
        log(`🧹 Cleared memory for: ${gameTitle}`);
    }

    // Clear all memory
    clearAllMemory() {
        localStorage.removeItem(this.storageKey);
        log('🧹 Cleared all memory');
    }

    // Get memory statistics
    getStats() {
        const allMemory = this._loadFromStorage();
        const stats = {
            totalGames: Object.keys(allMemory).length,
            gameBreakdown: {}
        };

        for (const [game, memory] of Object.entries(allMemory)) {
            stats.gameBreakdown[game] = {
                conversations: memory.length,
                oldestTimestamp: memory.length > 0 ? memory[0].timestamp : null,
                newestTimestamp: memory.length > 0 ? memory[memory.length - 1].timestamp : null
            };
        }

        return stats;
    }

    // Export memory (for backup)
    exportMemory() {
        return this._loadFromStorage();
    }

    // Import memory (from backup)
    importMemory(memoryData) {
        this._saveToStorage(memoryData);
        log('✅ Memory imported successfully');
    }

    // Private: Load from LocalStorage
    _loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.error('❌ Failed to load memory from storage:', error);
            return {};
        }
    }

    // Private: Save to LocalStorage
    _saveToStorage(memoryData) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(memoryData));
        } catch (error) {
            console.error('❌ Failed to save memory to storage:', error);
            // Check if quota exceeded
            if (error.name === 'QuotaExceededError') {
                console.warn('⚠️ LocalStorage quota exceeded - clearing old data');
                this._pruneOldMemories();
            }
        }
    }

    // Private: Prune old memories if storage is full
    _pruneOldMemories() {
        const allMemory = this._loadFromStorage();
        const cutoffTime = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 days instead of 7

        for (const game in allMemory) {
            allMemory[game] = allMemory[game].filter(m => m.timestamp > cutoffTime);
            // Also limit to last 10 instead of 15
            if (allMemory[game].length > 10) {
                allMemory[game] = allMemory[game].slice(-10);
            }
        }

        this._saveToStorage(allMemory);
        log('🧹 Pruned old memories due to storage limit');
    }

    // Private: Automatic pruning (runs on init and periodically)
    _autoPrune() {
        const allMemory = this._loadFromStorage();
        const cutoffTime = Date.now() - this.maxAge;
        let pruneCount = 0;

        for (const game in allMemory) {
            const originalLength = allMemory[game].length;

            // Remove old memories
            allMemory[game] = allMemory[game].filter(m => m.timestamp > cutoffTime);

            // Enforce max conversations limit
            if (allMemory[game].length > this.maxConversations) {
                allMemory[game] = allMemory[game].slice(-this.maxConversations);
            }

            // Remove game entry if no memories left
            if (allMemory[game].length === 0) {
                delete allMemory[game];
            }

            pruneCount += originalLength - (allMemory[game]?.length || 0);
        }

        if (pruneCount > 0) {
            this._saveToStorage(allMemory);
            log(`🧹 Auto-pruned ${pruneCount} old memory entries`);
        }
    }

    // Clean up interval on destroy
    destroy() {
        if (this.pruneInterval) {
            clearInterval(this.pruneInterval);
            log('✅ Memory manager cleanup complete');
        }
    }
}

// Initialize global instance
window.clientMemory = new ClientMemoryManager();

log('✅ Client-side memory manager initialized');
