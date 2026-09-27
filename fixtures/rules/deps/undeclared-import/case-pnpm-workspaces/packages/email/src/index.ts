import { Button } from '@mono/ui'; // ok: a workspace package
import Dropzone from 'react-dropzone'; // expect-warn: deps/undeclared-import
import { z } from 'zod'; // expect-warn: deps/undeclared-import

// pnpm links only declared dependencies into packages/email/node_modules, so
// react-dropzone, declared by @mono/ui, does not resolve here.
export const parts = [Button, Dropzone, z];
