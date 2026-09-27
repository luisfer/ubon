export function Hero() {
  return (
    <section>
      <h1>Welcome</h1>
      {/* expect-warn: hygiene/placeholder */} <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      {/* ok: an input placeholder showing an example address */}
      <input type="email" placeholder="you@example.com" />
    </section>
  );
}
