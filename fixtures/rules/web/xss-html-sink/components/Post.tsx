import DOMPurify from 'isomorphic-dompurify';
import { renderToStaticMarkup } from 'react-dom/server';

interface Product {
  name: string;
  description: string;
}

export function Post({ html }: { html: string }) {
  const summary = renderToStaticMarkup(<strong>{html}</strong>);
  return (
    <article>
      <div dangerouslySetInnerHTML={{ __html: html }} /> {/* expect-warn: web/xss-html-sink */}
      <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} /> {/* ok: sanitized */}
      <div dangerouslySetInnerHTML={{ __html: summary }} /> {/* ok: React markup is escaped */}
    </article>
  );
}

export function ProductJsonLd({ product }: { product: Product }) {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Product', name: product.name, description: product.description };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /> {/* expect-warn: web/xss-html-sink */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} /> {/* ok: '<' escaped */}
    </>
  );
}
