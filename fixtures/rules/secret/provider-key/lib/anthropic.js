import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: "{{fake:anthropic}}", // expect: secret/provider-key
});

export default client;
