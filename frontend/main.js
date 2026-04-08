const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, shell, dialog } = require('electron');
const path = require('path');
const { GameDetector } = require('./gameDetection');

// Try to load auto-updater, but don't crash if it fails
let autoUpdater = null;
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
    console.warn('⚠️ Auto-updater not available - app will continue without auto-update functionality');
}

// Production mode detection and console hiding
// Default to production mode unless explicitly in dev mode
const isProduction = !process.env.ELECTRON_IS_DEV;
const isDevelopment = !isProduction;

if (isProduction) {
    // Disable console output in production
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error
    };
    
    console.log = console.warn = () => {}; // Hide info/warn logs
    console.error = originalConsole.error; // Keep error logs for debugging
    
    log('🚀 EarlyGod.ai Beta - Production Mode');
}

// ============================================
// PERSISTENT STORAGE CONFIGURATION
// ============================================
// Conversation storage (lazy loaded, separate from auth store)
let conversationStore = null;

async function initializeConversationStore() {
    if (!conversationStore) {
        const Store = (await import('electron-store')).default;
        conversationStore = new Store({
            name: 'earlygod-conversations',
            defaults: {
                archivedConversations: [],
                settings: {}
            }
        });
        log('💾 Conversation storage initialized at:', conversationStore.path);
    }
    return conversationStore;
}

// IPC handlers for persistent storage (replaces localStorage)
ipcMain.handle('store-get', async (event, key) => {
    const store = await initializeConversationStore();
    return store.get(key);
});

ipcMain.handle('store-set', async (event, key, value) => {
    const store = await initializeConversationStore();
    store.set(key, value);
    return true;
});

ipcMain.handle('store-delete', async (event, key) => {
    const store = await initializeConversationStore();
    store.delete(key);
    return true;
});

ipcMain.handle('store-clear', async () => {
    const store = await initializeConversationStore();
    store.clear();
    return true;
});

// ============================================
// AUTO-UPDATE CONFIGURATION
// ============================================
// Configure auto-updater for production builds (only if available)
if (isProduction && autoUpdater) {
    // Configure update logging
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';
    
    // Auto-update configuration
    autoUpdater.autoDownload = false; // Ask user before downloading
    autoUpdater.autoInstallOnAppQuit = true; // Auto install when app closes
    
    // Update event handlers
    autoUpdater.on('checking-for-update', () => {
        log('🔍 Checking for updates...');
    });
    
    autoUpdater.on('update-available', (info) => {
        log('✨ Update available:', info.version);
        
        // Notify user about available update
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Available',
                message: `A new version (${info.version}) is available!`,
                detail: 'Would you like to download and install it now? The app will restart after installation.',
                buttons: ['Download & Install', 'Later'],
                defaultId: 0,
                cancelId: 1
            }).then((result) => {
                if (result.response === 0) {
                    // User clicked "Download & Install"
                    autoUpdater.downloadUpdate();
                    
                    // Show download progress
                    dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'Downloading Update',
                        message: 'Downloading update in background...',
                        detail: 'You will be notified when the download is complete.',
                        buttons: ['OK']
                    });
                }
            });
        }
    });
    
    autoUpdater.on('update-not-available', (info) => {
        log('✅ App is up to date:', info.version);
    });
    
    autoUpdater.on('error', (err) => {
        console.error('❌ Update error:', err);
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
        let message = `Download speed: ${progressObj.bytesPerSecond}`;
        message += ` - Downloaded ${progressObj.percent}%`;
        message += ` (${progressObj.transferred}/${progressObj.total})`;
        log(message);
    });
    
    autoUpdater.on('update-downloaded', (info) => {
        log('✅ Update downloaded:', info.version);
        
        // Notify user that update is ready
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Ready',
                message: 'Update downloaded successfully!',
                detail: 'The update will be installed when you close the app. Would you like to restart now?',
                buttons: ['Restart Now', 'Later'],
                defaultId: 0,
                cancelId: 1
            }).then((result) => {
                if (result.response === 0) {
                    // User clicked "Restart Now"
                    autoUpdater.quitAndInstall();
                }
            });
        }
    });
}

let mainWindow;
let overlayWindow;
let isOverlayVisible = false;
let speechAgentActive = false;
let currentGuideSteps = null;
let isMicMuted = false; // Global mic mute state

// Initialize secure storage for authentication (lazy loaded)
let store = null;

async function initializeStore() {
    if (!store) {
        const Store = (await import('electron-store')).default;
        // Encryption key MUST be set via environment variable in production.
        // electron-store uses this to encrypt the local credential store.
        // If unset, encryption is disabled (acceptable for first-run / single-user local mode).
        const encryptionKey = process.env.EARLYGOD_STORE_KEY || null;
        store = new Store(encryptionKey ? { encryptionKey } : {});
    }
    return store;
}

// Clerk configuration using environment variables (no hardcoded keys)
// NOTE: Electron main process may not have env vars, so we'll get them from backend if needed
// To use your own Clerk instance, set CLERK_PUBLISHABLE_KEY and CLERK_FRONTEND_API in your .env
const CLERK_CONFIG = {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || null,
    frontendApi: process.env.CLERK_FRONTEND_API || null
};

CLERK_CONFIG.signInUrl = CLERK_CONFIG.frontendApi
    ? `https://${CLERK_CONFIG.frontendApi}/sign-in`
    : null;

log('🔧 Clerk frontendApi:', CLERK_CONFIG.frontendApi || '(not configured — auth disabled)');
log('🔧 Sign-in URL:', CLERK_CONFIG.signInUrl || '(not configured)');
log('🔧 Publishable key configured:', CLERK_CONFIG.publishableKey ? 'YES' : 'NO');
if (CLERK_CONFIG.publishableKey) {
    log('🔧 Publishable key type:', CLERK_CONFIG.publishableKey.includes('pk_live_') ? 'PRODUCTION' : 'DEVELOPMENT');
}

