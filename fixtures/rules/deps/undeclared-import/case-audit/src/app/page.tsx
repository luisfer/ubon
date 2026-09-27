import React from 'react'; // ok: declared in package.json
import Link from 'next/link'; // ok: subpath of the declared next package
import { createClient } from '@supabase/supabase-js/dist/main/index.js'; // ok: deep import of a declared scoped package
import fs from 'node:fs'; // ok: Node built-in with node:
import path from 'path'; // ok: Node built-in without node:
import { readFile } from 'fs/promises'; // ok: Node built-in subpath
import { Button } from '@/components/button'; // ok: tsconfig path alias
import { money } from '~lib/money'; // ok: tsconfig path alias with a ~ prefix
import Header from '@ui/header'; // ok: bundler alias in vitest.config.ts
import { commit } from 'build-info'; // ok: declared with declare module in a .d.ts file
import logo from '../logo.svg'; // ok: relative import
import { format } from 'utils/format'; // ok: src/utils is a directory used as an import root
import get from 'lodash/get'; // expect-warn: deps/undeclared-import
import dayjs from 'dayjs'; // expect-warn: deps/undeclared-import
import type { Request } from 'express'; // ok: type-only import covered by @types/express
import type { ZodSchema } from 'zod'; // expect-warn: deps/undeclared-import
import 'server-only'; // ok: Next.js provides server-only
import { page } from '$app/stores'; // ok: SvelteKit virtual module
import { getCollection } from 'astro:content'; // ok: Astro virtual module
import { registerSW } from 'virtual:pwa-register'; // ok: Vite virtual module
import Home from '~icons/mdi/home'; // ok: unplugin-icons virtual module
import config from '#internal/config'; // ok: package.json subpath import

export { debounce } from 'lodash-es'; // ok: declared re-export source
export * from 'ramda'; // expect-warn: deps/undeclared-import

const watcher = (() => {
  try {
    return require('fsevents'); // ok: optional require inside try
  } catch {
    return null;
  }
})();

export async function load() {
  const sharp = await import('sharp').catch(() => null); // ok: optional import with .catch
  const ky = await import('ky'); // expect-warn: deps/undeclared-import
  const chalk = require('chalk'); // expect-warn: deps/undeclared-import
  return [React, Link, createClient, fs, path, readFile, Button, money, Header, commit, logo, format, get, dayjs, page, getCollection, registerSW, Home, config, watcher, sharp, ky, chalk];
}

export type Req = Request;
export type Schema = ZodSchema;
