import type { Node } from '@babel/types';
import { keyName, memberPath, propertyName, stringValue, unwrap } from '../../lang/js.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import type { JsContext, Rule } from '../types.ts';
import { Bindings, envNamesIn, exampleLevel, functionName, identifiersIn, isCall, lastSegment, templateShape } from './pattern-ast.ts';

/**
 * Webhook handlers that act on the request body without checking the
 * provider's signature. A handler is a request handler in a file whose path
 * contains "webhook", a route registered on a path that contains "webhook",
 * an exported function named like a webhook, an exported request handler
 * that branches on payment provider event types (checkout.session.completed),
 * or any function that reads a provider signature header (stripe-signature,
 * svix-*, x-hub-signature-256, x-slack-signature, x-twilio-signature, ...).
 * Paths and names that manage or send webhooks (create-webhook-endpoint,
 * send-signed-webhook, webhook-delivery) are not receivers.
 *
 * Any verification in the file clears it: Stripe constructEvent, Svix and
 * Standard Webhooks verify(), @octokit/webhooks, an HMAC with createHmac or
 * crypto.subtle, crypto.timingSafeEqual or a timingSafeCompare helper, a
 * comparison with a secret from the environment (directly or through a
 * constant), provider IP allowlists, fetching the event back from the
 * provider (stripe.events.retrieve, verifyPayment()), and functions named
 * like verifySignature or validateWebhook. Handlers behind an auth check
 * (webhook settings pages, CRUD APIs for webhook configuration) are not
 * receivers and are skipped.
 */

const SIGNATURE_HEADER =
  /^(stripe-signature|svix-(id|signature|timestamp)|webhook-(id|signature|timestamp)|x-hub-signature(-256)?|x-[\w-]*(signature|hmac)[\w-]*|[\w-]+-signature(-[\w]+)?|x-github-event|x-gitlab-(event|token)|x-shopify-(topic|hmac-sha256)|x-slack-request-timestamp|verif-hash|x-telegram-bot-api-secret-token)$/i;
