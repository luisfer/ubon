import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { findChallenge, loadSnippet, readFixes } from '../lib/challenges';

const FIXES_DIR = 'data/codefixes';

export const checkAnswer = () => async (req: Request, res: Response, next: NextFunction) => {
  const key = req.body.key;
  let snippet;
  try {
    snippet = await loadSnippet(key);
    if (snippet == null) {
      res.status(404).json({ error: `No snippet for ${key}` });
      return;
    }
  } catch (error) {
    next(error);
    return;
  }
  const info = await readFile(`${FIXES_DIR}/${key}.info.yml`, 'utf8'); // expect-warn: web/path-traversal
  res.json({ lines: snippet.lines, info });
};

export const showFixes = () => (req: Request, res: Response) => {
  const key = req.params.key;
  const fixes = readFixes(key);
  if (fixes.files.length === 0) {
    res.status(404).json({ error: 'No fixes for this challenge' });
  } else {
    const hints = fs.readFileSync(path.join(FIXES_DIR, `${key}.hints.yml`), 'utf8'); // expect-warn: web/path-traversal
    res.json({ fixes: fixes.files, hints });
  }
};

export const showHint = () => async (req: Request, res: Response, next: NextFunction) => {
  const key = String(req.query.key);
  const challenge = await findChallenge(key);
  if (!challenge) return next();
  res.send(await readFile(path.join(FIXES_DIR, `${key}.hint.md`), 'utf8')); // expect-warn: web/path-traversal
};

// The lookup result is only logged, so every key reaches the file read.
export const showSolution = () => async (req: Request, res: Response) => {
  const key = String(req.query.key);
  const challenge = await findChallenge(key);
  console.log('solution requested', challenge?.name);
  res.send(await readFile(path.join(FIXES_DIR, `${key}.solution.md`), 'utf8')); // expect-block: web/path-traversal
};

// A file outside the directory exists too, so an existence check is not a lookup.
export const showNotes = () => (req: Request, res: Response) => {
  const file = path.join(FIXES_DIR, `${req.query.key}.notes.md`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  res.send(fs.readFileSync(file, 'utf8')); // expect-block: web/path-traversal
};

// The lookup checks the challenge id; the file name is another field.
export const showAttachment = () => async (req: Request, res: Response) => {
  const { challengeId, file } = req.body;
  const challenge = await findChallenge(challengeId);
  if (!challenge) return res.sendStatus(404);
  res.send(await readFile(path.join(FIXES_DIR, file))); // expect-block: web/path-traversal
};
