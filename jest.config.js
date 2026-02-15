const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};

if (process.env.CI === 'true' || process.env.UBON_ENFORCE_COVERAGE === '1') {
  config.coverageThreshold = {
    global: {
      statements: 50,
      branches: 35,
      functions: 45,
      lines: 50,
    },
  };
}

module.exports = config;