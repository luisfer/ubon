import { addDays } from 'date-fns'; // ok: declared by packages/email; worker/package.json only sets the module type
import { v4 } from 'uuid'; // expect-warn: deps/undeclared-import

export const next = () => [addDays(new Date(), 1), v4()];
