-- framevane (working name): app index database
-- SQLite (better-sqlite3), one file at %APPDATA%\framevane\app.db, opened only by the Electron main process.
--
-- This database is an INDEX and a job/agent log. Each project's timeline lives in its own folder as
-- project.json (see architecture.md "Project document"), so a project can be copied, backed up or
-- opened by an external agent without the DB.
--
-- Conventions (adapted from replica-architect for a single-user desktop app):
--   ids          TEXT uuid v7, generated in the app (time-sortable)
--   times        INTEGER unix epoch milliseconds, UTC. Media times are INTEGER microseconds (*_us).
--   money        INTEGER micro-USD (agent token costs). No currency column: the Anthropic API bills in USD.
--   owner        no user_id/org_id columns: single local user. Access control = the main process is the
--                only DB client; the renderer and agents reach data through typed, validated IPC/tools.
--   json         TEXT holding JSON, validated with zod on write; CHECK(json_valid(...)) as a backstop.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ───────────────────────── projects (video projects and photo documents) ─────────────────────────
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'video' CHECK (type IN ('video','photo')),
  name          TEXT NOT NULL,
  dir_path      TEXT NOT NULL UNIQUE,              -- folder holding project.json / photo.json + media copies
  cover_path    TEXT,
  width         INTEGER NOT NULL CHECK (width  > 0),
  height        INTEGER NOT NULL CHECK (height > 0),
  fps_num       INTEGER CHECK (fps_num > 0),       -- NULL for photo docs
  fps_den       INTEGER CHECK (fps_den > 0),
  duration_us   INTEGER NOT NULL DEFAULT 0 CHECK (duration_us >= 0),
  doc_version   INTEGER NOT NULL DEFAULT 0,        -- bumped on every committed op batch; agents rebase on it
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','missing_media','missing_dir','corrupt')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  opened_at     INTEGER
);
CREATE INDEX projects_type_opened ON projects (type, opened_at DESC);
CREATE INDEX projects_updated     ON projects (updated_at DESC);

-- ───────────────────────── media (global, de-duplicated by content hash) ─────────────────────────
CREATE TABLE media_assets (
  id              TEXT PRIMARY KEY,
  hash            TEXT NOT NULL UNIQUE,            -- xxhash64 of first/last 4 MB + size; lets relink find moved files
  path            TEXT NOT NULL,                   -- current absolute path of the original
  kind            TEXT NOT NULL CHECK (kind IN ('video','audio','image','gif','lottie','svg')),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  duration_us     INTEGER CHECK (duration_us >= 0),
  width           INTEGER,
  height          INTEGER,
  fps_num         INTEGER,
  fps_den         INTEGER,
  is_vfr          INTEGER NOT NULL DEFAULT 0 CHECK (is_vfr IN (0,1)),
  video_codec     TEXT,
  audio_codec     TEXT,
  has_audio       INTEGER NOT NULL DEFAULT 0 CHECK (has_audio IN (0,1)),
  rotation        INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
  color_transfer  TEXT,                            -- bt709 | smpte2084 (HDR PQ) | arib-std-b67 (HLG) ...
  webcodecs_ok    INTEGER NOT NULL DEFAULT 0 CHECK (webcodecs_ok IN (0,1)),  -- decodable without mezzanine
  mezzanine_path  TEXT,                            -- full-res H.264 copy when the original isn't WebCodecs-decodable/is VFR/HDR
  proxy_path      TEXT,                            -- 720p/1080p short-GOP H.264 for scrubbing
  thumbs_path     TEXT,                            -- sprite sheet
  waveform_path   TEXT,                            -- peaks file
  status          TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','missing','unsupported')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX media_assets_kind ON media_assets (kind);
CREATE INDEX media_assets_path ON media_assets (path);

CREATE TABLE project_media (
  project_id  TEXT NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,  -- can't drop media a project uses
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, asset_id)
);
CREATE INDEX project_media_asset ON project_media (asset_id);

