import { Rule, RuleMeta } from '../types';
import TAILWIND001 from './TAILWIND001';

const make = (meta: RuleMeta, fileTypes?: string[]): Rule => ({
  meta,
  impl: {
    fileTypes: fileTypes || ['jsx', 'tsx']
  }
});

/**
 * React anti-pattern pack — the "vibe-coded React" class of bugs that AI
 * tools (Cursor, v0, Lovable, Claude Code) produce routinely. Detection lives
 * in `ReactPatternsScanner`; metadata is centralised here so `ubon explain`
 * and the LSP can surface it.
 */
export const reactRules: Record<string, Rule> = {
  TAILWIND001,

  REACT001: make({
    id: 'REACT001',
    category: 'development',
    severity: 'medium',
    message: 'Array index used as React `key` — breaks reconciliation on reorder/insert',
    fix: 'Use a stable id from the data (e.g. `item.id`). Falling back to `crypto.randomUUID()` only at creation time.',
    impact:
      'Index keys make React reuse the wrong component when the list is reordered or an item is removed — state and DOM state leak between rows.',
    helpUri: 'https://react.dev/learn/rendering-lists#why-does-react-need-keys'
  }),
  REACT002: make({
    id: 'REACT002',
    category: 'development',
    severity: 'high',
    message: 'Event handler invoked at render time (`onClick={fn()}` instead of `onClick={fn}`)',
    fix: 'Pass the function reference (`onClick={fn}`) or wrap in an arrow (`onClick={() => fn(arg)}`).',
    impact:
      'Invoking the handler at render causes infinite-loop re-renders when the handler sets state, and mis-attributes behavior (fires once on mount, then never).',
    helpUri: 'https://react.dev/learn/responding-to-events'
  }),
  REACT003: make({
    id: 'REACT003',
    category: 'development',
    severity: 'high',
    message: 'State mutated in place before setter call (React will not re-render)',
    fix: 'Produce a new value: `setArr([...arr, x])`, `setObj({ ...obj, foo: y })`.',
    impact:
      'React uses `Object.is` to decide if state changed. Pushing into an array or assigning to an object field keeps the same reference, so the setter is a no-op.',
    helpUri: 'https://react.dev/learn/updating-arrays-in-state'
  }),
  REACT004: make({
    id: 'REACT004',
    category: 'development',
    severity: 'medium',
    message: '`useEffect(cb, [])` closes over a state value without listing it as a dependency',
    fix: 'Add the value to the dependency array, move it into a ref, or rewrite using the functional setter form.',
    impact:
      'Empty-deps effects snapshot state from the first render; subsequent reads see stale data, which cascades into bad network calls and UI drift.',
    helpUri: 'https://react.dev/learn/you-might-not-need-an-effect'
  }),
  REACT005: make({
    id: 'REACT005',
    category: 'development',
    severity: 'high',
    message: '`useEffect` starts a timer / listener without returning a cleanup function',
    fix: 'Return a cleanup that calls `clearInterval` / `clearTimeout` / `removeEventListener`.',
    impact:
      'Intervals, timeouts, and listeners accumulate across renders and component remounts — memory leaks, duplicate network calls, and ghost event handlers.',
    helpUri: 'https://react.dev/reference/react/useEffect#subscribing-to-events'
  }),
  REACT006: make({
    id: 'REACT006',
    category: 'development',
    severity: 'medium',
    message: '`useEffect` issues `fetch` without an AbortController signal',
    fix: 'Create an `AbortController`, pass `signal` into `fetch`, and call `controller.abort()` in the cleanup.',
    impact:
      'Without aborting, an unmounted component still receives the response — setState-after-unmount warnings plus wasted bandwidth and race conditions.',
    helpUri: 'https://react.dev/reference/react/useEffect#fetching-data-with-effects'
  }),
  REACT007: make({
    id: 'REACT007',
    category: 'development',
    severity: 'high',
    message: 'Async function passed directly to `useEffect` (returns a Promise, not a cleanup)',
    fix: 'Declare an async function inside the effect and call it: `useEffect(() => { const run = async () => {...}; run(); }, [...])`.',
    impact:
      'React treats the returned Promise as a cleanup function — which it is not — and logs a warning. The real cleanup never runs.',
    helpUri: 'https://react.dev/reference/react/useEffect'
  }),
  REACT008: make({
    id: 'REACT008',
    category: 'development',
    severity: 'medium',
    message: '`useState(expensive())` runs the initializer on every render',
    fix: 'Pass a function: `useState(() => expensive())`. Lazy initializers run once on mount only.',
    impact:
      'Passing a call result runs the expensive computation (parseJSON, fetch, createClient) on every render; a lazy initializer defers it to mount.',
    helpUri: 'https://react.dev/reference/react/useState#avoiding-recreating-the-initial-state'
  }),
  REACT009: make({
    id: 'REACT009',
    category: 'development',
    severity: 'high',
    message: 'React hook called conditionally (inside `if` / ternary / loop / early return)',
    fix: 'Call every hook at the top level, unconditionally. Push the condition *inside* the hook body if needed.',
    impact:
      'Hook order is the only thing React has to bind state to components. Conditional calls break that order on later renders and crash the component.',
    helpUri: 'https://react.dev/reference/rules/rules-of-hooks'
  }),
  REACT010: make({
    id: 'REACT010',
    category: 'development',
    severity: 'medium',
    message: '`ref.current = …` assigned during render',
    fix: 'Mutate refs inside an event handler or `useEffect`. Rendering must be pure.',
    impact:
      'Writing to a ref during render violates React\'s purity rule — React 18 Strict Mode and Concurrent Rendering can execute render twice, doubling the write.',
    helpUri: 'https://react.dev/reference/react/useRef#referencing-a-value-with-a-ref'
  }),
  REACT011: make({
    id: 'REACT011',
    category: 'security',
    severity: 'high',
    message: 'JWT / bearer token stored in `localStorage` / `sessionStorage`',
    fix: 'Store the token in an HttpOnly cookie set by the server. localStorage is reachable by any XSS.',
    impact:
      'Any XSS anywhere in the app can read localStorage. HttpOnly cookies cannot be read from JS, closing the most common token-theft vector.',
    helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html'
  })
};
