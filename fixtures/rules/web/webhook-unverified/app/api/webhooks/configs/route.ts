import { withWorkspace } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const POST = withWorkspace(async ({ req, workspace }) => {
  const input = await req.json(); // ok: wrapped in an auth wrapper, a CRUD API for webhook settings
  const webhook = await prisma.webhook.create({ data: { ...input, projectId: workspace.id } });
  return Response.json(webhook);
});
