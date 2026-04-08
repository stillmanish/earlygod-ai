// Game Detection Module - Auto-detect running games
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import node-window-manager for enhanced window detection
let windowManager = null;
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};
try {
    const nwm = require('node-window-manager');
    windowManager = nwm.windowManager;
    log('✅ node-window-manager loaded successfully');
} catch (error) {
    console.warn('⚠️ node-window-manager not available:', error.message);
}

// Known game titles and their process names
const KNOWN_GAMES = {
    'eldenring': { title: 'Elden Ring', type: 'souls-like', publisher: 'FromSoftware', dlcDetection: true },
    'ghostoftsushima': { title: 'Ghost of Tsushima', type: 'action-rpg', publisher: 'Sucker Punch Productions' },
    'ghostofyotei': { title: 'Ghost of Yotei', type: 'action-rpg', publisher: 'Sucker Punch Productions' },
    'blackmythwukong': { title: 'Black Myth Wukong', type: 'action-rpg', publisher: 'Game Science' },
    'crimsondesert': { title: 'Crimson Desert', type: 'action-rpg', publisher: 'Pearl Abyss' },
    'expedition33': { title: 'Clair Obscur: Expedition 33', type: 'survival', publisher: 'Hooded Horse' },
    'aoe2': { title: 'Age of Empires 2', type: 'strategy', publisher: 'Microsoft' },
    'ageofempires2': { title: 'Age of Empires 2', type: 'strategy', publisher: 'Microsoft' },
    'aoe4': { title: 'Age of Empires 4', type: 'strategy', publisher: 'Microsoft' },
    'ageofempires4': { title: 'Age of Empires 4', type: 'strategy', publisher: 'Microsoft' },
    'kingdomcomedeliverance2': { title: 'Kingdom Come Deliverance 2', type: 'action-rpg', publisher: 'Warhorse Studios' },
    'leagueoflegends': { title: 'League of Legends', type: 'moba', publisher: 'Riot Games' },
    'eu5': { title: 'Europa Universalis V', type: 'grand-strategy', publisher: 'Paradox Interactive' },
    'europauniversalis5': { title: 'Europa Universalis V', type: 'grand-strategy', publisher: 'Paradox Interactive' }
};

class GameDetector {
    constructor() {
        this.currentGame = null;
        this.detectionInterval = null;
        this.onGameChanged = null;
        this.pollingRate = 5000; // Check every 5 seconds (reduced spam)
        this.primerCache = new Map(); // Cache loaded primers
        this.currentPrimer = null;
        this.currentGames = new Map(); // Map of processId -> game info for tracking multiple games
        this.loadMetadata();
    }
    
    // Load primer metadata on initialization
    async loadMetadata() {
        try {
            const metadataPath = path.join(__dirname, 'game-primers', 'metadata.json');
            if (fs.existsSync(metadataPath)) {
                const metadataContent = fs.readFileSync(metadataPath, 'utf8');
                this.metadata = JSON.parse(metadataContent);
                log('✅ Game primer metadata loaded');
            } else {
                log('⚠️ No primer metadata found');
                this.metadata = { game_mappings: {}, display_names: {} };
            }
        } catch (error) {
            console.error('❌ Error loading primer metadata:', error);
            this.metadata = { game_mappings: {}, display_names: {} };
        }
    }
    
    // Load game primer by title or process name
    async loadGamePrimer(gameTitle, processName = null) {
        try {
            // Check cache first
            if (this.primerCache.has(gameTitle)) {
                log('📋 Using cached primer for:', gameTitle);
                return this.primerCache.get(gameTitle);
            }
            
            // Find primer file
            let primerFile = null;
            
            // Try by display name first
            if (this.metadata.display_names[gameTitle]) {
                primerFile = this.metadata.display_names[gameTitle];
            }
            // Try by process name
            else if (processName && this.metadata.game_mappings[processName]) {
                primerFile = this.metadata.game_mappings[processName];
            }
            // Try direct mapping
            else {
                for (const [displayName, file] of Object.entries(this.metadata.display_names)) {
                    if (gameTitle.toLowerCase().includes(displayName.toLowerCase()) ||
                        displayName.toLowerCase().includes(gameTitle.toLowerCase())) {
                        primerFile = file;
                        break;
                    }
                }
            }
            
            if (!primerFile) {
                log('⚠️ No primer found for:', gameTitle);
                return null;
            }
            
            // Load primer file
            const primerPath = path.join(__dirname, 'game-primers', primerFile);
            if (!fs.existsSync(primerPath)) {
                log('❌ Primer file not found:', primerPath);
                return null;
            }
            
            const primerContent = fs.readFileSync(primerPath, 'utf8');
            const primer = JSON.parse(primerContent);
            
            // Cache the primer
            this.primerCache.set(gameTitle, primer);
            
            log('✅ Loaded primer for:', gameTitle);
            return primer;
            
        } catch (error) {
            console.error('❌ Error loading primer for', gameTitle, ':', error);
            return null;
        }
    }
    
