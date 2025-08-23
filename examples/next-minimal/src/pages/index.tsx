export default function Home() {
  return (
    <main>
      <h1>Hello Ubon</h1>
      {/* Intentional issues documented in ../ISSUES_NEXT.md */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hero.jpg" />
      <div onClick={() => alert('clicked')}>Click me</div>
      <pre>{process.env.API_URL || 'http://admin:password@api.example.com'}</pre>
      {eval('1+1')}
      {/* fetch without AbortController */}
      {/* @ts-ignore */}
      {fetch('https://example.com')}
      {/* Supabase hardcoded URL/key */}
      {/* @ts-ignore */}
      {(() => {
        const supabaseUrl = 'https://faketest123.supabase.co';
        const supabaseKey = 'sk_test_FAKE567890abcdefghijklmnopqrstuvwxyzFAKE567890';
        return supabaseUrl + supabaseKey.substring(0, 2);
      })()}
    </main>
  );
}


