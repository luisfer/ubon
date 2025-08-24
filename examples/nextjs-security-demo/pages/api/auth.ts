// Demo Next.js API route with security issues

export default function handler(req: any, res: any) {
  // NEXT001: JWT token exposed in JSON response
  const token = generateJWT();
  res.json({ user: req.body.user, token: token });

  // NEXT003: Unsafe redirect using user input
  if (req.query.redirect) {
    res.redirect(req.query.redirect);
  }

  // NEXT004: Permissive CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // COOKIE002: Insecure JWT cookie
  res.setHeader('Set-Cookie', 'jwt=eyJhbGciOiJIUzI1NiIs; Path=/');
}

function generateJWT() {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
}