-- Non-destructive AI/processing outputs: mattes, upscales, denoised audio, stems, interpolated clips, TTS.
CREATE TABLE derived_assets (
  id               TEXT PRIMARY KEY,
  source_asset_id  TEXT REFERENCES media_assets(id) ON DELETE CASCADE,   -- NULL for generated-from-nothing (TTS, gen-AI)
  kind             TEXT NOT NULL CHECK (kind IN (
                     'matte','upscaled','interpolated','stabilized','denoised','enhanced_voice',
                     'stem_vocals','stem_music','reversed','tts','generated_image','generated_video','inpainted','expanded')),
  params_hash      TEXT NOT NULL,                  -- hash of tool + model + params + source range: cache key
  path             TEXT NOT NULL,
  duration_us      INTEGER,
  meta             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  created_at       INTEGER NOT NULL,
  last_used_at     INTEGER NOT NULL,              -- LRU cache eviction
  UNIQUE (source_asset_id, kind, params_hash)
);
CREATE INDEX derived_assets_lru ON derived_assets (last_used_at);

-- Analysis results reused by UI and agents (transcripts, scenes, beats, silences, faces, embeddings).
CREATE TABLE analyses (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('transcript','scenes','beats','silences','faces','subject_track','clip_embedding','loudness')),
  model       TEXT NOT NULL,                       -- e.g. 'faster-whisper:large-v3-turbo'
  language    TEXT,
  result      TEXT NOT NULL CHECK (json_valid(result)),  -- small results inline; big ones -> result_path
  result_path TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (asset_id, kind, model)
);

-- ───────────────────────── background jobs ─────────────────────────
CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'probe','proxy','mezzanine','thumbs','waveform','transcribe','scenes','beats','silences',
                 'matte','upscale','interpolate','stabilize','denoise','enhance_voice','stems','tts','reframe_track',
                 'inpaint','expand','export','agent_tool')),
  project_id   TEXT REFERENCES projects(id)     ON DELETE CASCADE,
  asset_id     TEXT REFERENCES media_assets(id) ON DELETE CASCADE,
  agent_run_id TEXT REFERENCES agent_runs(id)   ON DELETE SET NULL,
  dedupe_key   TEXT,                             -- same work queued twice collapses to one job
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,       -- user-visible work > background prefetch
  progress     REAL NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  params       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params)),
  result       TEXT CHECK (result IS NULL OR json_valid(result)),
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER
);
CREATE INDEX jobs_queue    ON jobs (status, priority DESC, created_at);
CREATE INDEX jobs_project  ON jobs (project_id);
CREATE INDEX jobs_asset    ON jobs (asset_id);
CREATE INDEX jobs_run      ON jobs (agent_run_id);
CREATE UNIQUE INDEX jobs_dedupe_active ON jobs (dedupe_key) WHERE status IN ('queued','running');

CREATE TABLE export_jobs (
  job_id       TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_version  INTEGER NOT NULL,                 -- the snapshot that was rendered
  output_path  TEXT NOT NULL,
  format       TEXT NOT NULL CHECK (format IN ('mp4','mov','webm','gif','mp3','wav','aac','png_seq','srt','txt')),
  video_codec  TEXT CHECK (video_codec IN ('h264','hevc','av1','vp9','prores')),
  width        INTEGER,
  height       INTEGER,
  fps_num      INTEGER,
  fps_den      INTEGER,
  bitrate_kbps INTEGER,
  range_in_us  INTEGER,
  range_out_us INTEGER,
  CHECK (range_out_us IS NULL OR range_out_us > range_in_us)
);
CREATE INDEX export_jobs_project ON export_jobs (project_id);

-- ───────────────────────── agents ─────────────────────────
-- A provider of tools: the built-in editor ops, the local AI sidecar, or any MCP server.
CREATE TABLE tool_providers (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('builtin','local_ai','mcp_stdio','mcp_http')),
  name        TEXT NOT NULL UNIQUE,              -- tool namespace prefix, [a-z0-9_]{1,24}
  command     TEXT,                              -- mcp_stdio
  args        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(args)),
  url         TEXT,                              -- mcp_http
  env_keys    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(env_keys)),  -- names only; values in OS keychain (safeStorage)
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  status      TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','connected','error','disabled')),
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK ((kind = 'mcp_stdio' AND command IS NOT NULL) OR (kind = 'mcp_http' AND url IS NOT NULL) OR kind IN ('builtin','local_ai'))
);

CREATE TABLE provider_tools (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES tool_providers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  input_schema  TEXT NOT NULL CHECK (json_valid(input_schema)),
  mutates       INTEGER NOT NULL DEFAULT 0 CHECK (mutates IN (0,1)),     -- produces edit ops / writes files
  costs_money   INTEGER NOT NULL DEFAULT 0 CHECK (costs_money IN (0,1)), -- e.g. remote gen-AI credits
  permission    TEXT NOT NULL DEFAULT 'ask' CHECK (permission IN ('auto','ask','never')),
  updated_at    INTEGER NOT NULL,
  UNIQUE (provider_id, name)
);

