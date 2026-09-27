import { expect, it } from 'vitest';

const webhook = {
  url: 'https://hooks.example.com/30fb66a9',
  secret: '{{fake:stripe-webhook}}', // dummy secret
};
const leaked = '{{fake:stripe-webhook:2}}'; // expect: secret/provider-key
const storage = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;{{fake:azure-storage}};BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'; // ok: Azurite's published emulator key

it('signs payloads', () => {
  expect(webhook.secret).toBeDefined(); // ok: the secret above is labeled as a dummy value in a test
  expect(leaked && storage).toBeTruthy();
});
