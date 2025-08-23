# Next.js Example – Introduced Issues

This example intentionally includes the following findings for reconciliation:

- A11Y001: <img> without alt
- A11Y006: <img> without width/height
- A11Y004: <div onClick> (no keyboard accessibility)
- SEC016: eval()
- SEC008: process.env.FOO || 'fallback'
- JSNET001: fetch() without AbortController/signal
- SEC002/SEC004: Hardcoded Supabase URL
- SEC005: Hardcoded Supabase key
- COOKIE001: Set-Cookie without HttpOnly/Secure/SameSite
