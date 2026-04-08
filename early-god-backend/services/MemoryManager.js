// Memory Manager - CRUD operations for short-term and long-term memory
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class MemoryManager {
    constructor(dbPath = null) {
        // Use provided path or default to database/ directory
        this.dbPath = dbPath || path.join(__dirname, '..', 'database', 'memory.db');
        
        // Ensure database directory exists
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('❌ Failed to open memory database:', err);
            } else {
                log('✅ Memory database opened:', this.dbPath);
                this.initializeSchema();
            }
        });
    }
    
    async initializeSchema() {
        const schemaPath = path.join(__dirname, '..', 'database', 'memory-schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            console.error('❌ Schema file not found:', schemaPath);
            return;
        }
        
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        return new Promise((resolve, reject) => {
            this.db.exec(schema, (err) => {
                if (err) {
                    console.error('❌ Failed to initialize schema:', err);
                    reject(err);
                } else {
                    log('✅ Memory database schema initialized');
                    resolve();
                }
            });
        });
    }
    
    // ========================================
    // SHORT-TERM MEMORY (Conversation History)
    // ========================================
    
    async addShortTermMessage(sessionId, gameTitle, userMessage, aiResponse) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO short_term_memory (session_id, game_title, user_message, ai_response)
                VALUES (?, ?, ?, ?)
            `, [sessionId, gameTitle, userMessage, aiResponse], function(err) {
                if (err) {
                    console.error('❌ Failed to add short-term message:', err);
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }
    
    async getRecentMessages(sessionId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM short_term_memory 
                WHERE session_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [sessionId, limit], (err, rows) => {
                if (err) {
                    console.error('❌ Failed to get recent messages:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    async getLastSessionMessages(gameTitle, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM short_term_memory 
                WHERE game_title = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [gameTitle, limit], (err, rows) => {
                if (err) {
                    console.error('❌ Failed to get last session messages:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    async clearSessionMessages(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                DELETE FROM short_term_memory 
                WHERE session_id = ?
            `, [sessionId], function(err) {
                if (err) {
                    console.error('❌ Failed to clear session messages:', err);
                    reject(err);
                } else {
                    log(`✅ Cleared ${this.changes} messages for session ${sessionId}`);
                    resolve(this.changes);
                }
            });
        });
    }
    
    // ========================================
    // LONG-TERM MEMORY (Event Storage)
    // ========================================
    
    async storeEvent(event) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO long_term_events 
                (game_title, category, event_type, entity_name, context, metadata, source, confidence, validation_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                event.game_title,
                event.category,
                event.event_type || 'mentioned',
                event.entity_name,
                event.context,
                JSON.stringify(event.metadata || {}),
                event.source || 'conversation',
                event.confidence || 1.0,
                event.validation_method || 'regex'
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to store event:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, ...event });
                }
            });
        });
    }
    
    async storeEvents(events, gameTitle) {
        const results = [];
        for (const event of events) {
            // Extract entity name from entities object
            const entityName = event.entities[event.category] ?
                (Array.isArray(event.entities[event.category]) ?
                    event.entities[event.category][0] :
                    event.entities[event.category]) :
                'unknown';

            // Skip if entity is unknown or empty
            if (!entityName || entityName === 'unknown' || entityName.trim() === '') continue;

            // Deduplicate: check if this exact event was already stored recently
            const isDuplicate = await this.isDuplicateEvent(gameTitle, event.category, entityName);
            if (isDuplicate) {
                log(`⏭️ Skipping duplicate event: ${event.category} - ${entityName}`);
                continue;
            }

            const result = await this.storeEvent({
                game_title: gameTitle,
                category: event.category,
                entity_name: entityName,
                context: event.rawText,
                metadata: event.entities,
                confidence: event.confidence,
                validation_method: event.entities.method || (event.validated ? 'gemini' : 'regex')
            });
            results.push(result);
        }

        return results;
    }

    async isDuplicateEvent(gameTitle, category, entityName) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT id FROM long_term_events
                WHERE game_title = ? AND category = ? AND entity_name = ? AND is_active = 1
                AND timestamp > datetime('now', '-1 hour')
            `, [gameTitle, category, entityName], (err, row) => {
                if (err) {
                    console.error('❌ Duplicate check failed:', err);
                    resolve(false); // Don't block on error
                } else {
                    resolve(!!row);
                }
            });
        });
    }
    
    async getActiveEvents(gameTitle, category = null, limit = 20) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT * FROM long_term_events 
                WHERE game_title = ? AND is_active = 1
            `;
            const params = [gameTitle];
            
            if (category) {
                query += ` AND category = ?`;
                params.push(category);
            }
            
            query += ` ORDER BY timestamp DESC LIMIT ?`;
            params.push(limit);
            
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Failed to get active events:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    async getRecentEvents(gameTitle, limit = 20) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM long_term_events 
                WHERE game_title = ? AND is_active = 1
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [gameTitle, limit], (err, rows) => {
                if (err) {
                    console.error('❌ Failed to get recent events:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    // Conflict resolution: Update outdated events
    async updateEvent(gameTitle, category, newEntityName, newContext) {
        // Find existing active event in this category
        const existing = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM long_term_events 
                WHERE game_title = ? AND category = ? AND is_active = 1
                ORDER BY timestamp DESC LIMIT 1
            `, [gameTitle, category], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existing && existing.entity_name !== newEntityName) {
            // Mark old event as superseded
            const newEvent = await this.storeEvent({
                game_title: gameTitle,
                category,
                entity_name: newEntityName,
                context: newContext,
                confidence: 0.95,
                is_active: 1
            });
            
            await new Promise((resolve, reject) => {
                this.db.run(`
                    UPDATE long_term_events 
                    SET is_active = 0, superseded_by = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [newEvent.id, existing.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            log(`✅ Conflict resolved: ${category} changed from "${existing.entity_name}" to "${newEntityName}"`);
            return newEvent;
        }
        
        // No conflict - just store new event
        return await this.storeEvent({
            game_title: gameTitle,
            category,
            entity_name: newEntityName,
            context: newContext,
            confidence: 0.95,
            is_active: 1
        });
    }
    
    // ========================================
    // SESSION STATE (Resume Feature)
    // ========================================
    
    async updateSessionState(gameTitle, state) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT OR REPLACE INTO session_state 
                (game_title, last_session_id, last_played, last_location, last_level, last_objective, screen_state, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                gameTitle,
                state.session_id,
                state.location,
                state.level,
                state.objective,
                JSON.stringify(state.screen_state || {})
            ], (err) => {
                if (err) {
                    console.error('❌ Failed to update session state:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    
    async getSessionState(gameTitle) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM session_state 
                WHERE game_title = ?
            `, [gameTitle], (err, row) => {
                if (err) {
                    console.error('❌ Failed to get session state:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }
    
    // ========================================
    // USER PREFERENCES
    // ========================================
    
    async savePreference(key, value, category = null) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT OR REPLACE INTO user_preferences (key, value, category, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [key, value, category], (err) => {
                if (err) {
                    console.error('❌ Failed to save preference:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    
    async getPreference(key) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT value FROM user_preferences 
                WHERE key = ?
            `, [key], (err, row) => {
                if (err) {
                    console.error('❌ Failed to get preference:', err);
                    reject(err);
                } else {
                    resolve(row ? row.value : null);
                }
            });
        });
    }
    
    async getAllPreferences(category = null) {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM user_preferences';
            const params = [];
            
            if (category) {
                query += ' WHERE category = ?';
                params.push(category);
            }
            
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Failed to get preferences:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    // ========================================
    // CLEANUP & MAINTENANCE
    // ========================================
    
    async pruneOldMessages(daysOld = 7) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                DELETE FROM short_term_memory 
                WHERE timestamp < datetime('now', '-${daysOld} days')
            `, (err) => {
                if (err) {
                    console.error('❌ Failed to prune old messages:', err);
                    reject(err);
                } else {
                    log(`✅ Pruned messages older than ${daysOld} days`);
                    resolve();
                }
            });
        });
    }
    
    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                log('✅ Memory database closed');
            }
        });
    }
}

module.exports = MemoryManager;

