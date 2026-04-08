module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js'],
    collectCoverageFrom: [
        '**/*.js',
        '!**/node_modules/**',
        '!**/coverage/**',
        '!jest.config.js'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/'
    ],
    testTimeout: 10000,
    verbose: true
};