    // ====== STEAM DETECTION ======
    async getSteamGames() {
        const steamPaths = [
            'C:\\Program Files (x86)\\Steam',
            'C:\\Program Files\\Steam',
            path.join(os.homedir(), '.steam', 'steam') // Linux path if needed
        ];
        
        let steamPath = null;
        
        // Find Steam installation
        for (const p of steamPaths) {
            if (fs.existsSync(p)) {
                steamPath = p;
                break;
            }
        }
        
        if (!steamPath) {
            return [];
        }
        
        // Get currently running Steam games
        try {
            const { stdout } = await execAsync(
                `wmic process where "name='steam.exe' or name like '%game%.exe'" get ProcessId,ExecutablePath,CommandLine /format:csv`
            );
            
            // Parse Steam processes
            const lines = stdout.split('\n').filter(line => line.trim());
            const steamProcesses = lines
                .map(line => {
                    const parts = line.split(',');
                    if (parts.length < 3) return null;
                    
                    return {
                        commandLine: parts[1],
                        executablePath: parts[2],
                        processId: parts[3]
                    };
                })
                .filter(Boolean);
            
            // Extract game info from Steam processes
            const games = steamProcesses
                .filter(proc => proc.commandLine && proc.commandLine.includes('-applaunch'))
                .map(proc => {
                    const appIdMatch = proc.commandLine.match(/-applaunch (\d+)/);
                    return {
                        source: 'steam',
                        appId: appIdMatch ? appIdMatch[1] : null,
                        processId: proc.processId,
                        path: proc.executablePath
                    };
                });
            
            return games;
        } catch (error) {
            console.error('Error getting Steam games:', error.message);
            return [];
        }
    }

    // ====== EPIC GAMES DETECTION ======
    async getEpicGames() {
        const epicPath = 'C:\\Program Files\\Epic Games';
        
        if (!fs.existsSync(epicPath)) {
            return [];
        }
        
        try {
            // Epic games typically run as separate processes
            const { stdout } = await execAsync(
                `wmic process where "ExecutablePath like '%Epic Games%'" get ProcessId,ExecutablePath,Name /format:csv`
            );
            
            const lines = stdout.split('\n').filter(line => line.trim());
            const epicProcesses = lines
                .map(line => {
                    const parts = line.split(',');
                    if (parts.length < 3) return null;
                    
                    return {
                        executablePath: parts[1],
                        name: parts[2],
                        processId: parts[3]
                    };
                })
                .filter(Boolean)
                .filter(proc => 
                    // Filter out Epic launcher itself
                    !proc.name.includes('EpicGamesLauncher') &&
                    !proc.name.includes('EpicWebHelper')
                );
            
            return epicProcesses.map(proc => ({
                source: 'epic',
                name: proc.name,
                processId: proc.processId,
                path: proc.executablePath
            }));
        } catch (error) {
            console.error('Error getting Epic games:', error.message);
            return [];
        }
    }

    // ====== NODE-WINDOW-MANAGER DETECTION ======
    getWindowManagerGames() {
        if (!windowManager) {
            return [];
        }
        
        try {
            const windows = windowManager.getWindows();
            
            // Use KNOWN_GAMES patterns for window title matching
            const gamePatterns = Object.values(KNOWN_GAMES).map(g => g.title);
            
            return windows
                .filter(win => {
                    const title = win.getTitle();
                    return gamePatterns.some(pattern => 
                        title.toLowerCase().includes(pattern.toLowerCase())
                    );
                })
                .map(win => ({
                    source: 'window-manager',
                    title: win.getTitle(),
                    processId: win.processId,
                    path: win.path,
                    bounds: win.getBounds(),
                    isVisible: win.isVisible(),
                    handle: win.id // Window handle for screen capture
                }));
        } catch (error) {
            console.error('Error getting window manager games:', error.message);
            return [];
        }
    }

    // ====== COMBINED GAME DETECTION ======
    async getAllRunningGames() {
        const [steamGames, epicGames, windowGames] = await Promise.all([
            this.getSteamGames(),
            this.getEpicGames(),
            Promise.resolve(this.getWindowManagerGames())
        ]);
        
        // Merge and deduplicate by processId
        const allGames = [...steamGames, ...epicGames, ...windowGames];
        const uniqueGames = new Map();
        
        allGames.forEach(game => {
            if (game.processId && !uniqueGames.has(game.processId)) {
                uniqueGames.set(game.processId, game);
            }
        });
        
        return Array.from(uniqueGames.values());
    }

