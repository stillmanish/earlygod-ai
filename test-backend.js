#!/usr/bin/env node

/**
 * Backend Server Test Script
 * Use this to test if the backend server starts correctly
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Testing backend server startup...');

// Try multiple possible backend locations
const possiblePaths = [
    path.join(__dirname, 'early-god-backend'),
    path.join(__dirname, '..', 'early-god-backend'),
    path.join(process.cwd(), 'early-god-backend'),
    path.join(process.cwd(), '..', 'early-god-backend')
];

let backendPath = null;
for (const testPath of possiblePaths) {
    try {
        require('fs').accessSync(testPath, require('fs').constants.R_OK);
        backendPath = testPath;
        console.log('✅ Found backend at:', backendPath);
        break;
    } catch (e) {
        console.log('❌ Backend not found at:', testPath);
    }
}

if (!backendPath) {
    console.error('❌ Backend server not found in any expected location');
    process.exit(1);
}

console.log('🚀 Starting backend server in test mode...');

const backendProcess = spawn('node', ['server.js'], {
    cwd: backendPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, NODE_ENV: 'test' }
});

let started = false;

backendProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('📤 Backend:', output);

    if (output.includes('EarlyGod.ai backend running') && !started) {
        started = true;
        console.log('✅ Backend server started successfully!');

        // Test the health endpoint
        console.log('🔍 Testing health endpoint...');
        const http = require('http');

        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/health',
            method: 'GET',
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            console.log('📡 Health check status:', res.statusCode);

            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                console.log('📡 Health check response:', body);
                console.log('✅ Backend server is working correctly!');

                // Clean shutdown after test
                setTimeout(() => {
                    console.log('🛑 Shutting down test backend...');
                    backendProcess.kill('SIGTERM');
                    process.exit(0);
                }, 2000);
            });
        });

        req.on('error', (err) => {
            console.error('❌ Health check failed:', err.message);
            backendProcess.kill();
            process.exit(1);
        });

        req.end();
    }
});

backendProcess.stderr.on('data', (data) => {
    console.error('❌ Backend error:', data.toString());
});

backendProcess.on('error', (error) => {
    console.error('❌ Failed to start backend process:', error);
    process.exit(1);
});

// Timeout after 30 seconds
setTimeout(() => {
    if (!started) {
        console.error('❌ Backend startup timeout');
        backendProcess.kill();
        process.exit(1);
    }
}, 30000);
