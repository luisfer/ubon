import express from 'express'; // ok: declared and installed
import { legacy } from 'legacy-helper'; // expect-warn: deps/undeclared-import

export const app = express();
export const helper = legacy;
