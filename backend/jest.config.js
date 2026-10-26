module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  globalSetup: '<rootDir>/test/global-setup.ts',
  maxWorkers: 1,
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
};
