/**
 * MapService - Handles game map data and checkpoint visualization
 *
 * Provides:
 * - Map image and metadata retrieval
 * - Checkpoint positions with visited/current/potential status
 * - Adjacent checkpoint determination for pathfinding display
 */

const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:3001';

class MapService {
    constructor() {
        this.mapCache = new Map();
        this.checkpointCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get map data and all checkpoints for a game with their status
     */
    async getMapWithCheckpoints(gameTitle) {
        try {
            // Fetch map data
            const mapData = await this.fetchMapData(gameTitle);
            if (!mapData) {
                return {
                    success: false,
                    error: 'No map found for this game',
                    gameTitle
                };
            }

            // Fetch checkpoint positions
            const checkpoints = await this.fetchCheckpointPositions(gameTitle);

            // Fetch visited checkpoints from long-term memory
            const visitedCheckpoints = await this.fetchVisitedCheckpoints(gameTitle);
            const visitedSet = new Set(visitedCheckpoints.map(v => this.normalizeCheckpointName(v.entity_name)));

            // Determine current checkpoint (most recent visited)
            const currentCheckpoint = visitedCheckpoints.length > 0
                ? this.normalizeCheckpointName(visitedCheckpoints[0].entity_name)
                : null;

            // Get potential next checkpoints (adjacent to current)
            const potentialCheckpoints = new Set();
            if (currentCheckpoint) {
                const currentPos = checkpoints.find(cp =>
                    this.normalizeCheckpointName(cp.checkpoint_name) === currentCheckpoint ||
                    this.normalizeCheckpointName(cp.display_name) === currentCheckpoint
                );
                if (currentPos && currentPos.adjacent_checkpoints) {
                    currentPos.adjacent_checkpoints.forEach(adj => {
                        if (!visitedSet.has(this.normalizeCheckpointName(adj))) {
                            potentialCheckpoints.add(this.normalizeCheckpointName(adj));
                        }
                    });
                }
            }

            // Build checkpoint data with status
            // Logic:
            // - current: most recently visited (blinking green)
            // - completed: main story checkpoints that have been visited (solid green)
            // - visited: optional checkpoints that have been discovered but not necessarily completed (blue)
            // - potential: adjacent to current, not yet visited (yellow)
            // - unvisited: never visited (grey/locked)
            const checkpointsWithStatus = checkpoints.map(cp => {
                const normalizedName = this.normalizeCheckpointName(cp.checkpoint_name);
                const normalizedDisplay = this.normalizeCheckpointName(cp.display_name || cp.checkpoint_name);
                const isVisited = visitedSet.has(normalizedName) || visitedSet.has(normalizedDisplay);

                let status = 'unvisited'; // grey - locked
                if (normalizedName === currentCheckpoint || normalizedDisplay === currentCheckpoint) {
                    status = 'current'; // blinking green - you are here
                } else if (isVisited) {
                    // Main story checkpoints = completed when visited (you must finish to progress)
                    // Optional checkpoints = discovered (visited but might not have done everything)
                    status = cp.is_main_story ? 'completed' : 'visited';
                } else if (potentialCheckpoints.has(normalizedName)) {
                    status = 'potential'; // yellow - next destination
                }

                return {
                    id: cp.id,
                    name: cp.checkpoint_name,
                    displayName: cp.display_name || cp.checkpoint_name,
                    x: cp.x_position,
                    y: cp.y_position,
                    region: cp.region,
                    type: cp.checkpoint_type,
                    isMainStory: cp.is_main_story,
                    sortOrder: cp.sort_order,
                    adjacentCheckpoints: cp.adjacent_checkpoints || [],
                    status
                };
            });

            // Find connections to draw (from current to potential)
            const connections = [];
            if (currentCheckpoint) {
                const currentCp = checkpointsWithStatus.find(cp => cp.status === 'current');
                if (currentCp) {
                    checkpointsWithStatus
                        .filter(cp => cp.status === 'potential')
                        .forEach(potentialCp => {
                            connections.push({
                                from: {
                                    name: currentCp.name,
                                    x: currentCp.x,
                                    y: currentCp.y
                                },
                                to: {
                                    name: potentialCp.name,
                                    x: potentialCp.x,
                                    y: potentialCp.y
                                }
                            });
                        });
                }
            }

            return {
                success: true,
                gameTitle,
                map: {
                    imageUrl: mapData.map_image_url,
                    width: mapData.map_width,
                    height: mapData.map_height,
                    source: mapData.source_attribution
                },
                checkpoints: checkpointsWithStatus,
                connections,
                stats: {
                    total: checkpoints.length,
                    visited: visitedSet.size,
                    current: currentCheckpoint,
                    potentialNext: potentialCheckpoints.size
                }
            };
        } catch (error) {
            console.error('[MapService] Error getting map with checkpoints:', error);
            return {
                success: false,
                error: error.message,
                gameTitle
            };
        }
    }

    /**
     * Fetch map data from main backend
     */
    async fetchMapData(gameTitle) {
        const cacheKey = `map:${gameTitle}`;
        const cached = this.mapCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const response = await fetch(
                `${MAIN_BACKEND_URL}/api/map/${encodeURIComponent(gameTitle)}`,
                { headers: { 'Content-Type': 'application/json' } }
            );

            if (!response.ok) {
                console.warn('[MapService] Map not found for:', gameTitle);
                return null;
            }

            const data = await response.json();
            if (data.success && data.map) {
                this.mapCache.set(cacheKey, { data: data.map, timestamp: Date.now() });
                return data.map;
            }
            return null;
        } catch (error) {
            console.error('[MapService] Failed to fetch map:', error.message);
            return null;
        }
    }

