import { NextResponse } from 'next/server';

const TRUSTED = new Set(['https://app.example.com']);

// The Supabase edge function shape: a public wildcard without credentials.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // ok: wildcard without credentials
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin, // expect-block: web/cors-credentials-wildcard
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = origin && TRUSTED.has(origin) ? origin : 'https://app.example.com';
  return NextResponse.json(
    { corsHeaders },
    { headers: { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Credentials': 'true' } }, // ok: the origin is checked against a set
  );
}

export async function POST() {
  const res = NextResponse.json({ saved: true });
  res.headers.set('Access-Control-Allow-Origin', '*'); // expect-warn: web/cors-credentials-wildcard
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}
