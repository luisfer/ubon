import { generateText } from 'ai';

export function evaluate(formula: string) {
  return eval(formula); // expect-warn: web/code-eval
}

export async function loadLocale(locale: string) {
  return import(`../locales/${locale}.json`); // ok: dynamic import of unknown origin is code splitting, not reported
}

export async function modelMath(model: Parameters<typeof generateText>[0]['model']) {
  const { text } = await generateText({ model, prompt: 'Write a JavaScript expression for 2 + 2' });
  return eval(text); // ok: model output is reported by llm/output-to-sink, not here
}