    /**
     * Fetch checkpoint positions from main backend
     */
    async fetchCheckpointPositions(gameTitle) {
        const cacheKey = `checkpoints:${gameTitle}`;
        const cached = this.checkpointCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const response = await fetch(
                `${MAIN_BACKEND_URL}/api/map/${encodeURIComponent(gameTitle)}/checkpoints`,
                { headers: { 'Content-Type': 'application/json' } }
            );

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            if (data.success && data.checkpoints) {
                this.checkpointCache.set(cacheKey, { data: data.checkpoints, timestamp: Date.now() });
                return data.checkpoints;
            }
            return [];
        } catch (error) {
            console.error('[MapService] Failed to fetch checkpoints:', error.message);
            return [];
        }
    }

    /**
     * Fetch visited checkpoints from long-term memory
     */
    async fetchVisitedCheckpoints(gameTitle) {
        try {
            const response = await fetch(
                `${MAIN_BACKEND_URL}/api/memory/checkpoints/${encodeURIComponent(gameTitle)}?limit=100`,
                { headers: { 'Content-Type': 'application/json' } }
            );

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            if (data.success && data.checkpoints) {
                // Sort by timestamp descending (most recent first)
                return data.checkpoints.sort((a, b) =>
                    new Date(b.timestamp) - new Date(a.timestamp)
                );
            }
            return [];
        } catch (error) {
            console.error('[MapService] Failed to fetch visited checkpoints:', error.message);
            return [];
        }
    }

    /**
     * Normalize checkpoint name for comparison
     */
    normalizeCheckpointName(name) {
        if (!name) return '';
        return name
            .toLowerCase()
            .replace(/['']/g, "'")
            .replace(/[^a-z0-9\s']/g, '')
            .replace(/\s+/g, '_')
            .trim();
    }

    /**
     * Clear cache for a specific game
     */
    clearCache(gameTitle) {
        this.mapCache.delete(`map:${gameTitle}`);
        this.checkpointCache.delete(`checkpoints:${gameTitle}`);
    }

    /**
     * Clear all caches
     */
    clearAllCaches() {
        this.mapCache.clear();
        this.checkpointCache.clear();
    }
}

module.exports = MapService;