const SECRET_NAME = /SECRET|TOKEN|KEY|PASSWORD|SIGNATURE|HMAC/i;
const EVENT_HEADER = /^(x-github-event|x-gitlab-event|x-shopify-topic|x-slack-request-timestamp|svix-id|svix-timestamp|webhook-id|webhook-timestamp)$/i;
const HTTP_METHOD = /^(POST|PUT|PATCH|DELETE|GET|ALL)$/;
const VERIFY_CALL =
  /(^|[.#])(constructEvent|constructEventAsync|verifyHeader|verify|verifyAndReceive|verifyKey|unmarshal|timingSafeEqual|createHmac|createNodeMiddleware|validateRequest|validateRequestWithBody|validateEvent|webhook)$/;
const VERIFY_NAME = /(verif|validat|check|authenticat)\w*(sig|webhook|hmac|secret|hook)|(sig|webhook|hmac|hook)\w*(verif|valid|check)|is(Valid|Authentic|Verified)(Signature|Webhook|Request|Hmac|Event)|ip.?range|allowed.?ips|ip.?allow|ip.?white|trusted.?ips/i;
const AUTH_CALL = /^(auth|getServerSession|currentUser|requireAuth|requireUser|requireAdmin|requireSession|authenticate\w*|getAuth|verifyAuth|validateApiKey|checkApiKey|verifyApiKey|withAuth|ensureAuth\w*|isAuthenticated|getAuthSession|validateSession|getKindeServerSession)$/;
/** Ambiguous names that are auth checks only without arguments or with the request: getUser(), getSession(req). */
const AUTH_CALL_NO_ARGS = /^(getUser|getSession|getCurrentUser|getToken)$/;
const AUTH_WRAPPER = /auth|session|workspace|user|protect|guard|permission|role|admin|team|org|apikey|api_key|private|authorized/i;
const AUTH_PARAMS = new Set(['session', 'user', 'workspace', 'authentication', 'auth', 'apiKey', 'currentUser', 'userId', 'organization', 'team']);
const REQUEST_NAME = /^(req|request|r|c|ctx|context|event|evt|e)$/;
const BODY_METHOD = new Set(['json', 'text', 'formData', 'arrayBuffer', 'blob', 'parseBody']);
const BODY_FUNCTION = /^(buffer|getRawBody|rawBody|readBody|readRawBody|readFormData|text|json|parseBody|getBody)$/;
const WRITE_METHOD = /(^|\.)(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|insert|insertMany|insertOne|updateOne|replaceOne|findOneAndUpdate|findByIdAndUpdate|findOneAndDelete|findByIdAndDelete|deleteOne|bulkWrite|save|del|increment|decrement|hset|hmset|lpush|rpush|sadd|zadd|incr|incrby|decr|setex|rpc|values|onConflictDoUpdate|executeTakeFirst)$/;
/** Receivers of database calls: prisma, db, tx, supabaseAdmin, dbClient, ctx.db, this.prisma, and model classes (User.create). */
const DB_ROOT = /^((ctx|this|context|req|locals)\.)?([A-Z]\w*|tx|trx|em|kv|orm|sql|\w*(prisma|Prisma|db|Db|DB|client|Client|supabase|Supabase|admin|Admin|knex|Knex|pool|Pool|conn|Conn|redis|Redis|firestore|Firestore|mongo|Mongo|collection|Collection|model|Model|drizzle|Drizzle|repo|Repo|database|Database)\w*)(\.|\(|$)/;
/** Path segments that manage or send webhooks rather than receive them: create-stripe-webhook-endpoint, send-signed-webhook, webhook-delivery. */
const WEBHOOK_ADMIN_WORDS = new Set(['create', 'setup', 'register', 'registration', 'manage', 'management', 'list', 'configure', 'config', 'settings', 'subscribe', 'unsubscribe', 'send', 'sender', 'signed', 'trigger', 'dispatch', 'deliver', 'delivery', 'deliveries', 'retry', 'replay', 'test', 'admin', 'logs', 'url', 'urls', 'metrics']);

const MUTATING_HELPER = /^(update|upsert|insert|delete|remove|save|store|persist|grant|revoke|cancel|fulfill|fulfil|provision|activate|deactivate|credit|debit|refund|increment|decrement|record|sync|mark|enqueue|manage)[A-Z_]/;
const CREATE_WRITE = /^create(?=[A-Z_])(?!.*(Client|Hmac|Hash|Router|Element|Stream|Logger|Context|Response|Error|Server|Admin|Signature|Verif|Sign|Cipher|Transport|Instance|Handler|App|Webhook|Url|URL|Headers|Request|Middleware|Schema|Connection|Pool|Stripe|Resend|Caller|Loader|Cookie|Storage|Secret|Key|Buffer|Uuid|Id$|Token|Event|Payload|Hook|Queue|Worker|Job|Factory|Helper|Provider|Service|Selector|Slice|Store))/;

function isWebhookReceiverPath(path: string): boolean {
  if (!/webhook/i.test(path)) return false;
  for (const segment of path.split('/')) {
    if (!/webhook/i.test(segment)) continue;
    const parts = segment.replace(/\.[cm]?[jt]sx?$/, '').split(/[-_.\s]+|(?<=[a-z])(?=[A-Z])/).map((w) => w.toLowerCase());
    if (parts.some((w) => WEBHOOK_ADMIN_WORDS.has(w))) return false;
  }
  return true;
}

interface Handler {
  fn: Node;
  name: string;
  /** Parents of the function, outermost first. */
  parents: readonly Node[];
  wrapper?: string;
}

function typeName(param: Node): string {
  const ann = (param as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation?.typeAnnotation;
  if (ann?.type === 'TSTypeReference') return memberPath(ann.typeName as Node) ?? '';
  return '';
}

function requestNames(fn: Node): Set<string> {
  const names = new Set<string>();
  const first = (fn as { params?: Node[] }).params?.[0];
  if (first?.type === 'Identifier' && (REQUEST_NAME.test(first.name) || /Request|IncomingMessage|Context|Event/.test(typeName(first)))) names.add(first.name);
  if (first?.type === 'ObjectPattern') {
    for (const p of first.properties) {
      if (p.type === 'ObjectProperty' && ['request', 'req', 'event'].includes(keyName(p) ?? '') && p.value.type === 'Identifier') names.add(p.value.name);
    }
  }
  return names;
}

/** `request.json()`, `await req.text()`, `req.body`, `c.req.json()`, `event.body`, `buffer(req)`. */
function bodyRead(node: Node, names: Set<string>): string | null {
  if (isCall(node)) {
    const callee = node.callee as Node;
    const path = memberPath(callee) ?? '';
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      const method = propertyName(callee) ?? '';
      const obj = memberPath(callee.object as Node) ?? '';
      if (BODY_METHOD.has(method) && (names.has(obj) || /^(c\.req|ctx\.req|context\.request|event\.request|ctx\.request)$/.test(obj))) return `${path}()`;
      return null;
    }
    if (callee.type === 'Identifier' && BODY_FUNCTION.test(callee.name) && node.arguments.some((a) => names.has(memberPath(a as Node) ?? ''))) return `${callee.name}()`;
    return null;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const path = memberPath(node) ?? '';
    const [head, prop, ...rest] = path.split('.');
    if (rest.length === 0 && head && names.has(head) && (prop === 'body' || prop === 'rawBody')) return path;
    if (/^(ctx|context)\.request\.(body|rawBody)$/.test(path)) return path;
  }
  return null;
}

/** A call that changes stored state: ORM and query builder writes, Supabase writes, SQL writes, fetch with a mutating method, helpers named like writes. */
function writeCall(node: Node, sameFileFunctions: ReadonlySet<string>): string | null {
  if (node.type === 'TaggedTemplateExpression') {
    const tag = memberPath(node.tag) ?? '';
    const text = node.quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' ');
    if (/^(sql|db|pool|client|tx)(\.\w+)?$/.test(tag) && /^\s*(insert|update|delete|upsert|merge|replace)\b/i.test(text)) return `${tag}\`${text.trim().split(/\s+/)[0]}\``;
    return null;
  }
  if (!isCall(node)) return null;
  const callee = node.callee as Node;
  const path = memberPath(callee) ?? '';
  const method = lastSegment(path);
  if (path === 'fetch' || /^(axios|ky|got|ofetch|\$fetch)(\.(post|put|patch|delete))?$/.test(path)) {
    if (/\.(post|put|patch|delete)$/.test(path)) return `${path}()`;
    const opts = unwrap(node.arguments[1] as Node);
    if (opts?.type === 'ObjectExpression') {
      const m = opts.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'method');
      const value = m && m.type === 'ObjectProperty' ? stringValue(m.value as Node) : null;
      if (value && /^(post|put|patch|delete)$/i.test(value)) return `${path}() with method ${value.toUpperCase()}`;
    }
    return null;
  }
  if (/^(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)$/.test(path)) return `${path}()`;
  // Firestore and Realtime Database: db.collection('x').doc(id).set(...), ref.child(id).update(...)
  if (/(\.|^)(collection|doc|ref|child)\(\)(\.|$)/.test(path) && /^(set|update|add|delete|create|push|remove)$/.test(method)) return `${path}()`;
  if (/(^|\.)(query|execute|exec|run|unsafe|raw)$/.test(path) && DB_ROOT.test(path)) {
    const text = templateShape(node.arguments[0] as Node)?.text ?? '';
    if (/^\s*(insert|update|delete|upsert|merge|replace)\b/i.test(text)) return `${path}()`;
    return null;
  }
  // Supabase: any client name, .from('table').insert/update/upsert/delete
  if (/(^|\.)from\(\)\.(insert|update|upsert|delete)$/.test(path)) return `${path}()`;
  if (WRITE_METHOD.test(path) && path.includes('.') && DB_ROOT.test(path)) {
    // stripe.webhooks.constructEvent is not a write; neither are cache or map sets on unknown objects.
    if (/^(Object|Array|Map|Set|JSON|Math|Promise|Reflect|console|headers|url|searchParams)\b/.test(path)) return null;
    return `${path}()`;
  }
  if (callee.type === 'Identifier' && !sameFileFunctions.has(callee.name) && (MUTATING_HELPER.test(method) || CREATE_WRITE.test(method))) return `${method}()`;
  if (callee.type !== 'Identifier' && MUTATING_HELPER.test(method)) return `${path}()`;
  if (/^(redis|kv|cache|upstash|store)\.(set|hset|sadd|lpush|rpush|zadd|incr|del)$/.test(path)) return `${path}()`;
  if (method === 'save' && node.arguments.length === 0 && callee.type !== 'Identifier') return `${path}()`;
  return null;
}

/** Event types that only a payment provider sends: a handler that branches on them is a webhook receiver. */
const PROVIDER_EVENT = /^(checkout\.session\.(completed|async_payment_succeeded|expired)|customer\.subscription\.(created|updated|deleted|trial_will_end)|invoice\.(paid|payment_succeeded|payment_failed|finalized)|payment_intent\.(succeeded|payment_failed)|charge\.(succeeded|refunded|failed|captured)|order_created|subscription_created|subscription_updated|subscription_payment_success|transaction\.completed|subscription\.activated)$/;

function handlesProviderEvents(node: Node): boolean {
  let found = false;
  walk(node, {
    enter(n) {
      if (found) return 'skip';
      if (n.type === 'StringLiteral' && PROVIDER_EVENT.test(n.value)) found = true;
      return undefined;
    },
  });
  return found;
}

function providerFix(text: string): string {
  if (/stripe-signature|from ['"]stripe['"]/i.test(text)) return 'Verify the event with stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET) and use the event it returns.';
  if (/svix-|from ['"](svix|standardwebhooks)['"]|webhook-signature/i.test(text)) return 'Verify the payload with new Webhook(secret).verify(rawBody, headers) from svix (or standardwebhooks) before using it.';
  if (/x-hub-signature/i.test(text)) return 'Verify x-hub-signature-256 with @octokit/webhooks verify() or an HMAC-SHA256 of the raw body compared with crypto.timingSafeEqual().';
  if (/x-slack-signature/i.test(text)) return 'Verify x-slack-signature with an HMAC-SHA256 of the raw body and timestamp, compared with crypto.timingSafeEqual().';
  if (/x-twilio-signature|from ['"]twilio['"]/i.test(text)) return 'Verify the request with twilio.validateRequest() (or the twilio.webhook() middleware) before acting on it.';
  return "Verify the provider's signature on the raw body before acting on it (the provider SDK's verify function, or an HMAC compared with crypto.timingSafeEqual()).";
}

export const webhookUnverified: Rule = {
  meta: {
    id: 'web/webhook-unverified',
    level: 'block',
    scope: 'file',
    title: 'Webhook handler without signature verification',
    summary: 'A webhook handler that reads the request body and acts on it without verifying the provider signature (Stripe constructEvent, Svix or Standard Webhooks verify, @octokit/webhooks, an HMAC compared with timingSafeEqual).',
    why: 'Webhook URLs are public. Without a signature check anyone can post a fake "payment succeeded" or "user created" event and the handler will grant plans, credits, or accounts as if the provider sent it.',
    fix: "Verify the provider's signature on the raw body before acting on the event.",
    cwe: ['CWE-345', 'CWE-347'],
    owasp: ['A07:2025', 'A08:2025'],
    levels: 'block when the handler writes state (database, ORM, Supabase, SQL, or a mutating fetch); warn when it only logs or calls helpers whose effect is unknown; warn in example, sample, and demo folders.',
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test') && !file.contexts.has('docs'),
  js(ctx) {
    if (ctx.file.client && !ctx.file.server) return {};
    return { 'Program:exit': () => check(ctx) };
  },
};

function check(ctx: JsContext): void {
  const program = ctx.program.program;
  const webhookPath = isWebhookReceiverPath(ctx.file.path);
  if (!webhookPath && !/webhook|signature|x-hub-|svix|x-slack|x-twilio|x-shopify|x-gitlab|checkout\.session\.|customer\.subscription\.|invoice\.pa|payment_intent\.|charge\.(succeeded|refunded)|order_created|subscription_(created|updated|payment)|transaction\.completed|subscription\.activated/i.test(ctx.text)) return;

  // Same-file functions by name, to follow the handler into its helpers.
  const functions = new Map<string, Node>();
  for (const stmt of program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' ? (stmt.declaration as Node | null) : stmt;
    if (!decl) continue;
    if (decl.type === 'FunctionDeclaration' && decl.id) functions.set(decl.id.name, decl);
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const init = unwrap(d.init as Node);
        if (d.id.type === 'Identifier' && init && isFunctionNode(init)) functions.set(d.id.name, init);
      }
    }
  }
  const names = new Set(functions.keys());

  let bindingsCache: Bindings | null = null;
  const bindings = () => (bindingsCache ??= new Bindings(program));
  // Verification anywhere in the file clears it.
  let verified = false;
  const signatureVars = new Set<string>();
  const handlers: Handler[] = [];
  const seen = new Set<Node>();
  const addHandler = (fn: Node | null | undefined, parents: readonly Node[], name: string, wrapper?: string) => {
    if (!fn || !isFunctionNode(fn) || seen.has(fn)) return;
    seen.add(fn);
    handlers.push({ fn, name, parents, ...(wrapper ? { wrapper } : {}) });
  };
  /** Functions passed to a wrapper call: withAxiom(async (req) => ...), withApi({ handler: async () => ... }). */
  const wrapped = (call: Node, parents: readonly Node[], name: string) => {
    if (!isCall(call)) return;
    const wrapper = memberPath(call.callee) ?? '';
    const chain = [...parents, call];
    for (const a of call.arguments as Node[]) {
      const u = unwrap(a);
      if (!u) continue;
      if (isFunctionNode(u)) addHandler(u, chain, name, wrapper);
      else if (u.type === 'ObjectExpression') {
        for (const p of u.properties) {
          if (p.type === 'ObjectProperty' && isFunctionNode(p.value as Node)) addHandler(p.value as Node, [...chain, u, p], name, wrapper);
          if (p.type === 'ObjectMethod') addHandler(p, [...chain, u], name, wrapper);
        }
      } else if (u.type === 'Identifier' && functions.has(u.name)) addHandler(functions.get(u.name), [], name, wrapper);
    }
  };

  walk(program, {
    enter(node, parents) {
      if (verified) return 'skip';
      // Verification evidence.
      if (isCall(node) || node.type === 'NewExpression') {
        const callee = (node as { callee: Node }).callee;
        const canonical = ctx.imports.canonical(callee) ?? '';
        const method = lastSegment(memberPath(callee));
        if (VERIFY_CALL.test(canonical) || VERIFY_CALL.test(memberPath(callee) ?? '') || VERIFY_NAME.test(method) || /^verify[A-Z]/.test(method) || /(^|\.)(events\.retrieve|payments?\.get)$/.test(memberPath(callee) ?? '') || /(^|\.)subtle\.(verify|sign)$/.test(memberPath(callee) ?? '') || /timing.?safe|safe.?compare|secure.?compare|constant.?time|tsscmp/i.test(method)) {
          if (!(method === 'webhook' && !/twilio/i.test(canonical))) {
            verified = true;
            return 'skip';
          }
        }
      }
      if (node.type === 'Identifier' && (VERIFY_NAME.test(node.name) || /^(verify|validate)[A-Z]/.test(node.name))) {
        // A verify middleware passed by reference: app.post('/webhook', verifyStripe, handler)
        const parent = parents[parents.length - 1];
        if (parent && isCall(parent) && parent.arguments.includes(node as never)) {
          verified = true;
          return 'skip';
        }
      }
      if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
        // A shared secret: if (req.headers.authorization !== `Bearer ${process.env.WEBHOOK_SECRET}`),
        // or through a constant: const SECRET = process.env.WEBHOOK_SECRET; if (token !== SECRET)
        const sides = [node.left as Node, node.right];
        let envs = sides.flatMap((side) => envNamesIn(side));
        if (envs.length === 0 && sides.some((side) => [...identifiersIn(side)].some((id) => SECRET_NAME.test(id)))) {
          envs = sides.flatMap((side) => envNamesIn(side, bindings(), parents));
        }
        if (envs.some((e) => SECRET_NAME.test(e))) {
          verified = true;
          return 'skip';
        }
      }

      // Handlers.
      const headerName = (() => {
        if (isCall(node)) {
          const m = lastSegment(memberPath(node.callee as Node));
          const name = stringValue(node.arguments[0] as Node) ?? '';
          return ['get', 'header', 'getHeader', 'headers'].includes(m) && SIGNATURE_HEADER.test(name) ? name : null;
        }
        if (node.type === 'MemberExpression' && /(^|\.)headers$/.test(memberPath(node.object as Node) ?? '')) {
          const prop = propertyName(node);
          return prop && SIGNATURE_HEADER.test(prop) ? prop : null;
        }
        return null;
      })();
      const readsSignature = headerName !== null;
      // Event and timestamp headers mark a webhook handler, but comparing them verifies nothing.
      const carriesSecret = headerName !== null && !EVENT_HEADER.test(headerName);
      // The signature value compared with something or passed to a check (not only tested for presence or logged).
      const usedAsCheck = (expr: Node, up: readonly Node[]): boolean => {
        let child = expr;
        for (let i = up.length - 1; i >= Math.max(0, up.length - 4); i--) {
          const p = up[i] as Node;
          if (p.type === 'TSAsExpression' || p.type === 'TSNonNullExpression' || p.type === 'AwaitExpression' || p.type === 'ParenthesizedExpression') {
            child = p;
            continue;
          }
          if (isCall(p) && p.arguments.includes(child as never)) return !/^(console\.|logger\.|log$|Boolean$|String$)/.test(memberPath(p.callee as Node) ?? '');
          if (p.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(p.operator)) {
            const other = unwrap((p.left === child ? p.right : p.left) as Node);
            return !!other && other.type !== 'NullLiteral' && !(other.type === 'Identifier' && other.name === 'undefined') && stringValue(other) !== '' && other.type !== 'UnaryExpression';
          }
          return false;
        }
        return false;
      };
      if (node.type === 'Identifier' && signatureVars.has(node.name) && usedAsCheck(node, parents)) {
        verified = true;
        return 'skip';
      }
      if (readsSignature) {
        if (carriesSecret && usedAsCheck(node, parents)) {
          verified = true;
          return 'skip';
        }
        for (let i = parents.length - 1; i >= Math.max(0, parents.length - 4) && carriesSecret; i--) {
          const p = parents[i] as Node;
          if (p.type === 'VariableDeclarator') {
            if (p.id.type === 'Identifier') signatureVars.add(p.id.name);
            break;
          }
        }
        for (let i = parents.length - 1; i >= 0; i--) {
          if (isFunctionNode(parents[i] as Node)) {
            const fnName = functionName(parents[i] as Node, parents.slice(0, i));
            addHandler(parents[i], parents.slice(0, i), fnName && HTTP_METHOD.test(fnName) ? `The ${fnName} webhook handler` : fnName && fnName !== 'default' ? `The webhook handler ${fnName}()` : 'This webhook handler');
            break;
          }
        }
      }
      if (isCall(node)) {
        const path = memberPath(node.callee as Node) ?? '';
        const route = stringValue(node.arguments[0] as Node);
        // app.post('/api/webhooks/stripe', ..., handler); router.post('/', handler) in a webhook file
        if (/(^|\.)(post|put|patch|all|use|route|on)$/.test(path) && route !== null && route.startsWith('/') && (isWebhookReceiverPath(route) || webhookPath)) {
          const last = unwrap(node.arguments[node.arguments.length - 1] as Node);
          if (last && isFunctionNode(last)) addHandler(last, [...parents, node], `The webhook route ${lastSegment(path).toUpperCase()} ${route}`);
          else if (last?.type === 'Identifier' && functions.has(last.name)) addHandler(functions.get(last.name), [], `The webhook handler ${last.name}()`);
        }
        // Deno.serve(async (req) => ...), serve(handler) in supabase/functions/stripe-webhook/index.ts
        if (webhookPath && /^(Deno\.serve|serve|Bun\.serve)$/.test(path)) {
          const arg = unwrap(node.arguments[node.arguments.length - 1] as Node);
          if (arg && isFunctionNode(arg)) addHandler(arg, [...parents, node], 'The serve() webhook handler');
          if (arg?.type === 'Identifier' && functions.has(arg.name)) addHandler(functions.get(arg.name), [], `The webhook handler ${arg.name}()`);
          if (arg?.type === 'ObjectExpression') {
            const fetchProp = arg.properties.find((p) => (p.type === 'ObjectMethod' || p.type === 'ObjectProperty') && keyName(p) === 'fetch');
            if (fetchProp && fetchProp.type !== 'SpreadElement') addHandler(fetchProp.type === 'ObjectMethod' ? fetchProp : (fetchProp.value as Node), [...parents, node, arg], 'The fetch() webhook handler');
          }
        }
      }
      return undefined;
    },
  });
  if (verified) return;

  // Exported handlers in webhook files, and exported functions named like webhooks anywhere.
  for (const stmt of program.body) {
    if (stmt.type === 'ExportDefaultDeclaration') {
      const d = unwrap(stmt.declaration as Node);
      if (!d) continue;
      if (!webhookPath) continue;
      if (isFunctionNode(d)) addHandler(d, [program, stmt], 'The default-export webhook handler');
      else if (isCall(d)) wrapped(d, [program, stmt], 'The default-export webhook handler');
      else if (d.type === 'ObjectExpression') {
        for (const p of d.properties) if ((p.type === 'ObjectMethod' || p.type === 'ObjectProperty') && keyName(p) === 'fetch') addHandler(p.type === 'ObjectMethod' ? p : (p.value as Node), [program, stmt, d], 'The fetch() webhook handler');
      } else if (d.type === 'Identifier' && functions.has(d.name)) addHandler(functions.get(d.name), [], 'The default-export webhook handler');
      continue;
    }
    if (stmt.type !== 'ExportNamedDeclaration' || !stmt.declaration) continue;
    const decl = stmt.declaration;
    const candidates: Array<[string, Node | null, Node[]]> = [];
    if (decl.type === 'FunctionDeclaration' && decl.id) candidates.push([decl.id.name, decl, [program, stmt]]);
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier') candidates.push([d.id.name, unwrap(d.init as Node), [program, stmt, decl, d]]);
    }
    for (const [name, value, chain] of candidates) {
      if (!value) continue;
      const isHandlerName = HTTP_METHOD.test(name) || /^(handler|action|default)$/.test(name);
      if (!(webhookPath && isHandlerName) && !isWebhookReceiverPath(name) && !(isHandlerName && handlesProviderEvents(value))) continue;
      const label = HTTP_METHOD.test(name) ? `The ${name} webhook handler` : `The webhook handler ${name}()`;
      if (isFunctionNode(value)) addHandler(value, chain, label);
      else if (isCall(value)) wrapped(value, chain, label);
    }
  }

  const reported = new Set<number>();
  for (const h of handlers) {
    if (h.wrapper && AUTH_WRAPPER.test(h.wrapper)) continue;
    const first = (h.fn as { params?: Node[] }).params?.[0];
    if (first?.type === 'ObjectPattern' && first.properties.some((p) => p.type === 'ObjectProperty' && AUTH_PARAMS.has(keyName(p) ?? ''))) continue;
    // The handler and the same-file functions it calls (two levels).
    const reach: Node[] = [h.fn];
    const queue: Array<[Node, number]> = [[h.fn, 0]];
    while (queue.length > 0) {
      const [fn, depth] = queue.shift() as [Node, number];
      if (depth >= 2) continue;
      walk(fn, {
        enter(n) {
          if (isCall(n) && n.callee.type === 'Identifier') {
            const target = functions.get(n.callee.name);
            if (target && !reach.includes(target)) {
              reach.push(target);
              queue.push([target, depth + 1]);
            }
          }
          return undefined;
        },
      });
    }
    type Site = { node: Node; what: string };
    let read = null as Site | null;
    let write = null as Site | null;
    let paired = false;
    let authed = false;
    for (const fn of reach) {
      const reqNames = requestNames(fn === h.fn ? h.fn : fn);
      if (fn !== h.fn) for (const n of requestNames(h.fn)) reqNames.add(n);
      let localRead = null as Site | null;
      let localWrite = null as Site | null;
      walk(fn, {
        enter(n) {
          if (!localRead) {
            const r = bodyRead(n, reqNames);
            if (r) localRead = { node: n, what: r };
          }
          if (!localWrite) {
            const w = writeCall(n, names);
            if (w) localWrite = { node: n, what: w };
          }
          if (isCall(n)) {
            const path = memberPath(n.callee as Node) ?? '';
            const m = lastSegment(path);
            const plainArgs = n.arguments.length === 0 || n.arguments.every((a) => /^(req|request|headers\(\)|await headers\(\))$/.test(memberPath(a as Node) ?? ''));
            if (AUTH_CALL.test(m) || (AUTH_CALL_NO_ARGS.test(m) && plainArgs) || /(^|\.)auth\.(getUser|getSession|getClaims|api\.getSession)$/.test(path)) authed = true;
          }
          return undefined;
        },
      });
      // A function that both reads and writes is the clearest place to point at.
      if (localRead && localWrite && !paired) {
        read = localRead;
        write = localWrite;
        paired = true;
      }
      read ??= localRead;
      write ??= localWrite;
    }
    if (!read || authed) continue;
    const r: Site = read;
    const line = r.node.loc?.start.line ?? 1;
    if (reported.has(line)) continue;
    reported.add(line);
    const w: Site | null = write;
    const writeLine = w ? w.node.loc?.start.line ?? 1 : 0;
    ctx.report(r.node, {
      level: w ? exampleLevel(ctx.file) : 'warn',
      message: w
        ? `${h.name} reads the body with ${r.what} and calls ${w.what} on line ${writeLine} without verifying the signature, so anyone who finds the URL can send it fake events.`
        : `${h.name} reads the body with ${r.what} without verifying the signature.`,
      fix: providerFix(ctx.text),
      key: h.name,
      ...(w ? { trace: [{ line, note: `request body read with ${r.what}` }, { line: writeLine, note: `state written with ${w.what}` }] } : {}),
    });
  }
}
