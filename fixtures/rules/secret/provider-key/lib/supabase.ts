import { createClient } from '@supabase/supabase-js';

const url = 'https://abcdefghijklmnopqrst.supabase.co';

export const admin = createClient(url, '{{fake:supabase-service-jwt}}'); // expect: secret/provider-key
export const browser = createClient(url, '{{fake:supabase-anon-jwt}}'); // ok: the anon key is public by design
export const secretKey = '{{fake:supabase-secret}}'; // expect: secret/provider-key
export const localAdmin = createClient('http://127.0.0.1:54321', '{{fake:supabase-demo-service-jwt}}'); // ok: the Supabase CLI's published local development key
