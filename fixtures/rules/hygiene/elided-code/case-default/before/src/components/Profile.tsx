export function Profile({ name, email }: { name: string; email: string }) {
  return (
    <section>
      <h1>{name}</h1>
      <p>{email}</p>
      <button type="button">Edit</button>
    </section>
  );
}
