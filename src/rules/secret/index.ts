import { dbUrlPassword } from './db-url-password.ts';
import { envFileCommitted } from './env-files.ts';
import { inPrompt, inToolOutput, readSensitiveFile } from './hook-rules.ts';
import { keyFileCommitted } from './key-file-committed.ts';
import { providerKey } from './provider-key.ts';
import { publicEnvName } from './public-env-name.ts';
import { serverEnvInClient } from './server-env-in-client.ts';

export const secretRules = [
  providerKey,
  dbUrlPassword,
  publicEnvName,
  envFileCommitted,
  keyFileCommitted,
  serverEnvInClient,
  inPrompt,
  inToolOutput,
  readSensitiveFile,
];
