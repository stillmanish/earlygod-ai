/**
 * Test Script: Enhanced Guide Processing
 * 
 * This script tests the enhanced guide processing system to verify:
 * 1. New fields (visual_cues, strategic_context) are extracted
 * 2. Action descriptions are detailed (100-200 words)
 * 3. Visual cues are rich and descriptive (80-150 words)
 * 4. Strategic context explains importance (60-120 words)
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testEnhancedGuideProcessing() {
    console.log('🧪 Testing Enhanced Guide Processing System\n');
    console.log('='.repeat(80));
    
    try {
        // 1. Check if new columns exist
        console.log('\n📋 Step 1: Checking Database Schema...');
        const schemaCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'steps' 
            AND column_name IN ('visual_cues', 'strategic_context')
            ORDER BY column_name
        `);
        
        if (schemaCheck.rows.length === 2) {
            console.log('✅ New columns exist in database:');
            schemaCheck.rows.forEach(row => {
                console.log(`   - ${row.column_name} (${row.data_type})`);
            });
        } else {
            console.log('❌ Missing columns! Run migration script:');
            console.log('   psql -d your_database < database-migration-add-enhanced-fields.sql');
            return;
        }
        
        // 2. Get sample of recently processed guides
        console.log('\n📋 Step 2: Analyzing Recently Processed Guides...');
        const recentGuides = await pool.query(`
            SELECT g.id, g.title, g.youtube_id, g.processing_status, g.created_at,
                   COUNT(s.id) as step_count
            FROM guides g
            LEFT JOIN steps s ON g.id = s.guide_id
            WHERE g.processing_status = 'completed'
            GROUP BY g.id
            ORDER BY g.created_at DESC
            LIMIT 5
        `);
        
        if (recentGuides.rows.length === 0) {
            console.log('⚠️  No completed guides found in database.');
            console.log('   Add a guide using: POST /add-guide');
            return;
        }
        
        console.log(`✅ Found ${recentGuides.rows.length} completed guides:\n`);
        recentGuides.rows.forEach((guide, idx) => {
            console.log(`${idx + 1}. ${guide.title}`);
            console.log(`   ID: ${guide.id} | Steps: ${guide.step_count} | YouTube: ${guide.youtube_id}`);
            console.log(`   Created: ${new Date(guide.created_at).toLocaleString()}\n`);
        });
        
        // 3. Analyze steps from most recent guide
        const guideToAnalyze = recentGuides.rows[0];
        console.log('='.repeat(80));
        console.log(`\n📋 Step 3: Analyzing Steps from: "${guideToAnalyze.title}"\n`);
        
        const steps = await pool.query(`
            SELECT step_number, title, action, visual_cues, observe, fallback, 
                   resources, strategic_context, estimated_time,
                   LENGTH(action) as action_length,
                   LENGTH(visual_cues) as visual_cues_length,
                   LENGTH(strategic_context) as strategic_context_length
            FROM steps
            WHERE guide_id = $1
            ORDER BY step_number
            LIMIT 10
        `, [guideToAnalyze.id]);
        
        if (steps.rows.length === 0) {
            console.log('⚠️  No steps found for this guide.');
            return;
        }
        
        // 4. Analyze field quality
        console.log('📊 Field Quality Analysis:\n');
        
        let stats = {
            total_steps: steps.rows.length,
            has_visual_cues: 0,
            has_strategic_context: 0,
            action_100_200_words: 0,
            visual_cues_80_150_words: 0,
            strategic_context_60_120_words: 0,
            needs_reprocessing: 0
        };
        
        steps.rows.forEach(step => {
            // Check if fields are populated (not placeholders)
            const hasVisualCues = step.visual_cues && 
                                  !step.visual_cues.includes('not yet extracted') &&
                                  step.visual_cues.length > 50;
            const hasStrategicContext = step.strategic_context && 
                                       !step.strategic_context.includes('not yet extracted') &&
                                       step.strategic_context.length > 50;
            
            if (hasVisualCues) stats.has_visual_cues++;
            if (hasStrategicContext) stats.has_strategic_context++;
            
            // Check word counts (approximate: chars / 5 = words)
            const actionWords = step.action_length / 5;
            const visualWords = step.visual_cues_length / 5;
            const strategicWords = step.strategic_context_length / 5;
            
            if (actionWords >= 100 && actionWords <= 200) stats.action_100_200_words++;
            if (visualWords >= 80 && visualWords <= 150) stats.visual_cues_80_150_words++;
            if (strategicWords >= 60 && strategicWords <= 120) stats.strategic_context_60_120_words++;
            
            if (!hasVisualCues || !hasStrategicContext) stats.needs_reprocessing++;
        });
        
        console.log(`Total Steps Analyzed: ${stats.total_steps}`);
        console.log(`\nField Population:`);
        console.log(`  ✓ Has Visual Cues: ${stats.has_visual_cues}/${stats.total_steps} (${Math.round(stats.has_visual_cues/stats.total_steps*100)}%)`);
        console.log(`  ✓ Has Strategic Context: ${stats.has_strategic_context}/${stats.total_steps} (${Math.round(stats.has_strategic_context/stats.total_steps*100)}%)`);
        
        console.log(`\nWord Count Quality (target ranges):`);
        console.log(`  ✓ Action (100-200 words): ${stats.action_100_200_words}/${stats.total_steps} (${Math.round(stats.action_100_200_words/stats.total_steps*100)}%)`);
        console.log(`  ✓ Visual Cues (80-150 words): ${stats.visual_cues_80_150_words}/${stats.total_steps} (${Math.round(stats.visual_cues_80_150_words/stats.total_steps*100)}%)`);
        console.log(`  ✓ Strategic Context (60-120 words): ${stats.strategic_context_60_120_words}/${stats.total_steps} (${Math.round(stats.strategic_context_60_120_words/stats.total_steps*100)}%)`);
        
        if (stats.needs_reprocessing > 0) {
            console.log(`\n⚠️  ${stats.needs_reprocessing} steps need reprocessing (have placeholder values)`);
            console.log(`   To reprocess: DELETE FROM guides WHERE id = ${guideToAnalyze.id}; then re-add the guide`);
        }
        
        // 5. Display sample steps
        console.log('\n' + '='.repeat(80));
        console.log('\n📋 Step 4: Sample Steps (showing first 3):\n');
        
        steps.rows.slice(0, 3).forEach((step, idx) => {
            console.log(`${'─'.repeat(80)}`);
            console.log(`\nStep ${step.step_number}: ${step.title}`);
            console.log(`\n📝 Action (${step.action_length} chars, ~${Math.round(step.action_length/5)} words):`);
            console.log(step.action.substring(0, 200) + (step.action.length > 200 ? '...' : ''));
            
            console.log(`\n👁️  Visual Cues (${step.visual_cues_length || 0} chars, ~${Math.round((step.visual_cues_length || 0)/5)} words):`);
            if (step.visual_cues) {
                console.log(step.visual_cues.substring(0, 200) + (step.visual_cues.length > 200 ? '...' : ''));
            } else {
                console.log('   (Not provided)');
            }
            
            console.log(`\n🎯 Strategic Context (${step.strategic_context_length || 0} chars, ~${Math.round((step.strategic_context_length || 0)/5)} words):`);
            if (step.strategic_context) {
                console.log(step.strategic_context.substring(0, 200) + (step.strategic_context.length > 200 ? '...' : ''));
            } else {
                console.log('   (Not provided)');
            }
            
            if (step.observe) {
                console.log(`\n✓ Observe: ${step.observe.substring(0, 100)}${step.observe.length > 100 ? '...' : ''}`);
            }
            if (step.resources) {
                console.log(`📦 Resources: ${step.resources.substring(0, 100)}${step.resources.length > 100 ? '...' : ''}`);
            }
            console.log(`⏱️  Estimated Time: ${step.estimated_time || 'Not specified'}`);
        });
        
        // 6. Overall assessment
        console.log('\n' + '='.repeat(80));
        console.log('\n📊 Overall Assessment:\n');
        
        const qualityScore = (
            (stats.has_visual_cues / stats.total_steps) * 0.35 +
            (stats.has_strategic_context / stats.total_steps) * 0.35 +
            (stats.action_100_200_words / stats.total_steps) * 0.30
        ) * 100;
        
        console.log(`Quality Score: ${Math.round(qualityScore)}%`);
        
        if (qualityScore >= 80) {
            console.log('✅ EXCELLENT - Guide has comprehensive enhanced details');
        } else if (qualityScore >= 50) {
            console.log('⚠️  GOOD - Guide has some enhanced details but could be improved');
        } else {
            console.log('❌ NEEDS REPROCESSING - Guide lacks enhanced details');
            console.log('   This guide was likely processed before the enhancement or failed to extract details.');
            console.log(`   Reprocess by: DELETE FROM guides WHERE id = ${guideToAnalyze.id}; then re-add`);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('\n✅ Test Complete!\n');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

// Run the test
testEnhancedGuideProcessing();

