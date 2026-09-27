// ok: this suppression was approved before the session started
// ubon-ignore hygiene/placeholder: dana: the staging URL is a real host we own
export const staging = 'https://staging.example.com';

// ubon-ignore hygiene/placeholder: agent: the preview URL is only used in development // expect-block: integrity/new-suppression
export const preview = 'https://preview.example.com';

// ubon-ignore secret/provider-key, hygiene/placeholder: agent: user confirmed this is a sample value // expect-block: integrity/new-suppression
export const sample = 'your-api-key-here';
