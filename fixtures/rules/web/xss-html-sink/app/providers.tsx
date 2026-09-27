export function StateScript({ state, storageKey }: { state: Record<string, unknown>; storageKey: string }) {
  const serialized = JSON.stringify(state).replace(/</g, '\\u003c');
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.__STATE__ = ${serialized};` }} /> {/* ok: '<' escaped before it reaches the script */}
      <script dangerouslySetInnerHTML={{ __html: themeScript(storageKey) }} /> {/* ok: script body built in code */}
      <script dangerouslySetInnerHTML={{ __html: `window.__USER__ = ${JSON.stringify(state.user)};` }} /> {/* expect-warn: web/xss-html-sink */}
    </>
  );
}

function themeScript(key: string) {
  return `document.documentElement.dataset.theme = localStorage.getItem(${JSON.stringify(key)}) || 'light';`;
}
