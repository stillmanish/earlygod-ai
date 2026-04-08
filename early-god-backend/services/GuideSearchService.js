const { Pool } = require('pg');
const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

class GuideSearchService {
    constructor(pool) {
        this.pool = pool;
    }

    // Helper function to search guides in database for RAG
    async search(query, gameTitle = null) {
        if (!this.pool) {
            console.error('❌ GuideSearchService: Database pool not initialized');
            return [];
        }

        log('🗄️ Starting database search for RAG (Service)');
        log('   🔍 Query:', query);
        log('   🎮 Game Filter:', gameTitle || 'None');
        
        try {
            const queryLower = query.toLowerCase();
            
            // Prepare game filter
            let guideGameFilter = '';
            let stepGameFilter = '';
            const guideParams = [`%${queryLower}%`];
            const stepParams = [`%${queryLower}%`];
            
            if (gameTitle) {
                const simplifiedGame = gameTitle.toLowerCase().split(':')[0].trim();
                
                // Game Aliases for better matching (e.g. EU5 vs Europa Universalis V)
                const aliases = {
                    'europa universalis v': 'eu5',
                    'europa universalis 5': 'eu5',
                    'age of empires 2': 'aoe2',
                    'age of empires 4': 'aoe4',
                    'league of legends': 'lol'
                };
                
                const alias = aliases[simplifiedGame];
                
                if (alias) {
                    log(`   🔄 Applying game alias: "${simplifiedGame}" OR "${alias}"`);
                    guideGameFilter = ` AND (LOWER(title) LIKE $2 OR LOWER(title) LIKE $3)`;
                    stepGameFilter = ` AND (LOWER(g.title) LIKE $2 OR LOWER(g.title) LIKE $3)`;
                    
                    const nameParam = `%${simplifiedGame}%`;
                    const aliasParam = `%${alias}%`;
                    
                    guideParams.push(nameParam, aliasParam);
                    stepParams.push(nameParam, aliasParam);
                } else {
                    // Standard search
                    guideGameFilter = ` AND LOWER(title) LIKE $2`;
                    stepGameFilter = ` AND LOWER(g.title) LIKE $2`;
                    
                    guideParams.push(`%${simplifiedGame}%`);
                    stepParams.push(`%${simplifiedGame}%`);
                }
            }
            
            // Search in guide titles and transcripts
            log('🔍 Searching guide titles and transcripts...');
            const guideSql = `
                SELECT id, title, transcript, channel_title 
                FROM guides 
                WHERE (LOWER(title) LIKE $1 
                   OR LOWER(transcript) LIKE $1 
                   OR LOWER(channel_title) LIKE $1)
                ${guideGameFilter}
                LIMIT 3
            `;
            
            const guideResults = await this.pool.query(guideSql, guideParams);
            
            const results = [];
            
            // Add guide-level results with context-aware snippets
            for (const guide of guideResults.rows) {
                let contentSnippet = 'No transcript available';
                
                if (guide.transcript) {
                    const lowerTranscript = guide.transcript.toLowerCase();
                    const matchIndex = lowerTranscript.indexOf(queryLower);
                    
                    if (matchIndex !== -1) {
                        // Found keyword! Extract window around it
                        const start = Math.max(0, matchIndex - 200);
                        const end = Math.min(guide.transcript.length, matchIndex + 800);
                        contentSnippet = `...${guide.transcript.substring(start, end)}...`;
                        log(`   🎯 Found keyword match at index ${matchIndex} in guide "${guide.title}"`);
                    } else {
                        // No keyword match (likely title match), return extended intro
                        contentSnippet = guide.transcript.substring(0, 1000);
                    }
                }

                const result = {
                    type: 'guide',
                    title: guide.title,
                    channel: guide.channel_title,
                    relevance: 'guide_match',
                    content: contentSnippet
                };
                results.push(result);
            }
            
            // Search in step content
            log('🔍 Searching step content...');
            const stepSql = `
                SELECT s.*, g.title as guide_title, g.channel_title
                FROM steps s
                JOIN guides g ON s.guide_id = g.id
                WHERE (LOWER(s.title) LIKE $1 
                   OR LOWER(s.action) LIKE $1
                   OR LOWER(s.observe) LIKE $1
                   OR LOWER(s.resources) LIKE $1)
                ${stepGameFilter}
                ORDER BY s.step_number
                LIMIT 5
            `;
            
            const stepResults = await this.pool.query(stepSql, stepParams);
            
            // Add step-level results with enhanced fields
            for (const step of stepResults.rows) {
                const result = {
                    type: 'step',
                    guide_title: step.guide_title,
                    step_number: step.step_number,
                    step_title: step.title,
                    action: step.action,
                    visual_cues: step.visual_cues,
                    observe: step.observe,
                    fallback: step.fallback,
                    resources: step.resources,
                    strategic_context: step.strategic_context,
                    estimated_time: step.estimated_time,
                    relevance: 'step_content'
                };
                results.push(result);
            }
            
            log(`✅ Database search completed (${results.length} results)`);
            return results;
            
        } catch (error) {
            console.error('❌ Error searching database for RAG:', error.message);
            return [];
        }
    }
}

module.exports = GuideSearchService;

