// Numbered migrations, applied in order and tracked in `PRAGMA user_version`.
// Never edit one that has shipped; add the next.

export const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE portal_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE players (
    pid TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  ) WITHOUT ROWID;

  -- The key is a secret and can be rotated, so everything else refers to the id.
  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    game_url TEXT NOT NULL,
    origins TEXT NOT NULL,
    max_members INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    page TEXT,
    param TEXT
  ) WITHOUT ROWID;
  CREATE INDEX invites_room ON invites(room_id);

  CREATE TABLE retained (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    pid TEXT NOT NULL DEFAULT '',
    ch TEXT NOT NULL,
    data TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (room_id, scope, pid, ch)
  ) WITHOUT ROWID;
  `,
  /* 2 */ `
  ALTER TABLE rooms ADD COLUMN version_policy TEXT NOT NULL DEFAULT 'exact';
  `,
  /* 3 */ `
  -- A room's log: its last snapshot, and the ops after it.
  CREATE TABLE ops (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    pid TEXT NOT NULL,
    op TEXT NOT NULL,
    ts INTEGER NOT NULL,
    PRIMARY KEY (room_id, seq)
  ) WITHOUT ROWID;

  CREATE TABLE snapshots (
    room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    up_to INTEGER NOT NULL,
    data TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  `,
  /* 4 */ `
  -- The game a room is held to: the game id it was first played with. NULL until then, and again once its owner
  -- lets another game in, or clears what it saved.
  ALTER TABLE rooms ADD COLUMN game_id TEXT;
  `,
  /* 5 */ `
  -- Whether the room is on the server's front page, and how much of its invite link is shown there: NULL when it is
  -- not, otherwise how many of the code's last characters are left out (0 for none).
  ALTER TABLE rooms ADD COLUMN front INTEGER;
  `,
  /* 6 */ `
  -- The URL parameter the room's game reads its invite from, for the links the portal builds. NULL for "room".
  ALTER TABLE rooms ADD COLUMN param TEXT;
  `,
]
