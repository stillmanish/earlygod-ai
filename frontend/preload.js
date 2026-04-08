const { contextBridge, ipcRenderer } = require('electron');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

log('🔧 [PRELOAD] Preload script starting...');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Video processing
    processVideo: (url) => ipcRenderer.invoke('process-video', url),
    getGuide: (guideId) => ipcRenderer.invoke('get-guide', guideId),
    onVideoProcessingProgress: (callback) => ipcRenderer.on('video-processing-progress', (event, progress) => callback(progress)),

    // Voice commands
    voiceCommand: (command, context = {}) => ipcRenderer.invoke('voice-command', command, context),
    onVoiceCommand: (callback) => ipcRenderer.on('voice-command', callback),

    // Overlay control
    hideOverlay: () => ipcRenderer.send('hide-overlay'),
    showOverlay: () => ipcRenderer.send('show-overlay'),
    requestGuideData: () => ipcRenderer.send('request-guide-data'),

    // Step navigation
    navigateStep: (direction) => ipcRenderer.send('navigate-step', direction),
    onNavigateStep: (callback) => ipcRenderer.on('navigate-step', callback),

    // Guide data
    onGuideLoaded: (callback) => ipcRenderer.on('guide-loaded', callback),
    onShowGuideSteps: (callback) => ipcRenderer.on('show-guide-steps', callback),

    // Voice gaming session
    onStartVoiceGamingSession: (callback) => ipcRenderer.on('start-voice-gaming-session', callback),
    startSpeechRecording: () => ipcRenderer.invoke('start-speech-recording'),
    stopSpeechRecording: () => ipcRenderer.invoke('stop-speech-recording'),
    speakText: (text) => ipcRenderer.invoke('speak-text', text),

    // Overlay communication
    sendGuideToOverlay: (guideData) => ipcRenderer.send('guide-to-overlay', guideData),

    // DevTools controls
    toggleMainDevTools: () => ipcRenderer.send('toggle-main-devtools'),
    toggleOverlayDevTools: () => ipcRenderer.send('toggle-overlay-devtools'),

    // Overlay movement
    moveOverlay: (delta) => ipcRenderer.send('move-overlay', delta),

    // Platform info
    platform: process.platform,
    
    // Mic mute functionality
    setMicMuted: (isMuted) => ipcRenderer.send('set-mic-muted', isMuted),
    onToggleMicMute: (callback) => ipcRenderer.on('toggle-mic-mute', callback),
    getMicMuted: () => ipcRenderer.invoke('get-mic-muted'),
    onMicMuteChanged: (callback) => ipcRenderer.on('mic-mute-changed', (event, isMuted) => callback(isMuted)),
    
    // Voice Mode functionality
    showVoiceOverlay: () => ipcRenderer.send('show-voice-overlay'),
    hideVoiceOverlay: () => ipcRenderer.send('hide-voice-overlay'),
    endVoiceMode: () => ipcRenderer.send('end-voice-mode'),
    updateVoiceStatus: (status) => ipcRenderer.send('update-voice-status', status),
    setVoiceModeMicMuted: (isMuted) => ipcRenderer.send('set-voice-mode-mic-muted', isMuted),
    onVoiceModeStatus: (callback) => ipcRenderer.on('voice-mode-status', (event, status) => callback(status)),
    onVoiceModeMicMute: (callback) => ipcRenderer.on('voice-mode-mic-mute', callback),
    onStopVoiceMode: (callback) => ipcRenderer.on('stop-voice-mode', callback),
    
    // Voice Mode pause/resume
    pauseVoiceMode: (reason) => ipcRenderer.send('pause-voice-mode', reason),
    resumeVoiceMode: () => ipcRenderer.send('resume-voice-mode'),
    onVoiceModePaused: (callback) => ipcRenderer.on('pause-voice-mode', (event, reason) => callback(reason)),
    onVoiceModeResumed: (callback) => ipcRenderer.on('resume-voice-mode', callback),
    
    // NEW: Game detection
    getDetectedGame: () => ipcRenderer.invoke('get-detected-game'),
    getRunningGames: () => ipcRenderer.invoke('get-running-games'),
    getSources: () => ipcRenderer.invoke('get-sources'),
    startGameDetection: () => ipcRenderer.invoke('start-game-detection'),
    stopGameDetection: () => ipcRenderer.invoke('stop-game-detection'),
    onGameDetected: (callback) => ipcRenderer.on('game-detected', (event, game) => callback(game)),
    onGameLaunched: (callback) => ipcRenderer.on('game-launched', (event, game) => callback(game)),
    onGameClosed: (callback) => ipcRenderer.on('game-closed', (event, game) => callback(game)),
    onGameFocused: (callback) => ipcRenderer.on('game-focused', (event, game) => callback(game)),
    
    // NEW: AI coaching messages
    sendAIMessageToOverlay: (messageData) => ipcRenderer.send('ai-message-to-overlay', messageData),
    onAICoachingMessage: (callback) => ipcRenderer.on('ai-coaching-message', (event, data) => callback(data)),
    
    // 🔥 BOSS MODE: Boss briefing to overlay (can be removed)
    sendBossBriefingToOverlay: (briefingData) => ipcRenderer.send('boss-briefing-to-overlay', briefingData),
    onBossBriefing: (callback) => ipcRenderer.on('boss-briefing-message', (event, data) => callback(data)),
    
    // NEW: User speech to overlay
    sendUserSpeechToOverlay: (speechData) => ipcRenderer.send('user-speech-to-overlay', speechData),
    onUserSpeechMessage: (callback) => ipcRenderer.on('user-speech-message', (event, data) => callback(data)),
    
    // NEW: Native screen capture
    captureScreen: () => ipcRenderer.invoke('capture-screen'),
    
    // NEW: Memory retrieval
    getGameMemories: () => ipcRenderer.invoke('get-game-memories'),
    
    // Authentication
    getSessionToken: () => ipcRenderer.invoke('auth:get-session-token'),
    startSignIn: () => ipcRenderer.invoke('auth:start-signin'),
    signOut: () => ipcRenderer.invoke('auth:signout'),
    verifySession: (token) => ipcRenderer.invoke('auth:verify-session', token),
    onAuthSuccess: (callback) => {
        ipcRenderer.on('auth-success', (_event, data) => {
            log('📥 [PRELOAD] Auth success event received:', data);
            callback(data);
        });
    },
    onAuthError: (callback) => ipcRenderer.on('auth-error', (event, data) => callback(data)),
    onCheckSessionRequested: (callback) => {
        ipcRenderer.on('check-session-requested', () => {
            log('📥 [PRELOAD] Check session requested');
            callback();
        });
    },
    
    // Debugging - Log to terminal console
    logToTerminal: (message) => ipcRenderer.send('log-to-terminal', message),

    // Persistent Storage (replaces localStorage for conversations)
    storeGet: (key) => ipcRenderer.invoke('store-get', key),
    storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
    storeDelete: (key) => ipcRenderer.invoke('store-delete', key),
    storeClear: () => ipcRenderer.invoke('store-clear')
});

log('✅ [PRELOAD] electronAPI exposed to renderer with auth methods');
log('✅ [PRELOAD] Auth methods available:', {
    getSessionToken: 'function',
    startSignIn: 'function', 
    signOut: 'function',
    verifySession: 'function',
    onAuthSuccess: 'function',
    onAuthError: 'function'
});
log('🎯 [PRELOAD] Preload script complete - renderer should have access to electronAPI');
