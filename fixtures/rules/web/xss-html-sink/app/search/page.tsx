export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  return (
    <main>
      <h1 dangerouslySetInnerHTML={{ __html: `Results for ${q}` }} /> {/* expect-block: web/xss-html-sink */}
      <p>Results for {q}</p> {/* ok: JSX text is escaped */}
    </main>
  );
}
