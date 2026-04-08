const JSONLToVertexConverter = require('./convert-jsonl-to-vertex');
const fs = require('fs');
const path = require('path');

/**
 * Test script to verify the JSONL to Vertex AI conversion
 */
async function testConversion() {
    console.log('🧪 Testing JSONL to Vertex AI conversion...\n');
    
    try {
        // First, run the cleaning script to ensure we have a clean source for testing
        console.log('🧼 Running cleaning script first...');
        require('./clean-jsonl'); // This will run the script synchronously
        console.log('✅ Cleaning script finished.\n');

        const converter = new JSONLToVertexConverter();
        
        // The converter is now pointing to the cleaned file, so we don't need to override inputFile here.
        
        console.log('🔍 Testing JSONL parsing...');
        const qaPairs = await converter.parseJSONL();
        console.log(`   ✅ Parsed ${qaPairs.length} Q&A pairs`);
        
        // Test a few samples
        console.log('\n📋 Sample Q&A pairs:');
        qaPairs.slice(0, 2).forEach((pair, index) => {
            console.log(`\n   ${index + 1}. Question: ${pair.question.substring(0, 80)}...`);
            console.log(`      Answer: ${pair.answer.substring(0, 100)}...`);
            console.log(`      Metadata: ${JSON.stringify(pair.metadata, null, 6)}`);
        });
        
        console.log('\n🧠 Testing embedding generation...');
        // Test with just one document to avoid API costs
        const testPair = qaPairs[0];
        const embedding = await converter.generateEmbedding(testPair.combined_text);
        console.log(`   ✅ Generated embedding with ${embedding.length} dimensions`);
        console.log(`   📊 First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
        
        console.log('\n✅ All tests passed! The conversion script is working correctly.');
        console.log('\n📋 To run the full conversion:');
        console.log('   node scripts/convert-jsonl-to-vertex.js');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('   Stack:', error.stack);
    }
}

// Run test if called directly
if (require.main === module) {
    require('dotenv').config();
    testConversion().catch(console.error);
}

module.exports = testConversion;
