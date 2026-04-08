const fs = require('fs');
const path = require('path');

/**
 * Validates the generated embeddings files to ensure they are compatible with Vertex AI.
 * Checks for consistent embedding dimensions and valid metadata.
 * Accepts a game name as a command-line argument.
 */
function validateEmbeddingsFile() {
    // --- Get game name from command line ---
    const gameName = process.argv[2];
    if (!gameName) {
        console.error('❌ Error: Please provide the game name to validate.');
        console.error('   Example: node scripts/validate-embeddings.js expedition33');
        process.exit(1);
    }
    // ---

    const embeddingsFile = path.join(__dirname, '..', 'vertex-data', `${gameName}_embeddings.json`);
    
    if (!fs.existsSync(embeddingsFile)) {
        console.error(`❌ Error: Embeddings file not found at: ${embeddingsFile}`);
        console.error(`   Please run the conversion script first: node scripts/convert-jsonl-to-vertex.js ${gameName}`);
        process.exit(1);
    }

    console.log(`🔎 Validating embeddings file: ${embeddingsFile}`);

    const fileContent = fs.readFileSync(embeddingsFile, 'utf8');
    const lines = fileContent.split('\n');
    
    let invalidDimensionCount = 0;
    let invalidMetadataCount = 0;
    const expectedDimensions = 3078; // Vertex AI is expecting this exact number

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
    } else {
        console.log('\n❌ Validation Failed. Please review the errors above.');
    }
}

validateEmbeddingsFile();
