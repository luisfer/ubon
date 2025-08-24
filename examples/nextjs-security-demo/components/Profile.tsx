// Demo Next.js component with security issues

export default function Profile() {
  // NEXT005: Environment variable leaked to client-side
  const apiUrl = process.env.DATABASE_URL;
  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL; // This is OK

  return (
    <div>
      <h1>Profile</h1>
      <p>API URL: {apiUrl}</p>
      <p>Public API URL: {publicApiUrl}</p>
    </div>
  );
}
