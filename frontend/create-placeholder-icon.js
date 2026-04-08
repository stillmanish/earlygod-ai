/**
 * Creates a placeholder icon for EarlyGod.ai
 * Generates a proper PNG icon that can be converted to ICO
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const log = (typeof process !== 'undefined' && process.env && process.env.DEBUG) ? console.log.bind(console) : () => {};

async function createPlaceholderIcon() {
  const outputPng = path.join(__dirname, 'assets', 'icon.png');
  
  log('🎨 Creating placeholder icon...');
  
  try {
    // Create a 512x512 icon with EarlyGod.ai branding
    // Using a golden/gaming theme
    const size = 512;
    const svg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#FFA500;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${size}" height="${size}" fill="#1a1a2e" rx="80"/>
        <circle cx="${size/2}" cy="${size/2 - 40}" r="120" fill="url(#grad)"/>
        <circle cx="${size/2}" cy="${size/2 - 40}" r="80" fill="#1a1a2e"/>
        <circle cx="${size/2}" cy="${size/2 - 40}" r="60" fill="url(#grad)"/>
        <path d="M ${size/2 - 80} ${size/2 + 40} L ${size/2 + 80} ${size/2 + 40} L ${size/2} ${size/2 + 140} Z" fill="url(#grad)"/>
      </svg>
    `;
    
    // Generate PNG from SVG
    await sharp(Buffer.from(svg))
      .resize(512, 512)
      .png()
      .toFile(outputPng);
    
    log('✅ Placeholder icon created successfully!');
    log(`📁 Location: ${outputPng}`);
    log('\n💡 Tip: Replace this with your actual app icon later');
    log('   Recommended: 512x512 or 1024x1024 PNG with transparency');
    
  } catch (error) {
    console.error('❌ Error creating icon:', error.message);
    process.exit(1);
  }
}

createPlaceholderIcon();