// Game detection
const gameDetector = new GameDetector();
let detectedGame = null;
const backendBaseUrl = (() => {
    if (typeof process !== 'undefined' && process.env.BACKEND_URL) {
        return process.env.BACKEND_URL.trim().replace(/\/$/, '');
    }
    // Default: local backend. Override with BACKEND_URL env var to point at a remote deployment.
    return 'http://localhost:3001';
})();

async function checkBackendHealth() {
    try {
        const response = await fetch(`${backendBaseUrl}/api/health`, {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        log('✅ Backend health check succeeded:', payload);
        return true;
    } catch (error) {
        console.error('❌ Backend health check failed:', error.message);
        return false;
    }
}

async function sendBackendRequest(endpoint, options = {}) {
    const {
        method = 'GET',
        headers = {},
        body,
        timeout = 900000, // 15 minutes for video processing (supports 60min videos)
        expectJson = true
    } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const requestInit = {
        method,
        headers,
        body,
        signal: controller.signal
    };

    try {
        const response = await fetch(`${backendBaseUrl}${endpoint}`, requestInit);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        if (!expectJson) {
            return response;
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function createMainWindow() {
    log('📱 [MAIN] Creating main window with preload script...');
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 1200,
        show: false, // Hide until ready to prevent white flash
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            devTools: true // Always enable DevTools for debugging
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        title: isProduction ? 'EarlyGod.ai Beta' : 'EarlyGod.ai - Gaming Guide Assistant',
        autoHideMenuBar: isProduction, // Hide menu bar in production
        frame: true,
        resizable: true,
        minimizable: true,
        maximizable: true
    });

    log('📱 [MAIN] Loading index.html...');
    mainWindow.loadFile('index.html');

    mainWindow.webContents.on('did-finish-load', () => {
        log('📱 [MAIN] Window finished loading - renderer should be ready');
        log('📱 [MAIN] If auth system is working, you should see IPC calls soon...');
        
        // Show window after content is loaded
        if (mainWindow) {
            mainWindow.show();
            // DevTools can be toggled manually via IPC if needed
        }
    });


    mainWindow.on('closed', () => {
        log('🧹 Main window closing - cleaning up sessions...');
        
        
        // Clean up all zombie gaming sessions on app close
        log('🧹 Cleaning up all zombie sessions...');
        fetch(`${backendBaseUrl}/api/gaming/clear-all-sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(error => {
            log('⚠️ Session cleanup error (app closing anyway):', error.message);
        });
        
        mainWindow = null;
    });
}

function createOverlayWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    overlayWindow = new BrowserWindow({
        width: 480, // ✅ 20% wider (400 * 1.2 = 480)
        height: 600,
        x: width - 500, // ✅ Adjusted position for wider window
        y: 60,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        resizable: true,
        movable: true,
        skipTaskbar: true,
        focusable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            devTools: true // Always enable DevTools for debugging
        },
        title: 'EarlyGod.ai Overlay'
    });

    overlayWindow.loadFile('overlay.html');
    overlayWindow.hide();
    
    // Apply stronger always-on-top for overlays
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    
    // Windows-specific fix to keep overlay on top when game is clicked
    if (process.platform === 'win32') {
        overlayWindow.setIgnoreMouseEvents(false);
        overlayWindow.setSkipTaskbar(true);
        
        // Force overlay to stay on top when it loses focus
        overlayWindow.on('blur', () => {
            setTimeout(() => {
                if (overlayWindow && !overlayWindow.isDestroyed()) {
                    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                }
            }, 100);
        });
    }
    
    // DevTools can be toggled manually via IPC if needed

    // NEW: Listen for main overlay moves to reposition voice overlay
    overlayWindow.on('move', () => {
        if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
            repositionVoiceOverlay();
        }
    });

    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });
}

let voiceOverlayWindow = null;

function createVoiceOverlay() {
    if (voiceOverlayWindow) {
        voiceOverlayWindow.show();
        repositionVoiceOverlay(); // NEW: Ensure correct position
        return;
    }
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    // NEW: Calculate position based on main overlay
    let voiceX = Math.floor((width - 400) / 2); // Default center
    let voiceY = 20;
    
    if (overlayWindow) {
        const overlayBounds = overlayWindow.getBounds();
        voiceX = overlayBounds.x;
        voiceY = overlayBounds.y - 70; // 10px gap + 60px height
        log('📍 Positioning voice overlay above main overlay at:', voiceX, voiceY);
    }
    
    voiceOverlayWindow = new BrowserWindow({
        width: 400,
        height: 60,
        x: voiceX,
        y: voiceY,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: true,
        focusable: true,
        parent: null, // Explicitly no parent window
        modal: false, // Not a modal dialog
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            devTools: isDevelopment
        },
        title: 'Voice Mode'
    });
    
    voiceOverlayWindow.loadFile('voice-overlay.html');
    voiceOverlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    voiceOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    
    // Windows-specific fix to keep overlay independent
    if (process.platform === 'win32') {
        voiceOverlayWindow.setIgnoreMouseEvents(false);
        voiceOverlayWindow.setSkipTaskbar(true);
        
        // Force overlay to stay independent when it loses focus
        voiceOverlayWindow.on('blur', () => {
            setTimeout(() => {
                if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
                    voiceOverlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                }
            }, 100);
        });
    }
    
    // DevTools can be toggled manually via IPC if needed

    voiceOverlayWindow.on('closed', () => {
        voiceOverlayWindow = null;
    });
    
    log('✅ Voice overlay window created as independent window');
}

// NEW: Function to reposition voice overlay above main overlay
function repositionVoiceOverlay() {
    if (!voiceOverlayWindow || !overlayWindow) return;
    
    const overlayBounds = overlayWindow.getBounds();
    const newBounds = {
        x: overlayBounds.x,
        y: overlayBounds.y - 70, // 10px gap + 60px height
        width: 400,
        height: 60
    };
    
    log('📍 Repositioning voice overlay to:', newBounds.x, newBounds.y);
    voiceOverlayWindow.setBounds(newBounds);
}

function toggleOverlay() {
    if (!overlayWindow) {
        createOverlayWindow();
        return;
    }

    if (isOverlayVisible) {
        overlayWindow.hide();
        isOverlayVisible = false;
    } else {
        overlayWindow.show();
        overlayWindow.focus();
        isOverlayVisible = true;
    }
}

function setupGlobalShortcuts() {
    const hotkey = process.env.OVERLAY_HOTKEY || 'F12';
    globalShortcut.register(hotkey, toggleOverlay);

    // Existing voice shortcuts
    globalShortcut.register('CommandOrControl+Shift+V', () => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('voice-command', 'next');
        }
    });

    globalShortcut.register('CommandOrControl+Shift+R', () => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('voice-command', 'repeat');
        }
    });

    // NEW: Ctrl+Shift+O - Toggle overlay with guide steps
    globalShortcut.register('CommandOrControl+Shift+O', () => {
        toggleOverlay();
        
        // If overlay is now visible and we have guide data, send it
        if (isOverlayVisible && overlayWindow && currentGuideSteps) {
            log('📋 Sending current guide data to overlay');
            overlayWindow.webContents.send('guide-loaded', { steps: currentGuideSteps });
        }
    });

    // NEW: Ctrl+Shift+P - Start AI conversation and open overlay
    globalShortcut.register('CommandOrControl+Shift+P', () => {
        
        // Start the gaming session (AI conversation)
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('start-voice-gaming-session');
        }
        
        // Open the overlay
        if (!overlayWindow) {
            createOverlayWindow();
        }
        
        if (!isOverlayVisible) {
            overlayWindow.show();
            overlayWindow.focus();
            isOverlayVisible = true;
            
            // Send current guide data to overlay if available
            if (currentGuideSteps) {
                log('📋 Sending guide data to overlay');
                overlayWindow.webContents.send('guide-loaded', { steps: currentGuideSteps });
            }
        }
        
        log('✅ Voice agent and overlay activated');
    });

    // NEW: Ctrl+Right Arrow - Next step in overlay
    globalShortcut.register('CommandOrControl+Right', () => {
        if (overlayWindow && isOverlayVisible) {
            overlayWindow.webContents.send('navigate-step', 'next');
        } else {
            log('⚠️ Overlay not visible, ignoring step navigation');
        }
    });

    // NEW: Ctrl+Left Arrow - Previous step in overlay  
    globalShortcut.register('CommandOrControl+Left', () => {
        if (overlayWindow && isOverlayVisible) {
            overlayWindow.webContents.send('navigate-step', 'prev');
        } else {
            log('⚠️ Overlay not visible, ignoring step navigation');
        }
    });

    // NEW: Ctrl+Shift+M - Toggle mic mute for AI assistant
    globalShortcut.register('CommandOrControl+Shift+M', () => {
        log('🎤 Mic mute hotkey pressed (Ctrl+Shift+M)');
        log('   Overlay window exists:', !!overlayWindow);
        log('   Main window exists:', !!mainWindow);
        
        // Send mute toggle to both overlay and main window
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            log('   Sending toggle-mic-mute to overlay...');
            overlayWindow.webContents.send('toggle-mic-mute');
        } else {
            log('   ❌ Overlay window not available');
        }
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            log('   Sending toggle-mic-mute to main window...');
            mainWindow.webContents.send('toggle-mic-mute');
        } else {
            log('   ❌ Main window not available');
        }
    });

    log('⌨️ Global shortcuts registered:');
    log(`   ${hotkey} - Toggle overlay`);
    log('   Ctrl+Shift+V - Next step');
    log('   Ctrl+Shift+R - Repeat step');
    log('   Ctrl+Shift+O - Show overlay with guide steps');
    log('   Ctrl+Shift+P - Start AI conversation and open overlay');
    log('   Ctrl+Right Arrow - Next step in overlay');
    log('   Ctrl+Left Arrow - Previous step in overlay');
    log('   Ctrl+Shift+M - Toggle mic mute');
}

ipcMain.handle('process-video', async (_event, youtubeUrl) => {
    log('📡 IPC: process-video called');
    log('   🔗 URL:', youtubeUrl);
    log('   🌐 Backend:', backendBaseUrl);

    try {
        log('📤 Sending request to backend...');
        const result = await sendBackendRequest('/api/process-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ youtubeUrl }),
            timeout: 900000 // 15 minute timeout for Gemini video processing (supports 60min videos)
        });

        log('📦 Backend process-video response received');
        log('   ✅ Success:', result.success);
        log('   📊 Status:', result.status);

        // 🔄 POLLING LOGIC for Async Processing
        if (result.status === 'processing' && result.guideId) {
            log(`⏳ Video processing started in background (Guide ID: ${result.guideId}). Polling for completion...`);
            
            const pollInterval = 5000; // 5 seconds
            const maxPollTime = 1800000; // 30 minutes max
            const startTime = Date.now();
            let lastSegmentProgress = 0;
            let lastSegmentUpdateTime = Date.now();
            
            while (Date.now() - startTime < maxPollTime) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                
                try {
                    const guideStatus = await sendBackendRequest(`/api/guide/${result.guideId}`);
                    
                    // Send progress update to renderer (use real segment progress if available)
                    let progress = 0;
                    if (guideStatus.total_segments && guideStatus.processed_segments) {
                        // Real progress from backend
                        const segmentProgress = Math.floor((guideStatus.processed_segments / guideStatus.total_segments) * 100);
                        
                        // Interpolate progress within current segment for smooth animation
                        if (segmentProgress > lastSegmentProgress) {
                            // New segment completed, update baseline
                            lastSegmentProgress = segmentProgress;
                            lastSegmentUpdateTime = Date.now();
                            progress = segmentProgress;
                        } else {
                            // Same segment, interpolate progress
                            const timeSinceLastUpdate = Date.now() - lastSegmentUpdateTime;
                            const estimatedSegmentDuration = 180000; // Assume ~3 minutes per segment
                            const segmentSize = 100 / guideStatus.total_segments;
                            const interpolatedProgress = Math.min(segmentSize * 0.8, (timeSinceLastUpdate / estimatedSegmentDuration) * segmentSize);
                            progress = Math.min(95, lastSegmentProgress + interpolatedProgress);
                        }
                    } else {
                        // Fallback to time-based estimate
                        const elapsedTime = Date.now() - startTime;
                        progress = Math.min(95, Math.floor((elapsedTime / maxPollTime) * 100));
                    }
                    
                    if (mainWindow && mainWindow.webContents) {
                        mainWindow.webContents.send('video-processing-progress', Math.floor(progress));
                    }
                    
                    // Check if processing is done
                    // Legacy guides might not have processing_status, so check steps count too
                    if (guideStatus.processing_status === 'completed' || (guideStatus.steps && guideStatus.steps.length > 0)) {
                        log('✅ Polling complete: Guide processing finished');
                        log('   📊 Steps found:', guideStatus.steps.length);
                        
                        // Send 100% progress
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('video-processing-progress', 100);
                        }
                        
                        // Merge steps into the original result to satisfy frontend expectations
                        result.success = true;
                        result.steps = guideStatus.steps;
                        result.transcript = guideStatus.transcript;
                        result.metadata = {
                            title: guideStatus.title,
                            channelTitle: guideStatus.channel_title,
                            duration: guideStatus.duration
                        };
                        break;
                    } else if (guideStatus.processing_status === 'failed') {
                        throw new Error('Video processing failed on backend');
                    }
                    
                    log(`   ...still processing (${Math.round((Date.now() - startTime)/1000)}s)`);
                } catch (pollError) {
                    // Stop polling if backend explicitly reported failure
                    if (pollError.message.includes('processing failed')) throw pollError;
                    
                    // Otherwise ignore transient poll errors (e.g. network blip)
                    console.warn('   ⚠️ Poll request failed, retrying...', pollError.message);
                }
            }
            
            if (Date.now() - startTime >= maxPollTime) {
                throw new Error('Video processing timed out after 30 minutes');
            }
        }
        
        log('   📊 Final steps count:', result.steps?.length || 0);
        
        // Store guide steps for overlay use
        if (result.success && result.steps) {
            currentGuideSteps = result.steps;
            log('💾 Guide steps stored for overlay');
            
            // If overlay is visible, send the new guide data immediately
            if (overlayWindow && isOverlayVisible) {
                log('📤 Sending fresh guide data to visible overlay');
                overlayWindow.webContents.send('guide-loaded', { steps: currentGuideSteps });
            }
        }
        
        return result;
    } catch (error) {
        console.error('❌ Failed to process video:');
        console.error('   Error message:', error.message);
        console.error('   Stack trace:', error.stack);
        throw error;
    }
});

ipcMain.handle('get-guide', async (_event, guideId) => {
    try {
        return await sendBackendRequest(`/api/guide/${guideId}`);
    } catch (error) {
        console.error('❌ Failed to fetch guide:', error.message);
        throw error;
    }
});

ipcMain.handle('voice-command', async (_event, command, context = {}) => {
    try {
        // Get current game primer from game detector
        let gameContext = {};
        if (gameDetector) {
            const currentPrimer = gameDetector.getCurrentPrimer();
            const currentGame = gameDetector.getCurrentGame();
            
            if (currentPrimer) {
                gameContext = {
                    gameTitle: currentPrimer.gameTitle,
                    genre: currentPrimer.genre,
                    overview: currentPrimer.overview,
                    coreMechanics: currentPrimer.coreMechanics,
                    terminology: currentPrimer.terminology,
                    commonQuestions: currentPrimer.commonQuestions,
                    insiderTips: currentPrimer.insiderTips
                };
                log('📋 Adding game context to voice command:', currentPrimer.gameTitle);
            } else if (currentGame) {
                log('⚠️ Game detected but no primer available:', currentGame.title);
            }
        }
        
        // Merge context with game context
        const enhancedContext = {
            ...context,
            gameContext: gameContext
        };
        
        const result = await sendBackendRequest('/api/voice-command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ command, context: enhancedContext })
        });

        if (result?.response) {
            return result.response;
        }

        return 'Command processed';
    } catch (error) {
        console.error('❌ Failed to process voice command:', error.message);
        return 'Command processed';
    }
});

// NEW: Speech-to-speech functionality
ipcMain.handle('start-speech-recording', async () => {
    log('🎤 Starting speech recording...');
    
    try {
        // For now, we'll use a simple approach with Web Speech API
        // In a full implementation, you might want to use a more robust solution
        return { success: true, message: 'Speech recording started' };
    } catch (error) {
        console.error('❌ Failed to start speech recording:', error.message);
        throw error;
    }
});

ipcMain.handle('stop-speech-recording', async () => {
    log('🛑 Stopping speech recording...');
    
    try {
        return { success: true, message: 'Speech recording stopped' };
    } catch (error) {
        console.error('❌ Failed to stop speech recording:', error.message);
        throw error;
    }
});

ipcMain.handle('speak-text', async (_event, text) => {
    log('🔊 Speaking text:', text);
    
    try {
        // Use the backend's voice synthesis or local TTS
        // For now, we'll send it to the backend for processing
        const result = await sendBackendRequest('/api/text-to-speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        return result;
    } catch (error) {
        console.error('❌ Failed to speak text:', error.message);
        // Fallback to system TTS if available
        return { success: false, error: error.message };
    }
});

// IPC handlers for overlay communication
ipcMain.on('request-guide-data', (event) => {
    log('📋 Overlay requesting guide data');
    log('   🔍 Current guide steps available:', !!currentGuideSteps);
    log('   📊 Steps count:', currentGuideSteps?.length || 0);
    log('   🖥️ Event sender is overlay:', event.sender === overlayWindow?.webContents);
    
    if (currentGuideSteps && event.sender === overlayWindow?.webContents) {
        log('📤 Sending guide data to overlay');
        log('   📋 First step title:', currentGuideSteps[0]?.title);
        event.sender.send('guide-loaded', { 
            steps: currentGuideSteps,
            title: 'Current Guide'
        });
    } else {
        log('⚠️ No guide data available for overlay');
        log('   📊 currentGuideSteps:', currentGuideSteps?.length || 'null');
        log('   🖥️ overlayWindow exists:', !!overlayWindow);
    }
});

ipcMain.on('hide-overlay', () => {
    log('🙈 Hiding overlay');
    if (overlayWindow) {
        overlayWindow.hide();
        isOverlayVisible = false;
    }
});

ipcMain.on('navigate-step', (event, direction) => {
    log('🔄 Step navigation:', direction);
    // This could be used for global step tracking or voice feedback
});

ipcMain.on('move-overlay', (event, { deltaX, deltaY }) => {
    if (overlayWindow) {
        const [currentX, currentY] = overlayWindow.getPosition();
        overlayWindow.setPosition(currentX + deltaX, currentY + deltaY);
    }
});

ipcMain.on('guide-to-overlay', (event, guideData) => {
    log('📋 Received guide data for overlay:', guideData.title);
    log('   📊 Steps count:', guideData.steps?.length || 0);
    
    // Update current guide steps
    currentGuideSteps = guideData.steps;
    
    // Send to overlay if it exists and is visible
    if (overlayWindow && isOverlayVisible) {
        log('📤 Forwarding guide data to overlay');
        overlayWindow.webContents.send('guide-loaded', guideData);
    } else {
        log('💾 Guide data stored for when overlay opens');
    }
});

ipcMain.on('toggle-overlay-devtools', () => {
    log('🎮 Toggling overlay DevTools');
    if (overlayWindow) {
        if (overlayWindow.webContents.isDevToolsOpened()) {
            overlayWindow.webContents.closeDevTools();
        } else {
            overlayWindow.webContents.openDevTools({ mode: 'detach' });
        }
    } else {
        log('⚠️ Overlay window not available');
    }
});

ipcMain.on('toggle-main-devtools', () => {
    log('🔧 Toggling main app DevTools');
    if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
            mainWindow.webContents.closeDevTools();
        } else {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
    } else {
        log('⚠️ Main window not available');
    }
});

// Mic mute functionality
ipcMain.on('set-mic-muted', (event, isMuted) => {
    isMicMuted = isMuted;
    log('🎤 Mic mute state changed:', isMuted ? 'MUTED' : 'UNMUTED');
    
    // Forward mute state to main window so it can handle AI responses
    if (mainWindow) {
        mainWindow.webContents.send('mic-mute-changed', isMuted);
    }
});

// Get current mic mute state
ipcMain.handle('get-mic-muted', () => {
    return isMicMuted;
});

// Voice Mode IPC handlers
ipcMain.on('show-voice-overlay', () => {
    log('📞 Show voice overlay requested');
    if (!voiceOverlayWindow) {
        createVoiceOverlay();
    } else {
        voiceOverlayWindow.show();
    }
});

ipcMain.on('hide-voice-overlay', () => {
    log('📵 Hide voice overlay requested');
    if (voiceOverlayWindow) {
        voiceOverlayWindow.hide();
    }
});

ipcMain.on('end-voice-mode', () => {
    log('🛑 End voice mode requested');
    if (mainWindow) {
        mainWindow.webContents.send('stop-voice-mode');
    }
    if (voiceOverlayWindow) {
        voiceOverlayWindow.hide();
    }
});

ipcMain.on('update-voice-status', (event, status) => {
    if (voiceOverlayWindow) {
        voiceOverlayWindow.webContents.send('voice-mode-status', status);
    }
});

ipcMain.on('set-voice-mode-mic-muted', (event, isMuted) => {
    isMicMuted = isMuted;
    log('🎤 Voice mode mic mute:', isMuted ? 'MUTED' : 'UNMUTED');
    
    // Forward to main window
    if (mainWindow) {
        mainWindow.webContents.send('mic-mute-changed', isMuted);
    }
});

// Voice mode pause/resume handlers
ipcMain.on('pause-voice-mode', (event, reason) => {
    log('⏸️ Pause voice mode requested:', reason);
    if (mainWindow) {
        mainWindow.webContents.send('pause-voice-mode', reason);
    }
    if (voiceOverlayWindow) {
        voiceOverlayWindow.webContents.send('voice-mode-status', 'Paused');
    }
});

ipcMain.on('resume-voice-mode', () => {
    log('▶️ Resume voice mode requested');
    if (mainWindow) {
        mainWindow.webContents.send('resume-voice-mode');
    }
    if (voiceOverlayWindow) {
        voiceOverlayWindow.webContents.send('voice-mode-status', 'Listening');
    }
});

// NEW: Game detection IPC handlers
ipcMain.handle('get-detected-game', async () => {
    return detectedGame;
});

ipcMain.handle('get-running-games', async () => {
    try {
        if (gameDetector && typeof gameDetector.getAllRunningGames === 'function') {
            return await gameDetector.getAllRunningGames();
        }
        return [];
    } catch (error) {
        console.error('Error getting running games:', error.message);
        return [];
    }
});

// NEW: Memory retrieval IPC handler
ipcMain.handle('get-game-memories', async () => {
    log('🧠 Fetching game memories from backend...');
    try {
        const result = await sendBackendRequest('/api/gaming/memories', {
            method: 'GET',
            timeout: 10000
        });
        return result;
    } catch (error) {
        console.error('❌ Failed to fetch game memories:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-sources', async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        return sources;
    } catch (error) {
        console.error('Error getting sources:', error.message);
        return [];
    }
});

ipcMain.handle('start-game-detection', async () => {
    log('🎮 Starting game detection from renderer');
    gameDetector.startDetection((game) => {
        detectedGame = game;
        log('🎮 Game detected:', game ? game.title : 'None');
        
        // Notify all windows of game change
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('game-detected', game);
        }
        if (overlayWindow && overlayWindow.webContents) {
            overlayWindow.webContents.send('game-detected', game);
        }
    });
    return { success: true };
});

ipcMain.handle('stop-game-detection', async () => {
    log('🛑 Stopping game detection');
    gameDetector.stopDetection();
    detectedGame = null;
    return { success: true };
});

// NEW: AI message forwarding to overlay
ipcMain.on('ai-message-to-overlay', (event, messageData) => {
    log('📤 Forwarding AI message to overlay:', messageData.text?.substring(0, 50));
    log('   🖥️ Overlay window exists:', !!overlayWindow);
    log('   👁️ Overlay visible:', isOverlayVisible);
    
    if (overlayWindow && overlayWindow.webContents) {
        overlayWindow.webContents.send('ai-coaching-message', messageData);
        log('   ✅ Message sent to overlay');
        
        // Auto-show overlay if hidden
        if (!isOverlayVisible) {
            log('   📺 Auto-showing overlay for AI message');
            overlayWindow.show();
            isOverlayVisible = true;
        }
    } else {
        console.warn('   ⚠️ Overlay window not available');
    }
});

// 🔥 BOSS MODE: Boss briefing to overlay (can be removed)
ipcMain.on('boss-briefing-to-overlay', (event, briefingData) => {
    log('📤 Forwarding boss briefing to overlay');
    
    if (overlayWindow && overlayWindow.webContents) {
        overlayWindow.webContents.send('boss-briefing-message', briefingData);
        log('   ✅ Boss briefing sent to overlay');
        
        // Auto-show overlay for boss mode
        if (!isOverlayVisible) {
            overlayWindow.show();
            isOverlayVisible = true;
        }
    }
});

// NEW: User speech forwarding to overlay  
ipcMain.on('user-speech-to-overlay', (event, speechData) => {
    if (overlayWindow && overlayWindow.webContents) {
        overlayWindow.webContents.send('user-speech-message', speechData);
    }
});

// NEW: Native Electron screen capture (Full HD for accurate text reading)
ipcMain.handle('capture-screen', async () => {
    try {
        log('📸 [ELECTRON] Starting native screen capture (Full HD)...');

        // Get available screen sources at FULL HD resolution for accurate text extraction
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 1920, height: 1080 }  // Full HD for crisp text reading
        });

        if (sources.length === 0) {
            throw new Error('No screen sources available');
        }

        // Use the primary screen (first source)
        const primaryScreen = sources[0];
        log('📸 [ELECTRON] Using screen source:', primaryScreen.name);

        // Get thumbnail as base64 JPEG with high quality (90%) for text clarity
        // 90% provides excellent text readability while keeping file size reasonable (~300-400KB)
        const thumbnail = primaryScreen.thumbnail;
        const base64 = thumbnail.toJPEG(90).toString('base64');

        log('📸 [ELECTRON] Screenshot captured (1080p JPEG 90%):', Math.round(base64.length / 1024), 'KB');

        return {
            success: true,
            image: base64,
            source: primaryScreen.name,
            size: Math.round(base64.length / 1024)
        };

    } catch (error) {
        console.error('❌ [ELECTRON] Screen capture failed:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
});

// ====================================
// AUTHENTICATION IPC HANDLERS
// ====================================

// Get authentication status (simplified - no backend verification needed)
ipcMain.handle('auth:get-session-token', async () => {
    log('\n🔑 [MAIN PROCESS] IPC: auth:get-session-token called');
    try {
        const storeInstance = await initializeStore();
        const isAuthenticated = storeInstance.get('user_authenticated');
        const authTimestamp = storeInstance.get('auth_timestamp');
        
        log('🔑 [MAIN PROCESS] User authenticated:', !!isAuthenticated);
        if (isAuthenticated && authTimestamp) {
            const authDate = new Date(authTimestamp);
            log('🔑 [MAIN PROCESS] Authenticated since:', authDate.toISOString());
            return 'authenticated'; // Return simple token to indicate authenticated
        }
        return null;
    } catch (error) {
        console.error('❌ [MAIN PROCESS] Error checking auth status:', error);
        return null;
    }
});

// Authentication window for Clerk sign-in
let authWindow = null;

// Create authentication window
async function createAuthWindow() {
    log('🔐 Creating authentication window...');
    
    authWindow = new BrowserWindow({
        width: 550,
        height: 800,
        center: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        title: 'Sign In with Discord - EarlyGod.ai',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: false, // Allow JavaScript injection for better UX
            webSecurity: true
        }
    });

    // Load Clerk's production sign-in page with your domain
    const clerkSignInUrl = CLERK_CONFIG.signInUrl;
    
    // DEBUG: Check what's actually being loaded
    log('🔍 DEBUG - CLERK_CONFIG:', CLERK_CONFIG);
    log('🔍 DEBUG - publishableKey available:', !!CLERK_CONFIG.publishableKey);
    log('🔍 DEBUG - clerkSignInUrl:', clerkSignInUrl);
    
    // If publishableKey is not available, fetch it from backend
    if (!CLERK_CONFIG.publishableKey) {
        log('🔍 publishableKey not available in main process, fetching from backend...');
        try {
            const response = await fetch(`${backendBaseUrl}/api/config/clerk-publishable-key`);
            if (response.ok) {
                const { publishableKey } = await response.json();
                CLERK_CONFIG.publishableKey = publishableKey;
                log('✅ Got publishableKey from backend:', !!publishableKey);
            } else {
                console.error('❌ Failed to fetch publishableKey from backend');
                return;
            }
        } catch (error) {
            console.error('❌ Error fetching publishableKey:', error.message);
            return;
        }
    }
    
    authWindow.loadURL(clerkSignInUrl);
    
    log('🔐 Loading Clerk sign-in URL:', clerkSignInUrl);

    // Log page loads for debugging
    authWindow.webContents.on('did-finish-load', () => {
        log('🔍 Auth page finished loading:', authWindow.webContents.getURL());
        
        // Inject CSS to hide scrollbar on Clerk pages
        authWindow.webContents.insertCSS(`
            body {
                overflow: hidden !important;
            }
            html {
                overflow: hidden !important;
            }
        `).catch(err => console.warn('Could not inject CSS:', err));
    });

    // Extract session token when we reach the final callback
    authWindow.webContents.on('did-navigate', async (event, navigationUrl) => {
        log('🔗 Auth window navigated to:', navigationUrl);
        
        // Check if we've reached the final callback - user is now authenticated!
        if (navigationUrl.includes('/auth/clerk-callback')) {
            log('✅ Authentication completed - user is logged in!');
            
            try {
                // Simply mark user as authenticated (OAuth already validated by Clerk)
                const storeInstance = await initializeStore();
                storeInstance.set('user_authenticated', true);
                storeInstance.set('auth_timestamp', Date.now());
                
                log('✅ User marked as authenticated in local storage');
                
                // ⭐ ADD DELAY - Wait for renderer to be ready
                setTimeout(() => {
                    if (mainWindow) {
                        log('📤 Sending auth-success event to renderer');
                        mainWindow.webContents.send('auth-success', { 
                            authenticated: true,
                            source: 'oauth-completed'
                        });
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }, 2000); // Wait 2 seconds for renderer to initialize
                
                // Close auth window
                setTimeout(() => {
                    if (authWindow) {
                        authWindow.close();
                        authWindow = null;
                    }
                }, 1000);
                
            } catch (error) {
                console.error('❌ Error saving authentication state:', error);
            }
        }
    });

    // Handle window closed
    authWindow.on('closed', () => {
        log('🔐 Auth window closed');
        authWindow = null;
    });

    // Show auth window
    authWindow.show();
    authWindow.focus();
    
    return authWindow;
}

// Removed complex handleAuthSuccess function - using simple callback detection instead

// Start sign-in with dedicated window
ipcMain.handle('auth:start-signin', async () => {
    log('🔐 Starting sign-in with dedicated auth window');
    
    try {
        // Close existing auth window if open
        if (authWindow) {
            authWindow.close();
            authWindow = null;
        }
        
        // Create new auth window
        await createAuthWindow();
        
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to create auth window:', error);
        return { success: false, error: error.message };
    }
});

// Sign out (simplified - just clear local auth state)
ipcMain.handle('auth:signout', async () => {
    log('👋 Processing sign out request');
    
    try {
        const storeInstance = await initializeStore();
        
        // Clear local authentication state
        storeInstance.delete('user_authenticated');
        storeInstance.delete('auth_timestamp');
        
        log('✅ Local authentication state cleared');
        return { success: true };
        
    } catch (error) {
        console.error('❌ Error during sign out:', error);
        return { success: false, error: error.message };
    }
});

// Verify session (simplified - no backend needed)
ipcMain.handle('auth:verify-session', async (event, sessionToken) => {
    log('\n🔍 [MAIN PROCESS] IPC: auth:verify-session called');
    
    if (!sessionToken || sessionToken !== 'authenticated') {
        log('❌ [MAIN PROCESS] No valid session token');
        return { authenticated: false, error: 'No valid session' };
    }
    
    try {
        const storeInstance = await initializeStore();
        const isAuthenticated = storeInstance.get('user_authenticated');
        const authTimestamp = storeInstance.get('auth_timestamp');
        
        if (isAuthenticated) {
            log('✅ [MAIN PROCESS] User is authenticated locally');
            return { 
                authenticated: true, 
                user: { 
                    email: 'user@earlygod.ai', // Generic user info since we don't verify with backend
                    name: 'Gaming User'
                }
            };
        } else {
            log('❌ [MAIN PROCESS] User not authenticated locally');
            return { authenticated: false, error: 'Not authenticated' };
        }
        
    } catch (error) {
        console.error('❌ [MAIN PROCESS] Error checking local auth:', error);
        return { authenticated: false, error: 'Auth check failed' };
    }
});

// Debug logging from renderer to terminal
ipcMain.on('log-to-terminal', (event, message) => {
    log('🖥️ [RENDERER LOG]', message);
});

// ====================================
// DEEP LINK AUTHENTICATION HANDLERS
// ====================================

// Register custom protocol
log('🔗 [PROTOCOL] Registering earlygodai:// protocol...');

// For development, we need to specify the executable and args explicitly
const isDev = process.env.NODE_ENV === 'development' || process.defaultApp;
let protocolRegistered;

if (isDev) {
    log('🔗 [PROTOCOL] Development mode - registering with explicit path');
    // Remove existing registration first
    app.removeAsDefaultProtocolClient('earlygodai');
    protocolRegistered = app.setAsDefaultProtocolClient('earlygodai', process.execPath, [path.resolve(process.argv[1])]);
} else {
    log('🔗 [PROTOCOL] Production mode - simple registration');
    protocolRegistered = app.setAsDefaultProtocolClient('earlygodai');
}

log('🔗 [PROTOCOL] Registration result:', protocolRegistered);
log('🔗 [PROTOCOL] App is default protocol client:', app.isDefaultProtocolClient('earlygodai'));

// Simple deep link handler - just check session when app opens
async function handleAuthCallback(url) {
    log('🔗 App opened from browser - checking session');
            
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
        // Tell the app to check if user is signed in
        mainWindow.webContents.send('check-session-requested');
    }
}

// macOS/Linux deep link handler
app.on('open-url', (event, url) => {
    event.preventDefault();
    log('\n🍎 [DEEP LINK] macOS/Linux deep link triggered:', url);
    handleAuthCallback(url);
});

// Windows deep link handler
log('🔒 [DEBUG] Requesting single instance lock...');
const gotTheLock = app.requestSingleInstanceLock();
log('🔒 [DEBUG] Got the lock?', gotTheLock);

if (!gotTheLock) {
    log('⚠️ Another instance is already running, quitting...');
    app.quit();
} else {
    log('✅ [DEBUG] Single instance lock obtained, setting up handlers...');
    app.on('second-instance', (event, commandLine) => {
        log('\n🪟 [DEEP LINK] Windows second instance detected');
        log('🪟 [DEEP LINK] Command line args:', commandLine);
        
        // Windows protocol handler
        const url = commandLine.find(arg => arg.startsWith('earlygodai://'));
        if (url) {
            log('🔗 [DEEP LINK] Windows deep link found:', url);
            handleAuthCallback(url);
        } else {
            log('⚠️ [DEEP LINK] No earlygodai:// URL found in command line');
        }
        
        // Focus window
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

app.whenReady().then(async () => {
    log('\n=== 🚀 EarlyGod.ai Electron App Starting ===');
    log('🌐 Backend URL:', backendBaseUrl);
    log('🔧 Environment variables:');
    log('   - NODE_ENV:', process.env.NODE_ENV);
    log('   - BACKEND_URL:', process.env.BACKEND_URL);
    log('   - OVERLAY_HOTKEY:', process.env.OVERLAY_HOTKEY);
    log('🔐 Clerk Config:');
    log('   - Publishable Key:', CLERK_CONFIG.publishableKey ? 'SET' : 'NOT SET');
    log('   - Sign-in URL:', CLERK_CONFIG.signInUrl);

    log('🔍 Checking backend health...');
    const isHealthy = await checkBackendHealth();
    if (isHealthy) {
        log('✅ Backend is healthy and ready');
    } else {
        console.warn('⚠️ Backend health check failed, but continuing...');
    }

    log('📱 Creating main window...');
    createMainWindow();
    
    // Check for updates after app starts (production only, if available)
    if (isProduction && autoUpdater) {
        log('🔄 Checking for app updates...');
        // Wait 3 seconds after app start to check for updates
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch((err) => {
                console.error('❌ Failed to check for updates:', err);
            });
        }, 3000);

        // Check for updates every 6 hours
        setInterval(() => {
            log('🔄 Periodic update check...');
            autoUpdater.checkForUpdates().catch((err) => {
                console.error('❌ Failed to check for updates:', err);
            });
        }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds
    }
    log('🔄 Creating overlay window...');
    createOverlayWindow();
    log('⌨️ Setting up global shortcuts...');
    setupGlobalShortcuts();
    
    log('\n=== 🔧 Authentication System Status ===');
    log('✅ IPC handlers registered:');
    log('   - auth:get-session-token');
    log('   - auth:start-signin');
    log('   - auth:signout');
    log('   - auth:verify-session');
    log('✅ Protocol registered: earlygodai://');
    log('✅ Deep link handlers ready');
    log('🎯 App fully initialized - waiting for renderer auth to trigger');
    log('==========================================\n');
    
    // Check for Windows protocol on startup
    log('\n🪟 [STARTUP] Checking for Windows protocol...');
    log('🪟 [STARTUP] Platform:', process.platform);
    log('🪟 [STARTUP] Process args:', process.argv);
    
    if (process.platform === 'win32') {
        const url = process.argv.find(arg => arg.startsWith('earlygodai://'));
        if (url) {
            log('🪟 [STARTUP] Windows startup protocol found:', url);
            handleAuthCallback(url);
        } else {
            log('🪟 [STARTUP] No earlygodai:// protocol found in startup args');
        }
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    log('🛑 App quitting - cleaning up...');
    globalShortcut.unregisterAll();
});
