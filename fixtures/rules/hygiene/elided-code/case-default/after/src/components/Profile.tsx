export function Profile({ name, email }: { name: string; email: string }) {
  return (
    <section>
      <h1>{name}</h1>
      {/* ... */} {/* expect-block: hygiene/elided-code */}
      <button type="button" aria-label={`Edit ${email}`}>
        Edit
      </button>
    </section>
  );
}
