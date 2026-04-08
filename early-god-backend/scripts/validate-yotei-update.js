const fs = require('fs');
const path = require('path');

/**
 * Validates the yotei_update_embeddings.json file to ensure it's compatible with Vertex AI.
 * Based on the successful validate-embeddings.js script
 */
function validateYoteiUpdate() {
    const embeddingsFile = path.join(__dirname, '..', 'vertex-data', 'yotei_update_embeddings.json');
    
    if (!fs.existsSync(embeddingsFile)) {
        console.error(`❌ Error: Embeddings file not found at: ${embeddingsFile}`);
        console.error(`   Please run the conversion script first: node scripts/convert-yotei-update.js`);
        process.exit(1);
    }

    console.log(`🔎 Validating embeddings file: ${embeddingsFile}`);

    const fileContent = fs.readFileSync(embeddingsFile, 'utf8');
    const lines = fileContent.split('\n');
    
    let invalidDimensionCount = 0;
    let invalidMetadataCount = 0;
    const expectedDimensions = 3078; // Vertex AI expects this exact number

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
            const record = JSON.parse(line);

            // 1. Validate Embedding Dimensions
            if (!record.embedding || record.embedding.length !== expectedDimensions) {
                console.error(`   - [Line ${i + 1}] Invalid Dimensions! ID: ${record.id}. Expected ${expectedDimensions}, but got ${record.embedding ? record.embedding.length : 'N/A'}.`);
                invalidDimensionCount++;
            }

            // 2. Validate Metadata Structure
            if (!record.metadata || typeof record.metadata !== 'object') {
                console.error(`   - [Line ${i + 1}] Invalid Metadata! ID: ${record.id}. Metadata is not a valid object.`);
                invalidMetadataCount++;
            }

            // 3. Validate Game Field (critical for filtering)
            if (!record.metadata || record.metadata.game !== 'ghost_of_yotei_dataset') {
                console.error(`   - [Line ${i + 1}] Missing/Wrong Game Field! ID: ${record.id}. Expected 'ghost_of_yotei_dataset', got '${record.metadata?.game || 'undefined'}'.`);
                invalidMetadataCount++;
            }

        } catch (e) {
            console.error(`   - [Line ${i + 1}] Failed to parse JSON. Error: ${e.message}`);
            invalidMetadataCount++; // Count parsing errors as metadata errors
        }
    }

    console.log('\n--- Validation Summary ---');
    console.log(`   Total Records Checked: ${lines.length}`);
    console.log(`   Expected Dimensions: ${expectedDimensions}`);
    console.log(`   Records with Invalid Dimensions: ${invalidDimensionCount}`);
    console.log(`   Records with Invalid Metadata: ${invalidMetadataCount}`);

    if (invalidDimensionCount === 0 && invalidMetadataCount === 0) {
        console.log('\n✅ Success! The file appears to be valid and ready for upload to Vertex AI.');
        console.log('\n📋 Next steps:');
        console.log('   1. Upload to GCS: gsutil cp vertex-data/yotei_update_embeddings.json gs://earlygod-ai-vector-data/');
        console.log('   2. Vertex AI will automatically detect and index the new file');
        console.log('   3. Test with Ghost of Yotei questions to verify new knowledge is available');
    } else {
        console.log('\n❌ Validation Failed. Please review the errors above.');
    }
}

validateYoteiUpdate();
