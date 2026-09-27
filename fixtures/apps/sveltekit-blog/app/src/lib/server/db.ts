import Database from 'better-sqlite3';

const db = new Database('blog.db');

export function listPosts() {
  return db.prepare('select slug, title from posts order by created_at desc').all() as { slug: string; title: string }[];
}

export function getPost(slug: string) {
  return db.prepare('select slug, title, html from posts where slug = ?').get(slug) as { slug: string; title: string; html: string } | undefined;
}

export function createPost(post: { slug: string; title: string; html: string }) {
  db.prepare('insert into posts (slug, title, html, created_at) values (?, ?, ?, ?)').run(post.slug, post.title, post.html, Date.now());
}

export function userForSession(sid: string) {
  return (db.prepare('select u.id, u.name, u.admin from sessions s join users u on u.id = s.user_id where s.id = ?').get(sid) ?? null) as App.Locals['user'];
}
