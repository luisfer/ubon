import Anthropic from '@anthropic-ai/sdk';

declare global {
  interface Window {
    ENV?: Record<string, string | undefined>;
  }
}

// Runtime config that the server writes into the page as window.ENV.
export class AssistantClient {
  private apiKey: string | null = null;
  private client: Anthropic | null = null;

  constructor() {
    this.apiKey = window.ENV?.ANTHROPIC_API_KEY ?? null;
    if (this.apiKey) {
      this.client = new Anthropic({
        apiKey: this.apiKey, // expect-block: llm/browser-key
        dangerouslyAllowBrowser: true,
      });
    }
  }
}
