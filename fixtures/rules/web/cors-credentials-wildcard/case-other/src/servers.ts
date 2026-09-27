import cors from '@fastify/cors';
import koaCors from '@koa/cors';
import { NestFactory } from '@nestjs/core';
import Fastify from 'fastify';
import Koa from 'koa';
import { AppModule } from './app.module';

export async function startFastify() {
  const fastify = Fastify();
  await fastify.register(cors, { origin: true, credentials: true }); // expect-block: web/cors-credentials-wildcard
  await fastify.register(cors, { origin: ['https://app.example.com'], credentials: true }); // ok: fixed list
  return fastify;
}

export async function startNest() {
  const app = await NestFactory.create(AppModule, { cors: { origin: '*', credentials: true } }); // expect-block: web/cors-credentials-wildcard
  app.enableCors({ origin: true, credentials: true }); // expect-block: web/cors-credentials-wildcard
  app.enableCors({ origin: 'https://app.example.com', credentials: true }); // ok: one fixed origin
  return app;
}

export function startKoa() {
  const app = new Koa();
  app.use(koaCors({ credentials: true })); // expect-block: web/cors-credentials-wildcard
  app.use(koaCors({ origin: 'https://app.example.com', credentials: true })); // ok: one fixed origin
  return app;
}
