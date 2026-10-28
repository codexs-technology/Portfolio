PRAGMA foreign_keys = ON;
CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE project_categories (name TEXT PRIMARY KEY CHECK(length(name) BETWEEN 1 AND 100));
CREATE TABLE projects (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, category TEXT NOT NULL REFERENCES project_categories(name) ON UPDATE CASCADE,
 summary TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX projects_public ON projects(status, sort_order, updated_at);
CREATE INDEX projects_category ON projects(category, status);
CREATE TABLE technologies (name TEXT PRIMARY KEY);
CREATE TABLE project_technologies (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, technology TEXT NOT NULL REFERENCES technologies(name) ON UPDATE CASCADE, PRIMARY KEY(project_id, technology));
CREATE TABLE project_media (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, object_key TEXT UNIQUE, url TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0), alt TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX media_project ON project_media(project_id, sort_order);
CREATE TABLE skills (id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE experience (id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE website_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE contact_submissions (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, project_type TEXT NOT NULL, budget TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','archived')), notification_status TEXT NOT NULL DEFAULT 'not_configured', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX contact_status ON contact_submissions(status, created_at);
CREATE TABLE audit_logs (id TEXT PRIMARY KEY, admin_id TEXT REFERENCES admin_users(id), action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX audit_recent ON audit_logs(created_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
CREATE TABLE github_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), expires_at INTEGER NOT NULL);