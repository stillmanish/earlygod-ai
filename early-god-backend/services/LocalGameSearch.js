/**
 * LocalGameSearch — replaces VertexVectorSearch with a local file-based search
 * over game primer JSON files. No Google Cloud, no embeddings, no API keys.
 *
 * Drop-in replacement: same constructor (singleton) and same async search(query, gameTitle) signature.
 *
 * How it works:
 * 1. On first use, loads all game-primer JSON files from frontend/game-primers/
 * 2. Tokenizes the query into keywords
 * 3. Scores each section of the matching game primer by keyword overlap
 * 4. Returns top 5 most relevant sections in the same shape Vertex returned
 *
 * Limitations vs Vertex:
 * - No semantic search (keyword matching only)
 * - No embeddings (search quality is lower for paraphrased questions)
 * - But: zero setup, zero cost, fully offline, deterministic
 *
 * For users who want true semantic search, see docs/RAG.md for how to plug in
 * Vertex AI / Pinecone / Chroma / pgvector / etc.
 */

const fs = require('fs');
const path = require('path');

const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class LocalGameSearchService {
    constructor() {
        this.primers = {};
        this.primersLoaded = false;
        this.primersDir = path.join(__dirname, '..', '..', 'frontend', 'game-primers');
        log('🔍 LocalGameSearch initialized (offline keyword search)');
    }

    loadPrimers() {
        if (this.primersLoaded) return;
        try {
            if (!fs.existsSync(this.primersDir)) {
                console.warn(`⚠️ game-primers directory not found at ${this.primersDir}`);
                this.primersLoaded = true;
                return;
            }
            const files = fs.readdirSync(this.primersDir).filter(f => f.endsWith('.json') && f !== 'metadata.json');
            for (const file of files) {
                try {
                    const fullPath = path.join(this.primersDir, file);
                    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                    const title = data.gameTitle || data.title || file.replace('.json', '');
                    this.primers[this.normalizeTitle(title)] = data;
                } catch (err) {
                    console.warn(`⚠️ Failed to load primer ${file}:`, err.message);
                }
            }
            log(`✅ Loaded ${Object.keys(this.primers).length} game primers for local search`);
            this.primersLoaded = true;
        } catch (err) {
            console.error('❌ Error loading game primers:', err.message);
            this.primersLoaded = true; // don't keep retrying
        }
    }

    normalizeTitle(title) {
        return String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    findPrimer(gameTitle) {
        if (!gameTitle) return null;
        const normalized = this.normalizeTitle(gameTitle);
        if (this.primers[normalized]) return this.primers[normalized];
        // Fuzzy: any primer whose normalized title contains the query or vice versa
        for (const [key, primer] of Object.entries(this.primers)) {
            if (key.includes(normalized) || normalized.includes(key)) return primer;
        }
        return null;
    }

    /**
     * Drop-in replacement for VertexVectorSearch.getVectorSearchGameId().
     * Original returned a hardcoded mapping. Local version returns the
     * gameTitle if a primer file exists for it, null otherwise.
     */
    getVectorSearchGameId(gameTitle) {
        this.loadPrimers();
        const primer = this.findPrimer(gameTitle);
        return primer ? (primer.gameTitle || gameTitle) : null;
    }

    tokenize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2);
    }

    /**
     * Drop-in replacement for VertexVectorSearch.search()
     * Returns array of objects: { type, title, content, relevance, score, source, game }
     */
    async search(query, gameTitle) {
        try {
            this.loadPrimers();

            if (!query) return [];
            const primer = this.findPrimer(gameTitle);
            if (!primer) {
                log(`   ℹ️ No local primer found for "${gameTitle}"`);
                return [];
            }

            const queryTokens = new Set(this.tokenize(query));
            if (queryTokens.size === 0) return [];

            // Walk the primer JSON and collect (sectionName, contentString) pairs
            const sections = this.flattenPrimer(primer);

            // Score each section by keyword overlap (Set for O(1) lookups)
            const scored = sections.map(section => {
                const sectionTokens = new Set(this.tokenize(section.content));
                let matches = 0;
                for (const token of queryTokens) {
                    if (sectionTokens.has(token)) matches++;
                }
                const score = matches / queryTokens.size;
                return { ...section, score };
            }).filter(s => s.score > 0);

            scored.sort((a, b) => b.score - a.score);

            const top = scored.slice(0, 5);
            log(`   ✅ Found ${top.length} local matches for "${query}" in ${gameTitle}`);

            return top.map(section => ({
                type: 'game_knowledge',
                title: `${primer.gameTitle || gameTitle} — ${section.path}`,
                content: section.content.substring(0, 500),
                relevance: 'keyword_match',
                score: section.score,
                source: 'local_primer',
                game: primer.gameTitle || gameTitle,
            }));
        } catch (err) {
            console.error('❌ LocalGameSearch error:', err.message);
            return [];
        }
    }

    /**
     * Flatten a nested game primer JSON into searchable (path, content) sections.
     */
    flattenPrimer(obj, pathPrefix = '') {
        const sections = [];
        if (obj == null) return sections;

        if (typeof obj === 'string') {
            sections.push({ path: pathPrefix || 'root', content: obj });
            return sections;
        }

        if (Array.isArray(obj)) {
            // Treat array as a single section by joining strings
            const joined = obj.map(item => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object') return JSON.stringify(item);
                return String(item);
            }).join(' | ');
            sections.push({ path: pathPrefix || 'list', content: joined });
            return sections;
        }

        if (typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                const newPath = pathPrefix ? `${pathPrefix}.${key}` : key;
                sections.push(...this.flattenPrimer(value, newPath));
            }
            return sections;
        }

        sections.push({ path: pathPrefix || 'value', content: String(obj) });
        return sections;
    }
}

module.exports = new LocalGameSearchService();
