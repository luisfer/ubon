import { readFile } from 'node:fs/promises';

interface FileRequest {
  operation: 'read';
  path: string;
}

// An internal request object passed between modules, not an HTTP request.
export async function runFileOperation(request: FileRequest) {
  return readFile(request.path); // ok: typed as FileRequest, not an HTTP request
}
