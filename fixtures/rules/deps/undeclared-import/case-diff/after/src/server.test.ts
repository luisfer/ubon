import { describe, it } from 'node:test'; // ok: Node built-in
import request from 'supertest'; // expect-block: deps/undeclared-import
import { app } from './server'; // ok: relative import

describe('server', () => {
  it('answers', async () => {
    await request(app).get('/');
  });
});