    async detectCurrentGame() {
        try {
            // First try enhanced detection methods
            const enhancedGames = await this.getAllRunningGames();
            if (enhancedGames.length > 0) {
                // Return the first detected game (prioritize focused window if available)
                const focusedGame = enhancedGames.find(g => g.isVisible);
                const selectedGame = focusedGame || enhancedGames[0];
                
                // Map to existing game info format
                const gameTitle = selectedGame.title || selectedGame.name || 'Unknown Game';
                const knownGame = Object.values(KNOWN_GAMES).find(g => 
                    gameTitle.toLowerCase().includes(g.title.toLowerCase())
                );
                
                if (knownGame) {
                    return {
                        ...knownGame,
                        processName: selectedGame.processId,
                        detected: true,
                        confidence: 'high',
                        source: selectedGame.source,
                        windowHandle: selectedGame.handle,
                        appId: selectedGame.appId
                    };
                }
                
                // Unknown game from enhanced detection
                return {
                    title: gameTitle,
                    type: 'unknown',
                    publisher: 'Unknown',
                    processName: selectedGame.processId,
                    detected: true,
                    confidence: 'medium',
                    source: selectedGame.source,
                    windowHandle: selectedGame.handle
                };
            }
            
            // Fallback to original tasklist detection
            // Get all running processes on Windows
            const { stdout } = await execAsync('tasklist /fo csv /nh');
            const processes = stdout.split('\n').map(line => {
                const match = line.match(/"([^"]+)"/);
                return match ? match[1].toLowerCase() : '';
            }).filter(p => p.length > 0);
            
            // 🔍 DEBUG: Log processes to help diagnose detection issues
            const gameProcesses = processes.filter(p => 
                p.includes('elden') || p.includes('ring')
            );
            if (gameProcesses.length > 0) {
                log('🔍 ELDEN RING PROCESSES FOUND:', gameProcesses);
            } else if (!this.currentGame) {
                log('🔍 No Elden Ring process found in', processes.length, 'processes');
                log('🔍 Sample processes:', processes.slice(0, 5));
            }
            
            // Only log on first check or periodically
            if (!this.currentGame) {
                log(`🔍 Checking ${processes.length} running processes...`);
            }
            
            // Try to match against known games
            for (const [key, gameInfo] of Object.entries(KNOWN_GAMES)) {
                const found = processes.find(proc => proc.includes(key));
                if (found) {
                    let detectedTitle = gameInfo.title;
                    
                    // ✅ SPECIAL HANDLING: Detect Elden Ring DLC vs base game
                    if (gameInfo.dlcDetection && key === 'eldenring') {
                        try {
                            // Get window title to detect DLC
                            const { stdout: windowInfo } = await execAsync(`powershell "Get-Process | Where-Object {$_.MainWindowTitle -like '*Elden Ring*'} | Select-Object MainWindowTitle -ExpandProperty MainWindowTitle"`);
                            const windowTitle = windowInfo.trim().toLowerCase();
                            
                            // Check if DLC is active (window title or save data indicators)
                            if (windowTitle.includes('shadow of the erdtree') || 
                                windowTitle.includes('erdtree') || 
                                windowTitle.includes('dlc')) {
                                detectedTitle = 'Elden Ring: Shadow of the Erdtree';
                                log('🎮 DLC DETECTED: Shadow of the Erdtree');
                            } else {
                                detectedTitle = 'Elden Ring';
                                log('🎮 Base game detected: Elden Ring');
                            }
                        } catch (dlcError) {
                            log('⚠️ Could not detect DLC status, defaulting to base game');
                            detectedTitle = 'Elden Ring';
                        }
                    }
                    
                    // Only log if it's a new detection
                    if (!this.currentGame || this.currentGame.title !== detectedTitle) {
                        log(`✅ Found game: ${detectedTitle} (${found})`);
                    }
                    return {
                        ...gameInfo,
                        title: detectedTitle,
                        processName: found,
                        detected: true,
                        confidence: 'high'
                    };
                }
            }
            
            // Look for common game executable patterns
            const gamePatterns = ['.exe'];
            const possibleGames = processes.filter(proc => 
                proc.endsWith('.exe') && 
                !this.isSystemProcess(proc) &&
                this.looksLikeGameProcess(proc)
            );
            
            if (possibleGames.length > 0) {
                const gameName = possibleGames[0].replace('.exe', '');
                // Only log if this is a different game than last time (reduce spam)
                if (!this.currentGame || this.currentGame.processName !== possibleGames[0]) {
                    log(`🎮 Possible game detected: ${gameName}`);
                }
                return {
                    title: this.formatGameName(gameName),
                    type: 'unknown',
                    publisher: 'Unknown',
                    processName: possibleGames[0],
                    detected: true,
                    confidence: 'medium'
                };
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ Game detection error:', error.message);
            console.error('   Stack:', error.stack);
            console.error('   This could mean:');
            console.error('   1. tasklist command failed');
            console.error('   2. PowerShell command failed (for DLC detection)');
            console.error('   3. Process parsing error');
            return null;
        }
    }
    
