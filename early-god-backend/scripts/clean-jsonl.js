const fs = require('fs');
const path = require('path');

/**
 * Cleans a given JSONL file by removing HTML tags and fixing common JSON errors.
 *
 * Usage: node scripts/clean-jsonl.js <input-file> [output-file]
 *   input-file:  required, path to .jsonl file to clean
 *   output-file: optional, defaults to <input-file>_cleaned.jsonl
 */
function cleanJsonlFile() {
    const inputFile = process.argv[2];
    const outputFile = process.argv[3] || inputFile.replace(/\.jsonl$/, '_cleaned.jsonl');

    if (!inputFile) {
        console.error('❌ Error: Please provide the input file path as the first argument.');
        console.error('   Example: node scripts/clean-jsonl.js ./data/expedition33.jsonl');
        process.exit(1);
    }
    
    if (!fs.existsSync(inputFile)) {
        console.error(`❌ Error: Input file not found at: ${inputFile}`);
        process.exit(1);
    }

    console.log(`🧹 Starting cleanup of: ${inputFile}`);

    const fileContent = fs.readFileSync(inputFile, 'utf8');
    const lines = fileContent.split('\n');
    const cleanedLines = [];
    let linesFixed = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let originalLine = line;

        // 1. Remove any HTML tags
        line = line.replace(/<[^>]*>/g, '');

        // 2. Fix potential malformed JSON from copy-paste errors
        // This specifically looks for a pattern like `{"role":"- "user"` and fixes it.
        line = line.replace(/({"role":)"- ("user")/g, '$1$2');
        
        // This handles stray hyphens that might cause "No number after minus sign"
        // It looks for a hyphen that is clearly a mistake and not a negative number.
        // Example: `...": -"some text"` becomes `...": "some text"`
        line = line.replace(/": -"/g, '": "');


        if (line !== originalLine) {
            linesFixed++;
            console.log(`   🔧 Fixed line ${i + 1}`);
        }

        // 3. Only add lines that are likely valid JSON to avoid empty lines in the output
        if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
            try {
                // Final check to ensure the line is valid JSON before adding it
                JSON.parse(line);
                cleanedLines.push(line);
            } catch (e) {
                console.warn(`   ⚠️  Skipping invalid JSON on line ${i + 1} after cleaning.`);
            }
        }
    }

    fs.writeFileSync(outputFile, cleanedLines.join('\n'), 'utf8');

    console.log(`\n✅ Cleanup complete!`);
    console.log(`   🛠️  Total lines fixed: ${linesFixed}`);
    console.log(`   💾 Cleaned file saved to: ${outputFile}`);
}

// Allow the script to be called directly or required by another script
if (require.main === module) {
    cleanJsonlFile();
}

module.exports = cleanJsonlFile;
