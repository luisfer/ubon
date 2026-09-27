// @ts-nocheck // expect-block: integrity/type-suppression
export interface User {
  id: string;
  name: string;
}

export function parseUser(input: any): User { // expect-warn: integrity/type-suppression
  const user = input as unknown as User; // expect-warn: integrity/type-suppression
  return user;
}

export function greet(user: User): string {
  // @ts-expect-error
  const shout: string = user.name.toUpperCase(1);
  // ok: @ts-expect-error with a reason documents an expected error
  // @ts-expect-error: the i18n library types reject template literals
  const label: string = translate(`hello.${shout}`);
  try {
    return `${label}, ${(user as any).nickname}`; // expect-warn: integrity/type-suppression
  } catch (error: any) {
    // ok: catch (error: any) is how TypeScript types a catch clause by default
    return String(error);
  }
}

// ok: the directive inside a string is not a comment
export const docs = 'Add // @ts-nocheck at the top of the file to turn checking off.';

declare function translate(key: string): string;
