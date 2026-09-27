import { Button } from '@mono/ui'; // ok: a workspace package
import Dropzone from 'react-dropzone'; // ok: declared by another workspace member, which npm hoists to the root
import { z } from 'zod'; // expect-warn: deps/undeclared-import

export const parts = [Button, Dropzone, z];
