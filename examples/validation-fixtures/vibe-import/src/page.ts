import { magicAuth } from '@acme/next-auth-magic';

export async function loadUser() {
  return magicAuth.currentUser();
}
