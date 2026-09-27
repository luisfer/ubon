import { execa, execaCommand } from 'execa';
import { Hono } from 'hono';
import { $ } from 'zx';

const app = new Hono();

app.post('/transcode', async (c) => {
  const { input } = await c.req.json();
  await execa('ffmpeg', ['-i', input, 'out.mp4']); // ok: execa without a shell passes input as one argument
  await $`ffmpeg -i ${input} out.mp4`; // ok: zx quotes interpolated values
  await execa(`ffmpeg -i ${input} out.mp4`, { shell: true }); // expect: web/command-injection
  await execaCommand(`${input} --help`); // expect: web/command-injection
  return c.json({ ok: true });
});

export default app;
