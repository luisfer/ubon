import express from 'express'; // ok: declared in the example's own package.json
import session from 'express-session'; // expect-warn: deps/undeclared-import

export const app = express().use(session({ secret: process.env.SESSION_SECRET ?? '' }));
