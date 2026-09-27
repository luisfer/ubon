'use client';

import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import { renderSVG } from 'uqr';
import resetCss from './reset.css?inline';

export function CodeBlock({ code, shareUrl }: { code: string; shareUrl: string }) {
  const [html, setHtml] = useState('');
  const [preview, setPreview] = useState('');
  useEffect(() => {
    (async () => {
      const out = await codeToHtml(code, { lang: 'ts', theme: 'github-dark' });
      setHtml(out);
    })();
    codeToHtml(code, { lang: 'ts', theme: 'github-light' }).then(setPreview);
  }, [code]);
  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: html }} /> {/* ok: state only ever set to highlighter output */}
      <div dangerouslySetInnerHTML={{ __html: preview }} /> {/* ok: set through .then(setPreview) from the highlighter */}
      <div dangerouslySetInnerHTML={{ __html: renderSVG(shareUrl) }} /> {/* ok: QR code SVG, the data is encoded as modules */}
      <style dangerouslySetInnerHTML={{ __html: themeCss(code) }} /> {/* ok: CSS inside a <style> element */}
    </div>
  );
}

export function JsonView({ body }: { body: unknown }) {
  const [light, setLight] = useState('');
  const [dark, setDark] = useState('');
  useEffect(() => {
    const toHtml = (value: unknown) => codeToHtml(JSON.stringify(value, null, 2), { lang: 'json', theme: 'github-dark' });
    toHtml(body).then((html) => setDark(html));
    setLight(toHtml(body) as unknown as string);
  }, [body]);
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: dark }} /> {/* ok: set from .then((html) => ...) on highlighter output */}
      <div dangerouslySetInnerHTML={{ __html: light }} /> {/* ok: set from a local helper that returns highlighter output */}
    </>
  );
}

export function mountShadow(host: HTMLElement) {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${resetCss}</style><slot></slot>`; // ok: CSS asset bundled at build time
}

function themeCss(seed: string) {
  return `:root { --seed: ${seed.length}; }`;
}