    isSystemProcess(processName) {
        const systemProcesses = [
            // Windows system processes
            'explorer', 'svchost', 'system', 'taskhostw', 'dwm', 'winlogon', 'csrss', 'smss',
            'wininit', 'services', 'lsass', 'conhost', 'wudfhost', 'spoolsv', 'audiodg',
            // Windows display/graphics processes  
            'nvdisplay', 'nvidia', 'amd', 'intel', 'radeon', 'dwm', 'dwmrcs',
            // Browsers and common apps
            'electron', 'chrome', 'firefox', 'edge', 'msedge', 'opera', 'brave',
            // Development tools
            'code', 'node', 'npm', 'yarn', 'git', 'cmd', 'powershell', 'terminal',
            // Gaming platforms (not games themselves)
            'steam', 'epic', 'origin', 'uplay', 'battle', 'gog', 'launcher',
            // Communication apps
            'discord', 'slack', 'teams', 'zoom', 'skype',
            // Media apps
            'spotify', 'vlc', 'media', 'windows',
            // Windows gaming services (NOT actual games)
            'gameinput', 'gamebar', 'gameoverlayui', 'gamepanel'
        ];
        return systemProcesses.some(sys => processName.toLowerCase().includes(sys.toLowerCase()));
    }
    
    looksLikeGameProcess(processName) {
        // Simple heuristic: look for game-like naming patterns
        const gameIndicators = ['game', 'play', 'win64', 'win32', 'shipping'];
        return gameIndicators.some(indicator => processName.toLowerCase().includes(indicator));
    }
    
    formatGameName(processName) {
        // Convert "eldenring" to "Elden Ring"
        return processName
            .replace(/([A-Z])/g, ' $1')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(/[\s_-]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
            .trim();
    }
    
    async startDetection(callback) {
        log('🎮 Starting game detection...');
        this.onGameChanged = callback;
        
        // ✅ FIX: Always call callback on first detection (even if null)
        const initialGame = await this.detectCurrentGame();
        log('🎮 Initial detection result:', initialGame ? initialGame.title : 'No game');
        this.currentGame = initialGame;
        if (this.onGameChanged) {
            this.onGameChanged(initialGame);
        }
        
        // Poll for changes
        this.detectionInterval = setInterval(() => {
            this.checkForGameChange();
        }, this.pollingRate);
        
        log(`✅ Game detection polling started (every ${this.pollingRate}ms)`);
    }
    
    async checkForGameChange() {
        try {
            const detectedGame = await this.detectCurrentGame();
            
            // Check if game changed
            const gameChanged = this.hasGameChanged(detectedGame);
            
            if (gameChanged) {
                log('🎮 Game changed:', detectedGame ? detectedGame.title : 'No game');
                this.currentGame = detectedGame;
                
                // Load primer for new game
                if (detectedGame) {
                    log('📋 Loading primer for detected game:', detectedGame.title);
                    this.loadGamePrimer(detectedGame.title, detectedGame.processName).then(primer => {
                        this.currentPrimer = primer;
                        if (primer) {
                            log('✅ Primer loaded for:', detectedGame.title);
                            log('   Genre:', primer.genre);
                            log('   Key mechanics:', primer.coreMechanics?.slice(0, 3).join(', '));
                        }
                    }).catch(error => {
                        console.error('❌ Failed to load primer:', error);
                    });
                } else {
                    this.currentPrimer = null;
                }
                
                if (this.onGameChanged) {
                    this.onGameChanged(detectedGame);
                } else {
                    console.warn('⚠️ No onGameChanged callback registered!');
                }
            }
        } catch (error) {
            console.error('❌ Error checking for game change:', error.message);
        }
    }
    
    hasGameChanged(newGame) {
        if (!this.currentGame && !newGame) return false;
        if (!this.currentGame && newGame) return true;
        if (this.currentGame && !newGame) return true;
        
        return this.currentGame.processName !== newGame.processName ||
               this.currentGame.windowTitle !== newGame.windowTitle;
    }
    
    stopDetection() {
        log('🛑 Stopping game detection');
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
        this.currentGame = null;
    }
    
    getCurrentGame() {
        return this.currentGame;
    }
    
    // Get current primer
    getCurrentPrimer() {
        return this.currentPrimer;
    }
    
    // Load primer for manually selected game
    async loadPrimerForGame(gameTitle) {
        log('📋 Loading primer for manually selected game:', gameTitle);
        const primer = await this.loadGamePrimer(gameTitle);
        this.currentPrimer = primer;
        return primer;
    }
}

module.exports = { GameDetector, KNOWN_GAMES };
