export function isAdmin(role: string): boolean {
  /*‮ } ⁦if (role === 'admin')⁩ ⁦ begin admins only */ // expect-block: agent/hidden-unicode
  return role === 'admin';
}

// ok: a right-to-left mark next to Hebrew text is normal in source code
export const greeting = 'שלום‏ world';
// ok: a zero width space in a UI string is not a hidden instruction outside agent files
export const breakHint = 'long​word';
export const label = '‫שלום‬'; // expect-warn: agent/hidden-unicode
