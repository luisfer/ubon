declare global {
  namespace App {
    interface Locals {
      user: { id: number; name: string; admin: boolean } | null;
    }
  }
}

export {};