CREATE TABLE agent_defs (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL DEFAULT '',
  system_prompt  TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT 'claude-opus-5-5',
  effort         TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('low','medium','high','xhigh','max')),
  allowed_tools  TEXT NOT NULL DEFAULT '["*"]' CHECK (json_valid(allowed_tools)),  -- 'provider.tool' globs
  review_mode    TEXT NOT NULL DEFAULT 'propose' CHECK (review_mode IN ('propose','auto_apply')),
  max_cost_micro_usd INTEGER CHECK (max_cost_micro_usd > 0),
  builtin        INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE agent_runs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT REFERENCES projects(id)   ON DELETE CASCADE,  -- NULL for batch runs over loose photos
  agent_def_id       TEXT REFERENCES agent_defs(id) ON DELETE SET NULL,
  parent_run_id      TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,  -- batch (F14) children
  source             TEXT NOT NULL DEFAULT 'panel' CHECK (source IN ('panel','batch','external_mcp')),
  model              TEXT NOT NULL,
  prompt             TEXT NOT NULL,
  context            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context)),  -- selection, playhead, range
  base_doc_version   INTEGER NOT NULL,           -- doc version the agent started from
  status             TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                       'running','awaiting_permission','awaiting_review','applied','partially_applied',
                       'rejected','failed','cancelled')),
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd     INTEGER NOT NULL DEFAULT 0,
  error              TEXT,
  created_at         INTEGER NOT NULL,
  ended_at           INTEGER
);
CREATE INDEX agent_runs_project ON agent_runs (project_id, created_at DESC);
CREATE INDEX agent_runs_def     ON agent_runs (agent_def_id);
CREATE INDEX agent_runs_parent  ON agent_runs (parent_run_id);
CREATE INDEX agent_runs_status  ON agent_runs (status);

-- Full API transcript, append-only (required for preserved thinking: never edit earlier turns).
CREATE TABLE agent_messages (
  id        TEXT PRIMARY KEY,
  run_id    TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content   TEXT NOT NULL CHECK (json_valid(content)),   -- Anthropic content blocks verbatim; images stored as file refs
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE TABLE tool_calls (
  id            TEXT PRIMARY KEY,               -- = tool_use id from the API
  run_id        TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  provider_id   TEXT REFERENCES tool_providers(id) ON DELETE SET NULL,
  tool_name     TEXT NOT NULL,
  input         TEXT NOT NULL CHECK (json_valid(input)),
  status        TEXT NOT NULL CHECK (status IN ('pending_permission','running','done','error','denied')),
  output_summary TEXT,
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX tool_calls_run ON tool_calls (run_id, created_at);

-- Proposed edits. Same op format as the undo/redo journal, so applying = committing an op batch.
CREATE TABLE edit_ops (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  op          TEXT NOT NULL CHECK (json_valid(op)),       -- {type, ...args}
  inverse     TEXT NOT NULL CHECK (json_valid(inverse)),
  label       TEXT NOT NULL,                             -- human summary for S29 ("Cut 0:12.4–0:13.1 (silence)")
  target_ids  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_ids)),
  included    INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0,1)),
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','rejected','failed','conflicted')),
  UNIQUE (run_id, seq)
);
CREATE INDEX edit_ops_status ON edit_ops (run_id, status);

-- ───────────────────────── presets, fonts, settings ─────────────────────────
CREATE TABLE presets (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('color','text','caption_style','export','effect_params','animation')),
  name        TEXT NOT NULL,
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  builtin     INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (kind, name)
);

CREATE TABLE fonts (
  id        TEXT PRIMARY KEY,
  family    TEXT NOT NULL,
  style     TEXT NOT NULL DEFAULT 'normal',
  weight    INTEGER NOT NULL DEFAULT 400 CHECK (weight BETWEEN 100 AND 1000),
  path      TEXT NOT NULL UNIQUE,
  source    TEXT NOT NULL CHECK (source IN ('bundled','system','imported')),
  license   TEXT                                 -- 'OFL-1.1' etc. for bundled fonts
);
CREATE INDEX fonts_family ON fonts (family);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,                   -- 'performance.hwEncode', 'shortcuts', 'ai.device', ...
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
);
