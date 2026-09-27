import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { quote } from 'shell-quote';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  const { file, format } = await request.json();
  await execAsync(`convert ${file} out.${format}`); // expect: web/command-injection
  execFile('convert', [file, `out.${format}`]); // ok: argument array without a shell
  spawn('convert', [file, 'out.png'], { shell: true }); // expect: web/command-injection
  spawn('convert', [file, 'out.png']); // ok: fixed program, no shell
  await execAsync(`convert ${quote([file])} out.png`); // ok: shell-quote escapes the value
  await execAsync(`convert input.png out.${Number(format)}`); // ok: numeric cast
  return Response.json({ ok: true });
}
