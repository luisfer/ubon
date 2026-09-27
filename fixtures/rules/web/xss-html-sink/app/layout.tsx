import type { ReactNode } from 'react';
import { ANALYTICS_SNIPPET } from '../lib/snippets';

const THEME_SCRIPT = `(function () {
  try {
    var theme = localStorage.getItem('theme');
    document.documentElement.dataset.theme = theme || 'light';
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /> {/* ok: constant theme-flash script */}
        <script dangerouslySetInnerHTML={{ __html: ANALYTICS_SNIPPET }} /> {/* ok: constant imported from another module */}
      </head>
      <body>{children}</body>
    </html>
  );
}
