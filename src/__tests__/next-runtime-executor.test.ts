import { runNextRuntimeChecks } from '../scanners/security/executors/next-runtime-executor';

describe('next runtime executor', () => {
  it('flags unvalidated API request input (NEXT003)', () => {
    const content = 'export default function handler(req,res){ const x=req.body.name; res.status(200).json({x}); }';
    const results = runNextRuntimeChecks({
      file: 'pages/api/hello.ts',
      content,
      lines: content.split('\n')
    });

    expect(results.some((r) => r.ruleId === 'NEXT003')).toBe(true);
  });

  it('flags token returned via JSON (NEXT007)', () => {
    const content = 'export default function handler(req,res){ res.json({ token: "abc" }); }';
    const results = runNextRuntimeChecks({
      file: 'pages/api/login.ts',
      content,
      lines: content.split('\n')
    });

    expect(results.some((r) => r.ruleId === 'NEXT007')).toBe(true);
  });

  it('flags client env leaks and external router push', () => {
    const content = `
import { useRouter } from 'next/navigation';
export default function Comp(){
  const router = useRouter();
  const secret = process.env.PRIVATE_KEY;
  router.push('https://evil.example.com');
  return null;
}
`;
    const results = runNextRuntimeChecks({
      file: 'app/page.tsx',
      content,
      lines: content.split('\n')
    });

    expect(results.some((r) => r.ruleId === 'NEXT011')).toBe(true);
    expect(results.some((r) => r.ruleId === 'NEXT208')).toBe(true);
  });

  it('flags SSR secret bleed (NEXT210)', () => {
    const content = `
export async function getServerSideProps() {
  const secret = process.env.OPENAI_API_KEY;
  return { props: { secret } };
}
`;
    const results = runNextRuntimeChecks({
      file: 'pages/index.tsx',
      content,
      lines: content.split('\n')
    });

    expect(results.some((r) => r.ruleId === 'NEXT006')).toBe(true);
    expect(results.some((r) => r.ruleId === 'NEXT210')).toBe(true);
  });
});
