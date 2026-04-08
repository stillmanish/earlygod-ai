/**
 * SaveFileWatcher - Monitors game save files for checkpoint progress
 *
 * Automatically detects when the player reaches new checkpoints by watching
 * the game save file and parsing for Level_ entries.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Mapping from VisitedLevelRowNames entries to checkpoint names
// These are the ACTUAL completion flags from the save file
const VISITED_ROW_TO_CHECKPOINT = {
    // Main Story Areas
    'Lumiere': 'lumiere',
    'SpringMeadows': 'spring_meadows',
    'Camps': 'camp',
    'GoblusLair': 'flying_waters',  // Goblu's Lair is in Flying Waters area
    'AncientSanctuary': 'ancient_sanctuary',
    'GestralVillage': 'gestral_village',
    'GestralTreeCity': 'gestral_village',  // Part of Gestral Village
    'EsquieNest': 'esquies_nest',
    'SeaCliff': 'stone_wave_cliffs',
    'ForgottenBattlefield': 'forgotten_battlefield',
    'MonocoStation': 'monocos_station',
    'OldLumiere': 'old_lumiere',
    'Visages': 'visages',
    'Sirene': 'sirene',
    'Monolith_Interior_Climb': 'the_monolith',
    'Monolith_Exterior_Peak': 'the_monolith',
    'Monolith_Interior_PaintressIntro': 'the_monolith',
    'Manor': 'the_manor',

    // Optional/Side Areas
    'SmallLevel_WhiteSands': 'white_sands',
    'SmallLevel_CaveAbbest': 'abbest_cave',
    'SideLevel_RedForest': 'crimson_forest',
    'SideLevel_YellowForest': 'yellow_harvest',
    'SmallLevel_GestralBeach': 'gestral_beach',
    'SideLevel_CleasTower': 'cleas_tower',
    'SideLevel_CleasTower_Entrance': 'cleas_tower',
    'SideLevel_CleasWorkshop': 'cleas_tower',
    'CleasOrangeArea': 'cleas_tower',
    'BladesGraveyard': 'blades_graveyard',
    'SmallLevel_Reacher': 'the_reacher',
    'SmallLevel_FlyingCasinoEntrance': 'flying_casino',
    'SmallLevel_FloatingIsland': 'sky_island',
    'SmallLevel_GestralHiddenArena': 'gestral_beach',  // Near Gestral Beach
    'SmallLevel_DoorMaze': 'visages',  // Part of Visages area
    'SmallLevel_CavernCrusher': 'abbest_cave',  // Related to Abbest Cave
    'SmallLevel_GoblusLair_02': 'flying_waters'  // Part of Flying Waters
};

// Legacy mapping for Level_ names (fallback)
const LEVEL_TO_CHECKPOINT = {
    'Level_Lumiere': 'lumiere',
    'Level_SpringMeadows': 'spring_meadows',
    'Level_Camp': 'camp',
    'Level_Goblu': 'flying_waters',
    'Level_AncientSanctuary': 'ancient_sanctuary',
    'Level_GestralVillage': 'gestral_village',
    'Level_SeaCliff': 'stone_wave_cliffs',
    'Level_ForgottenBattlefield': 'forgotten_battlefield',
    'Level_MonocoStation': 'monocos_station',
    'Level_OldLumiere': 'old_lumiere',
    'Level_Visages': 'visages',
    'Level_Sirene': 'sirene',
    'Level_Monolith': 'the_monolith',
    'Level_WhiteSands': 'white_sands',
    'Level_CaveAbbest': 'abbest_cave',
    'Level_RedForest': 'crimson_forest',
    'Level_YellowForest': 'yellow_harvest',
    'Level_GestralBeach': 'gestral_beach',
    'Level_CleasTower': 'cleas_tower',
    'Level_BladesGraveyard': 'blades_graveyard',
    'Level_Reacher': 'the_reacher',
    'Level_FlyingCasino': 'flying_casino',
    'Level_FloatingIsland': 'sky_island'
};

class SaveFileWatcher {
    constructor(options = {}) {
        this.gameTitle = options.gameTitle || 'Clair Obscur: Expedition 33';
        this.saveFilePath = options.saveFilePath || this.findSaveFile();
        this.pollInterval = options.pollInterval || 2000; // Check every 2 seconds
        this.knownCheckpoints = new Set();
        this.lastModified = null;
        this.watcher = null;
        this.pollTimer = null;
        this.isRunning = false;
        this.onCheckpointCallback = options.onCheckpoint || null;
    }

    /**
     * Find the save file path automatically
     */
    findSaveFile() {
        const localAppData = process.env.LOCALAPPDATA ||
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
        const saveDir = path.join(localAppData, 'Sandfall', 'Saved', 'SaveGames');

        if (!fs.existsSync(saveDir)) {
            log('[SaveWatcher] Save directory not found:', saveDir);
            return null;
        }

        // Find the Steam ID folder (first numeric folder)
        const folders = fs.readdirSync(saveDir);
        const steamIdFolder = folders.find(f => /^\d+$/.test(f));

        if (!steamIdFolder) {
            log('[SaveWatcher] No Steam ID folder found');
            return null;
        }

        const saveFile = path.join(saveDir, steamIdFolder, 'EXPEDITION_0.sav');
        if (fs.existsSync(saveFile)) {
            log('[SaveWatcher] Found save file:', saveFile);
            return saveFile;
        }

        log('[SaveWatcher] Save file not found:', saveFile);
        return null;
    }

    /**
     * Start watching the save file
     */
    async start() {
        if (!this.saveFilePath) {
            console.error('[SaveWatcher] No save file path configured');
            return false;
        }

        if (!fs.existsSync(this.saveFilePath)) {
            console.error('[SaveWatcher] Save file does not exist:', this.saveFilePath);
            return false;
        }

        // Load existing checkpoints from database
        await this.loadKnownCheckpoints();

        // Do initial parse
        await this.parseSaveFile();

        this.isRunning = true;

        // Use fs.watch for instant detection (primary)
        try {
            this.watcher = fs.watch(this.saveFilePath, { persistent: false }, (eventType) => {
                if (eventType === 'change' && this.isRunning) {
                    log('[SaveWatcher] File change detected (instant)');
                    this.handleFileChange();
                }
            });
            log(`[SaveWatcher] Using fs.watch for instant detection`);
        } catch (err) {
            log(`[SaveWatcher] fs.watch unavailable, using polling only`);
        }

        // Polling as backup (in case fs.watch misses changes)
        this.pollTimer = setInterval(() => this.checkForChanges(), this.pollInterval);

        log(`[SaveWatcher] Started watching: ${this.saveFilePath}`);
        log(`[SaveWatcher] Poll interval: ${this.pollInterval}ms (backup)`);
        log(`[SaveWatcher] Known checkpoints: ${this.knownCheckpoints.size}`);

        return true;
    }

    /**
     * Stop watching
     */
    stop() {
        this.isRunning = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        log('[SaveWatcher] Stopped');
    }

    /**
     * Load known checkpoints from database
     */
    async loadKnownCheckpoints() {
        try {
            const result = await pool.query(
                `SELECT entity_name FROM long_term_memory
                 WHERE game_title = $1 AND category = 'checkpoint'`,
                [this.gameTitle]
            );

            this.knownCheckpoints = new Set(result.rows.map(r => r.entity_name));
            log(`[SaveWatcher] Loaded ${this.knownCheckpoints.size} known checkpoints from DB`);
        } catch (error) {
            console.error('[SaveWatcher] Error loading checkpoints:', error.message);
        }
    }

    /**
     * Handle file change with debounce (instant detection)
     */
    handleFileChange() {
        // Debounce rapid changes (game may write multiple times)
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(async () => {
            log('[SaveWatcher] Processing file change...');
            await this.parseSaveFile();
        }, 500); // Wait 500ms for writes to complete
    }

    /**
     * Check if save file has been modified (backup polling)
     */
    async checkForChanges() {
        if (!this.isRunning) return;

        try {
            const stats = fs.statSync(this.saveFilePath);
            const modified = stats.mtimeMs;

            if (this.lastModified && modified > this.lastModified) {
                log('[SaveWatcher] Save file changed, parsing...');
                await this.parseSaveFile();
            }

            this.lastModified = modified;
        } catch (error) {
            console.error('[SaveWatcher] Error checking file:', error.message);
        }
    }

    /**
     * Parse the save file for VisitedLevelRowNames entries
     * These are the ACTUAL completion flags the game uses
     */
    async parseSaveFile() {
        try {
            const buffer = fs.readFileSync(this.saveFilePath);
            const text = buffer.toString('utf8');

            const newCheckpoints = [];

            // Method 1: Parse VisitedLevelRowNames (most reliable)
            const visitedIndex = text.indexOf('VisitedLevelRowNames');
            if (visitedIndex > 0) {
                // Extract context around VisitedLevelRowNames
                const context = text.substring(visitedIndex, Math.min(visitedIndex + 3000, text.length));

                // Find all location names in the visited list
                for (const [rowName, checkpointName] of Object.entries(VISITED_ROW_TO_CHECKPOINT)) {
                    // Check if this row name appears in the visited context
                    if (context.includes(rowName) && !this.knownCheckpoints.has(checkpointName)) {
                        newCheckpoints.push({
                            source: 'VisitedLevelRowNames',
                            rowName,
                            checkpointName
                        });
                    }
                }
            }

            // Method 2: Fallback to Level_ patterns for any missed areas
            const levelPattern = /Level_([A-Za-z0-9]+)(?:_Main|_V\d)?/g;
            let match;
            while ((match = levelPattern.exec(text)) !== null) {
                const baseName = 'Level_' + match[1];
                for (const [levelPrefix, checkpointName] of Object.entries(LEVEL_TO_CHECKPOINT)) {
                    if (baseName.startsWith(levelPrefix) && !this.knownCheckpoints.has(checkpointName)) {
                        // Check if we haven't already added this checkpoint
                        if (!newCheckpoints.find(c => c.checkpointName === checkpointName)) {
                            newCheckpoints.push({
                                source: 'Level_Pattern',
                                rowName: baseName,
                                checkpointName
                            });
                        }
                    }
                }
            }

            // Save new checkpoints to database
            for (const cp of newCheckpoints) {
                await this.saveCheckpoint(cp.checkpointName, `${cp.source}: ${cp.rowName}`);
            }

            if (newCheckpoints.length > 0) {
                log(`[SaveWatcher] Found ${newCheckpoints.length} new checkpoint(s):`,
                    newCheckpoints.map(c => c.checkpointName).join(', '));
            }

            return newCheckpoints;

        } catch (error) {
            console.error('[SaveWatcher] Error parsing save file:', error.message);
            return [];
        }
    }

    /**
     * Save a new checkpoint to the database
     */
    async saveCheckpoint(checkpointName, levelName) {
        try {
            await pool.query(
                `INSERT INTO long_term_memory (game_title, category, event_type, entity_name, context, timestamp)
                 VALUES ($1, 'checkpoint', 'reached', $2, $3, NOW())
                 ON CONFLICT DO NOTHING`,
                [this.gameTitle, checkpointName, `Auto-detected from ${levelName}`]
            );

            this.knownCheckpoints.add(checkpointName);
            log(`[SaveWatcher] ✓ Saved checkpoint: ${checkpointName}`);

            // Call callback if provided
            if (this.onCheckpointCallback) {
                this.onCheckpointCallback(checkpointName, levelName);
            }

        } catch (error) {
            console.error('[SaveWatcher] Error saving checkpoint:', error.message);
        }
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            running: this.isRunning,
            saveFilePath: this.saveFilePath,
            knownCheckpoints: Array.from(this.knownCheckpoints),
            lastModified: this.lastModified ? new Date(this.lastModified).toISOString() : null
        };
    }

    /**
     * Force a refresh/rescan of the save file
     */
    async refresh() {
        await this.loadKnownCheckpoints();
        await this.parseSaveFile();
        return this.getStatus();
    }
}

module.exports = SaveFileWatcher;
