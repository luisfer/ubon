import express from 'express'; // ok: declared and installed
import { legacy } from 'legacy-helper'; // expect-warn: deps/undeclared-import
import { z } from 'zod'; // ok: declared in this change, installed by the next install
import { format } from 'date-fns'; // expect-block: deps/undeclared-import
import chalk from 'chalk'; // expect-warn: deps/undeclared-import
import type { Options } from 'body-parser-types'; // expect-warn: deps/undeclared-import
import { ratelimit } from 'express-rate-limiter-pro'; // expect-block: deps/undeclared-import

export const app = express();
export const helper = legacy;
export const schema = z.object({ when: z.string() });
export const log = (d: Date) => chalk.dim(format(d, 'yyyy-MM-dd'));
export type ParserOptions = Options;
export const limiter = ratelimit;
