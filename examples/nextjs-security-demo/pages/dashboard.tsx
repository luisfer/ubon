import { useRouter } from 'next/router'

export default function Dashboard() {
  const router = useRouter();

  const goExternal = () => {
    // Intentional: external URL to trigger NEXT208
    router.push('https://example.com');
  };

  return (
    <div>
      <h1>Dashboard</h1>
      <button onClick={goExternal}>Go</button>
    </div>
  );
}


