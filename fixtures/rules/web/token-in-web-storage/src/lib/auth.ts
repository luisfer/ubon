import axios from 'axios';

const TOKEN_KEY = 'auth_token';

export async function login(email: string, password: string) {
  const { data } = await axios.post('/api/login', { email, password });
  localStorage.setItem('token', data.token); // expect: web/token-in-web-storage
  localStorage.setItem('accessToken', data.access_token); // expect: web/token-in-web-storage
  sessionStorage.setItem(TOKEN_KEY, data.token); // expect: web/token-in-web-storage
  localStorage.setItem('user', JSON.stringify({ ...data.user, jwt: data.jwt })); // expect: web/token-in-web-storage
  localStorage.setItem('tokenExpiresAt', String(data.expiresAt)); // ok: an expiry time, not the token
  return data.user;
}

export function saveTokens(tokens: { refresh_token: string }) {
  window.localStorage.refresh_token = tokens.refresh_token; // expect: web/token-in-web-storage
}

export function logout() {
  localStorage.removeItem('token'); // ok: removing is what logout should do
  const current = localStorage.getItem('token'); // ok: reads are not reported
  return current;
}

export function registerPush(pushToken: string) {
  localStorage.setItem('fcm_token', pushToken); // ok: push notification device token, not a credential
}
