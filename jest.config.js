module.exports = {
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
  // Coverage from rule definitions (`src/rules/**/*.ts`) is ~100% because each
  // test pack exercises every rule's pattern. The numbers we _care_ about are
  // utility, core, and reporter coverage — those gates are intentionally
  // tighter so a regression in `redact` or `Posture` will fail CI.
  coverageThreshold: {
    './src/utils/redact.ts': {
      lines: 90,
      functions: 100,
      statements: 90,
    },
    './src/utils/sarif.ts': {
      lines: 90,
      functions: 100,
      statements: 90,
    },
    './src/core/Posture.ts': {
      lines: 90,
      functions: 100,
      statements: 90,
    },
  },
};