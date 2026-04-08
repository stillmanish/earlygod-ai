// Layer 7: UI Display (<16ms) - Ultra-fast overlay updates
const EventEmitter = require('events');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class UIDisplayLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            maxUpdateRate: options.maxUpdateRate || 60, // 60 FPS max for smooth updates
            urgentUpdateRate: options.urgentUpdateRate || 120, // 120 FPS for critical situations
            batchUpdates: options.batchUpdates !== false, // Batch multiple updates
            batchWindowMs: options.batchWindowMs || 16, // 16ms = 60 FPS
            maxQueueSize: options.maxQueueSize || 100,
            displayTimeout: options.displayTimeout || 10000, // 10 seconds for normal messages
            urgentTimeout: options.urgentTimeout || 3000 // 3 seconds for urgent messages
        };
        
        this.isActive = false;
        this.sessionId = null;
        this.connectedClients = new Set(); // WebSocket connections
        
        // Display state management
        this.currentDisplay = {
            aiResponse: null,
            gameState: null,
            urgencyLevel: 1,
            lastUpdate: null
        };
        
        this.updateQueue = [];
        this.batchTimer = null;
        this.displayTimer = null;
        
        // Performance tracking
        this.stats = {
            updatesProcessed: 0,
            batchesSent: 0,
            totalUpdateTime: 0,
            avgUpdateTime: 0,
            urgentUpdates: 0,
            queueDrops: 0
        };
        
        log('🖥️ UIDisplayLayer initialized:', {
            maxFPS: this.config.maxUpdateRate,
            urgentFPS: this.config.urgentUpdateRate,
            batchWindow: `${this.config.batchWindowMs}ms`
        });
    }
    
    async start(sessionId) {
        if (this.isActive) {
            console.warn('⚠️ UI display already active');
            return;
        }
        
        this.sessionId = sessionId;
        this.isActive = true;
        
        log('🖥️ Starting UI display layer for session:', sessionId);
        this.emit('display-started', { sessionId });
    }
    
    connectClient(clientConnection) {
        this.connectedClients.add(clientConnection);
        
        log(`🔗 Client connected to UI display (${this.connectedClients.size} total)`);
        
        // Send current state to new client immediately
        if (this.currentDisplay.aiResponse || this.currentDisplay.gameState) {
            this.sendToClient(clientConnection, {
                type: 'state_sync',
                data: this.currentDisplay,
                timestamp: Date.now()
            });
        }
        
        // Handle client disconnect
        clientConnection.on('close', () => {
            this.connectedClients.delete(clientConnection);
            log(`🔌 Client disconnected from UI display (${this.connectedClients.size} remaining)`);
        });
        
        return clientConnection;
    }
    
    processAudioOutput(audioData) {
        if (!this.isActive) return;
        
        const updateStart = Date.now();
        
        const displayUpdate = {
            type: 'ai_response',
            data: {
                text: audioData.audio.text,
                urgencyLevel: audioData.audio.urgencyLevel,
                audioAvailable: true,
                audioSize: audioData.audio.audioBuffer?.length || 0,
                generationTime: audioData.audio.generationTime,
                service: audioData.audio.service,
                fromCache: audioData.audio.fromCache
            },
            timestamp: updateStart,
            urgency: audioData.audio.urgencyLevel
        };
        
        // Update current display state
        this.currentDisplay.aiResponse = displayUpdate.data;
        this.currentDisplay.urgencyLevel = displayUpdate.urgency;
        this.currentDisplay.lastUpdate = updateStart;
        
        this.queueUpdate(displayUpdate);
        
        // DON'T auto-clear messages (let them persist in the UI)
        // this.setDisplayTimer(displayUpdate.urgency); // DISABLED
    }
    
    processGameState(gameStateData) {
        if (!this.isActive) return;
        
        const updateStart = Date.now();
        
        const displayUpdate = {
            type: 'game_state',
            data: {
                health: gameStateData.analysis.health_percentage,
                enemies: gameStateData.analysis.enemies_visible,
                enemyCount: gameStateData.analysis.enemy_count,
                threatLevel: gameStateData.analysis.enemy_threat_level,
                objective: gameStateData.analysis.current_objective,
                urgentSituation: gameStateData.analysis.urgent_situation,
                recommendedAction: gameStateData.analysis.recommended_action,
                confidence: gameStateData.analysis.confidence_score
            },
            timestamp: updateStart,
            urgency: gameStateData.analysis.urgency_level || 1
        };
        
        // Only update if significant change
        if (this.hasSignificantChange(displayUpdate.data)) {
            this.currentDisplay.gameState = displayUpdate.data;
            this.queueUpdate(displayUpdate);
        }
    }
    
    processUrgentSituation(urgentData) {
        if (!this.isActive) return;
        
        const updateStart = Date.now();
        
        const displayUpdate = {
            type: 'urgent_alert',
            data: {
                situation: urgentData.situation,
                action: urgentData.recommended_action,
                urgencyLevel: urgentData.urgency_level,
                flashing: true,
                color: this.getUrgencyColor(urgentData.urgency_level)
            },
            timestamp: updateStart,
            urgency: 5, // Maximum urgency
            immediate: true // Skip batching for immediate display
        };
        
        // Urgent situations bypass normal update queue
        this.sendImmediateUpdate(displayUpdate);
        
        // Update current state
        this.currentDisplay.urgencyLevel = 5;
        this.currentDisplay.lastUpdate = updateStart;
        
        this.stats.urgentUpdates++;
        
        // Auto-clear urgent alerts faster
        this.setDisplayTimer(5);
    }
    
    hasSignificantChange(newGameState) {
        const current = this.currentDisplay.gameState;
        if (!current) return true;
        
        // Check for significant changes that warrant an update
        return (
            Math.abs((current.health || 100) - (newGameState.health || 100)) > 5 ||
            current.enemies !== newGameState.enemies ||
            current.enemyCount !== newGameState.enemyCount ||
            current.threatLevel !== newGameState.threatLevel ||
            current.urgentSituation !== newGameState.urgentSituation
        );
    }
    
    queueUpdate(displayUpdate) {
        const updateStart = Date.now();
        
        // Drop updates if queue is full (prevent memory issues)
        if (this.updateQueue.length >= this.config.maxQueueSize) {
            this.updateQueue.shift(); // Remove oldest
            this.stats.queueDrops++;
        }
        
        this.updateQueue.push(displayUpdate);
        
        // Handle immediate updates (urgent situations)
        if (displayUpdate.immediate) {
            this.flushUpdateQueue();
            return;
        }
        
        // Batch updates for performance
        if (this.config.batchUpdates) {
            if (!this.batchTimer) {
                const batchWindow = displayUpdate.urgency >= 4 ? 
                    Math.min(this.config.batchWindowMs, 8) : // 8ms for urgent (120 FPS)
                    this.config.batchWindowMs; // 16ms for normal (60 FPS)
                
                this.batchTimer = setTimeout(() => {
                    this.flushUpdateQueue();
                }, batchWindow);
            }
        } else {
            // Send immediately without batching
            this.flushUpdateQueue();
        }
        
        const processTime = Date.now() - updateStart;
        this.updateStats(processTime);
    }
    
    flushUpdateQueue() {
        if (this.updateQueue.length === 0) return;
        
        const flushStart = Date.now();
        
        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        // Create batch update
        const batchUpdate = {
            type: 'batch_update',
            updates: [...this.updateQueue],
            batchSize: this.updateQueue.length,
            timestamp: flushStart,
            sessionId: this.sessionId
        };
        
        // Clear queue
        this.updateQueue.length = 0;
        
        // Send to all connected clients
        this.broadcastToClients(batchUpdate);
        
        const flushTime = Date.now() - flushStart;
        this.stats.batchesSent++;
        
        log(`🖥️ Batch update sent: ${batchUpdate.batchSize} updates [${flushTime}ms]`);
    }
    
    sendImmediateUpdate(displayUpdate) {
        const immediateStart = Date.now();
        
        const immediateMessage = {
            type: 'immediate_update',
            update: displayUpdate,
            timestamp: immediateStart,
            sessionId: this.sessionId
        };
        
        this.broadcastToClients(immediateMessage);
        
        const sendTime = Date.now() - immediateStart;
        log(`🚨 Immediate update sent: ${displayUpdate.type} [${sendTime}ms]`);
    }
    
    broadcastToClients(message) {
        const sendStart = Date.now();
        let sentCount = 0;
        let errors = 0;
        
        for (const client of this.connectedClients) {
            try {
                if (client.readyState === 1) { // WebSocket.OPEN
                    this.sendToClient(client, message);
                    sentCount++;
                } else {
                    // Clean up dead connections
                    this.connectedClients.delete(client);
                }
            } catch (error) {
                console.warn('⚠️ Error sending to client:', error.message);
                this.connectedClients.delete(client);
                errors++;
            }
        }
        
        const sendTime = Date.now() - sendStart;
        
        // Log performance for large broadcasts
        if (sentCount > 0) {
            log(`📡 Broadcast: ${sentCount} clients, ${sendTime}ms total (${(sendTime/sentCount).toFixed(1)}ms/client)`);
        }
        
        if (errors > 0) {
            console.warn(`⚠️ Broadcast errors: ${errors} failed sends`);
        }
    }
    
    sendToClient(client, message) {
        const messageStr = JSON.stringify(message);
        client.send(messageStr);
    }
    
    getUrgencyColor(urgencyLevel) {
        switch (urgencyLevel) {
            case 5: return '#FF0000'; // Critical red
            case 4: return '#FF6600'; // Warning orange
            case 3: return '#FFFF00'; // Attention yellow
            case 2: return '#00CCFF'; // Info blue
            default: return '#FFFFFF'; // Normal white
        }
    }
    
    setDisplayTimer(urgencyLevel) {
        // Clear existing timer
        if (this.displayTimer) {
            clearTimeout(this.displayTimer);
        }
        
        // Set timeout based on urgency
        const timeout = urgencyLevel >= 4 ? 
            this.config.urgentTimeout : 
            this.config.displayTimeout;
        
        this.displayTimer = setTimeout(() => {
            this.clearDisplay();
        }, timeout);
    }
    
    clearDisplay() {
        const clearUpdate = {
            type: 'clear_display',
            timestamp: Date.now(),
            sessionId: this.sessionId
        };
        
        // Reset current display state
        this.currentDisplay = {
            aiResponse: null,
            gameState: null,
            urgencyLevel: 1,
            lastUpdate: null
        };
        
        this.broadcastToClients(clearUpdate);
        
        log('🧹 Display cleared');
    }
    
    updateStats(processTime) {
        this.stats.updatesProcessed++;
        this.stats.totalUpdateTime += processTime;
        this.stats.avgUpdateTime = this.stats.totalUpdateTime / this.stats.updatesProcessed;
        
        // Log performance every 100 updates
        if (this.stats.updatesProcessed % 100 === 0) {
            log(`📊 UI Display: ${this.stats.updatesProcessed} updates, ${this.stats.batchesSent} batches, avg ${this.stats.avgUpdateTime.toFixed(2)}ms`);
            log(`   ⚡ Urgent: ${this.stats.urgentUpdates}, Drops: ${this.stats.queueDrops}`);
        }
    }
    
    // Method to manually trigger display of text (for testing or special cases)
    displayText(text, options = {}) {
        if (!this.isActive) return;
        
        const displayUpdate = {
            type: 'text_display',
            data: {
                text: text,
                urgencyLevel: options.urgencyLevel || 1,
                duration: options.duration || this.config.displayTimeout,
                color: options.color || this.getUrgencyColor(options.urgencyLevel || 1),
                position: options.position || 'center'
            },
            timestamp: Date.now(),
            urgency: options.urgencyLevel || 1,
            immediate: options.immediate || false
        };
        
        this.queueUpdate(displayUpdate);
        
        if (options.duration) {
            setTimeout(() => {
                this.clearDisplay();
            }, options.duration);
        }
    }
    
    // Health and status overlay
    updateHealthDisplay(healthData) {
        if (!this.isActive) return;
        
        const displayUpdate = {
            type: 'health_display',
            data: {
                health: healthData.percentage,
                color: healthData.percentage < 30 ? '#FF0000' : 
                       healthData.percentage < 60 ? '#FFFF00' : '#00FF00',
                flashing: healthData.percentage < 20,
                position: 'top_left'
            },
            timestamp: Date.now(),
            urgency: healthData.percentage < 30 ? 4 : 1
        };
        
        this.queueUpdate(displayUpdate);
    }
    
    async stop() {
        if (!this.isActive) {
            console.warn('⚠️ UI display not active');
            return;
        }
        
        log('🛑 Stopping UI display layer');
        this.isActive = false;
        
        // Clear timers
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        if (this.displayTimer) {
            clearTimeout(this.displayTimer);
            this.displayTimer = null;
        }
        
        // Flush any remaining updates
        this.flushUpdateQueue();
        
        // Disconnect all clients
        for (const client of this.connectedClients) {
            try {
                client.close();
            } catch (error) {
                console.warn('⚠️ Error closing client connection:', error.message);
            }
        }
        this.connectedClients.clear();
        
        this.emit('display-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        // Clear state
        this.sessionId = null;
        this.currentDisplay = {
            aiResponse: null,
            gameState: null,
            urgencyLevel: 1,
            lastUpdate: null
        };
        this.updateQueue.length = 0;
    }
    
    getStats() {
        return {
            ...this.stats,
            isActive: this.isActive,
            sessionId: this.sessionId,
            connectedClients: this.connectedClients.size,
            queueSize: this.updateQueue.length,
            currentDisplay: this.currentDisplay,
            config: this.config
        };
    }
    
    getCurrentDisplay() {
        return this.currentDisplay;
    }
    
    getConnectedClientsCount() {
        return this.connectedClients.size;
    }
    
    // Force immediate refresh of all clients
    forceRefresh() {
        const refreshUpdate = {
            type: 'force_refresh',
            data: this.currentDisplay,
            timestamp: Date.now(),
            sessionId: this.sessionId
        };
        
        this.broadcastToClients(refreshUpdate);
        log('🔄 Forced refresh sent to all clients');
    }
    
    // Update configuration dynamically
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        log('🔧 UI display config updated:', newConfig);
        
        // Apply immediate changes
        if (newConfig.maxUpdateRate) {
            this.config.batchWindowMs = Math.floor(1000 / newConfig.maxUpdateRate);
        }
    }
}

module.exports = UIDisplayLayer;
