import { initializeApp } from 'firebase/app';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ok: Firebase web config keys are public by design
export const app = initializeApp({
  apiKey: '{{fake:google-api}}',
  authDomain: 'acme-app.firebaseapp.com',
  projectId: 'acme-app',
});

export const genAI = new GoogleGenerativeAI('{{fake:google-api:2}}'); // expect-block: secret/provider-key
