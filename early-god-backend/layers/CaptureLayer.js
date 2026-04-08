// Layer 1: Capture (Real-time) - Screen + Audio
// Desktop packages - only available in environments with GUI support
let screenshot, activeWin;
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
try {
    screenshot = require('screenshot-desktop');
    activeWin = require('active-win');
    log('✅ Desktop capture packages loaded');
} catch (error) {
    console.warn('⚠️ Desktop capture packages not available (headless server)');
    screenshot = null;
    activeWin = null;
}
const sharp = require('sharp');
const EventEmitter = require('events');

class CaptureLayer extends EventEmitter {
    constructor(options = {}) {
        super();
        this.fps = options.fps || 3; // 1-3 FPS as per Cluely architecture
        this.targetWidth = options.width || 1280;
        this.targetHeight = options.height || 720;
        this.quality = options.quality || 80; // JPEG compression quality
        
        this.isCapturing = false;
        this.captureInterval = null;
        this.currentGameProcess = null;
        this.sessionId = null;
        
        // Performance tracking
        this.stats = {
            framesProcessed: 0,
            totalCaptureTime: 0,
            avgCaptureTime: 0
        };
        
        log('🎮 CaptureLayer initialized:', {
            fps: this.fps,
            resolution: `${this.targetWidth}x${this.targetHeight}`,
            quality: `${this.quality}%`
        });
    }
    
    async startCapture(sessionId, gameProcess = null) {
        if (this.isCapturing) {
            console.warn('⚠️ Capture already running');
            return;
        }
        
        // Check if desktop capture is available
        if (!screenshot) {
            console.warn('⚠️ Screen capture not available in headless environment');
            this.emit('capture-error', {
                sessionId,
                error: 'Screen capture not available in headless server environment',
                timestamp: new Date()
            });
            return false;
        }
        
        this.sessionId = sessionId;
        this.currentGameProcess = gameProcess;
        this.isCapturing = true;
        
        // Calculate interval from FPS (1 FPS = 1000ms, 3 FPS = 333ms)
        const intervalMs = Math.floor(1000 / this.fps);
        
        log(`🎬 Starting screen capture at ${this.fps} FPS (${intervalMs}ms intervals)`);
        log(`   📺 Target game process: ${gameProcess || 'any'}`);
        
        this.captureInterval = setInterval(async () => {
            await this.captureFrame();
        }, intervalMs);
        
        // Emit initial status
        this.emit('capture-started', {
            sessionId,
            fps: this.fps,
            gameProcess
        });
    }
    
    async stopCapture() {
        if (!this.isCapturing) {
            console.warn('⚠️ Capture not running');
            return;
        }
        
        log('🛑 Stopping screen capture');
        this.isCapturing = false;
        
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }
        
        this.emit('capture-stopped', {
            sessionId: this.sessionId,
            stats: this.stats
        });
        
        // Reset state
        this.sessionId = null;
        this.currentGameProcess = null;
    }
    
    async captureFrame() {
        if (!this.isCapturing) return;
        
        const captureStart = Date.now();
        
        try {
            // Detect active game window if process specified (only if activeWin is available)
            let isTargetGame = true;
            if (this.currentGameProcess && activeWin) {
                try {
                    const activeWindow = await activeWin();
                    isTargetGame = activeWindow && 
                        activeWindow.owner && 
                        activeWindow.owner.name.toLowerCase().includes(this.currentGameProcess.toLowerCase());
                    
                    if (!isTargetGame) {
                        // Skip capture if target game not focused
                        return;
                    }
                } catch (winError) {
                    console.warn('⚠️ Could not detect active window:', winError.message);
                    // Continue with capture anyway
                }
            } else if (this.currentGameProcess && !activeWin) {
                console.warn('⚠️ Game process detection not available in headless environment');
            }
            
            // Capture screenshot (only if screenshot package is available)
            if (!screenshot) {
                throw new Error('Screenshot capture not available in headless environment');
            }
            const rawBuffer = await screenshot({ format: 'png' });
            
            // Resize and compress using Sharp (faster than Jimp)
            const processedBuffer = await sharp(rawBuffer)
                .resize(this.targetWidth, this.targetHeight, {
                    fit: 'inside',
                    withoutEnlargement: false
                })
                .jpeg({ quality: this.quality })
                .toBuffer();
            
            const captureTime = Date.now() - captureStart;
            
            // Update performance stats
            this.stats.framesProcessed++;
            this.stats.totalCaptureTime += captureTime;
            this.stats.avgCaptureTime = this.stats.totalCaptureTime / this.stats.framesProcessed;
            
            // Emit frame for processing by next layer
            this.emit('frame-captured', {
                sessionId: this.sessionId,
                timestamp: new Date(),
                frameBuffer: processedBuffer,
                frameSize: processedBuffer.length,
                captureTime,
                isTargetGame,
                resolution: `${this.targetWidth}x${this.targetHeight}`
            });
            
            // Log performance every 30 frames
            if (this.stats.framesProcessed % 30 === 0) {
                log(`📊 Capture performance: ${this.stats.framesProcessed} frames, avg ${Math.round(this.stats.avgCaptureTime)}ms/frame`);
            }
            
        } catch (error) {
            console.error('❌ Frame capture error:', error.message);
            this.emit('capture-error', {
                sessionId: this.sessionId,
                error: error.message,
                timestamp: new Date()
            });
        }
    }
    
    // Audio routing functionality would go here
    // For now, we'll rely on the existing WebSocket voice system
    async startAudioCapture(sessionId) {
        log('🎤 Audio capture integration with existing voice system');
        // The existing OpenAI Realtime API handles audio capture
        // We can enhance this later with VoiceMeeter Banana integration
        this.emit('audio-capture-ready', { sessionId });
    }
    
    async stopAudioCapture() {
        log('🔇 Audio capture stopped');
        this.emit('audio-capture-stopped');
    }
    
    getStats() {
        return {
            ...this.stats,
            isCapturing: this.isCapturing,
            currentFPS: this.fps,
            sessionId: this.sessionId,
            gameProcess: this.currentGameProcess
        };
    }
    
    updateFPS(newFPS) {
        if (newFPS < 1 || newFPS > 10) {
            console.warn('⚠️ FPS should be between 1-10 for optimal performance');
            return;
        }
        
        const oldFPS = this.fps;
        this.fps = newFPS;
        
        log(`🎬 FPS updated: ${oldFPS} -> ${newFPS}`);
        
        // Restart capture with new FPS if currently capturing
        if (this.isCapturing) {
            const sessionId = this.sessionId;
            const gameProcess = this.currentGameProcess;
            this.stopCapture();
            setTimeout(() => {
                this.startCapture(sessionId, gameProcess);
            }, 100);
        }
    }
}

module.exports = CaptureLayer;
