/**
 * Icon Generator for Windows
 * Converts PNG to multi-resolution ICO file
 */

const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

async function generateWindowsIcon() {
  const inputPath = path.join(__dirname, 'assets', 'icon.png');
  const outputPath = path.join(__dirname, 'assets', 'icon.ico');
  
  log('🎨 Generating Windows ICO file...');
  log(`📁 Input: ${inputPath}`);
  log(`📁 Output: ${outputPath}`);
  
  try {
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    
    // Read the input PNG
    const inputBuffer = fs.readFileSync(inputPath);
    
    // Generate different sizes for ICO (Windows standard sizes)
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngBuffers = [];
    
    log('📐 Generating icon sizes:');
    for (const size of sizes) {
      log(`  ✓ ${size}x${size}px`);
      const buffer = await sharp(inputBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
      
      pngBuffers.push(buffer);
    }
    
    // Convert to ICO format
    log('\n🔨 Building ICO file...');
    const icoBuffer = await toIco(pngBuffers);
    
    // Write the ICO file
    fs.writeFileSync(outputPath, icoBuffer);
    
    log('\n✅ Windows icon generated successfully!');
    log(`📊 Sizes included: ${sizes.join(', ')}px`);
    log(`📦 File size: ${(icoBuffer.length / 1024).toFixed(2)} KB`);
    log(`\n🎯 Icon ready for electron-builder!`);
    log(`   Location: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Error generating icon:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('Input buffer contains unsupported image format')) {
      console.error('\n💡 Tip: Make sure icon.png is a valid PNG file');
      console.error('   You can convert images at: https://convertio.co/');
    }
    
    console.error('\nFull error:', error.stack);
    process.exit(1);
  }
}

// Run
generateWindowsIcon();

