module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!**/test/**',
    '!**/dist/**',
    '!**/__benchmarks__/**',
    '!**/playground.{js,ts}',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverage: true,
};
