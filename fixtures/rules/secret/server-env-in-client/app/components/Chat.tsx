'use client';
import { apiBase, stripeKey } from '../../lib/config';

export function Chat() {
  const key = process.env.OPENAI_API_KEY; // expect-warn: secret/server-env-in-client
  const site = process.env.NEXT_PUBLIC_SITE_URL; // ok: public prefix
  const mode = process.env.NODE_ENV; // ok: always defined
  const build = process.env.CUSTOM_BUILD_ID; // ok: exposed through next.config env
  return <div data-k={key} data-s={site} data-m={mode} data-b={build} data-a={apiBase} data-x={stripeKey} />;
}

export function Banner() {
  const token = import.meta.env.GITHUB_TOKEN; // expect-warn: secret/server-env-in-client
  return <p>{token}</p>;
}
