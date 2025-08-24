import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RailsSecurityScanner } from '../scanners/rails-security-scanner';

describe('RailsSecurityScanner', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ubon-rails-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects command injection and html_safe in ERB', async () => {
    const controllersDir = join(dir, 'app', 'controllers');
    const viewsDir = join(dir, 'app', 'views');
    require('fs').mkdirSync(controllersDir, { recursive: true });
    require('fs').mkdirSync(viewsDir, { recursive: true });
    writeFileSync(join(controllersDir, 'admin_controller.rb'), `class AdminController < ApplicationController
  def backup
    system("tar -czf /tmp/backup.tar.gz #{params[:dir]}")
    render json: { ok: true }
  end
end
`);
    writeFileSync(join(viewsDir, 'users_show.html.erb'), `<%= @user.bio.html_safe %>\n`);

    const scanner = new RailsSecurityScanner();
    const results = await scanner.scan({ directory: dir } as any);
    const ids = results.map(r => r.ruleId);
    expect(ids).toContain('RAILS002');
    expect(ids).toContain('RAILS004');
  });

  it('detects SQL injection in where and find_by_sql', async () => {
    const modelsDir = join(dir, 'app', 'models');
    require('fs').mkdirSync(modelsDir, { recursive: true });
    writeFileSync(join(modelsDir, 'user.rb'), `class User < ApplicationRecord
  def self.find_by_name(name)
    where("name = '#{name}'").first
  end
  def self.by_sql(q)
    find_by_sql("SELECT * FROM users WHERE name = '#{params[:name]}'")
  end
end
`);
    const scanner = new RailsSecurityScanner();
    const results = await scanner.scan({ directory: dir } as any);
    const ids = results.map(r => r.ruleId);
    expect(ids).toContain('RAILS001');
  });
});


