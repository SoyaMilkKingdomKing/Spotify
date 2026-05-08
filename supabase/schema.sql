create extension if not exists pgcrypto;

do $$
begin
  create type playlist_scenario as enum (
    'late_night_drive',
    'emo',
    'love_songs',
    'fast_paced'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  spotify_user_id text unique not null,
  display_name text,
  email text,
  country text,
  spotify_access_token_ciphertext text,
  spotify_refresh_token_ciphertext text,
  token_expires_at timestamptz,
  enabled_scenarios playlist_scenario[] default array[
    'late_night_drive',
    'emo',
    'love_songs',
    'fast_paced'
  ]::playlist_scenario[],
  target_track_count int default 30,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists artists (
  id uuid primary key default gen_random_uuid(),
  spotify_artist_id text unique not null,
  name text not null,
  genres text[] default '{}',
  popularity int,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text unique not null,
  spotify_uri text unique not null,
  name text not null,
  primary_artist_id uuid references artists(id),
  spotify_album_id text,
  album_name text,
  genres text[] default '{}',
  language text,
  release_date date,
  duration_ms int,
  popularity int,
  explicit boolean default false,
  tempo numeric,
  energy numeric,
  valence numeric,
  danceability numeric,
  acousticness numeric,
  instrumentalness numeric,
  speechiness numeric,
  audio_features_available boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  spotify_playlist_id text,
  spotify_snapshot_id text,
  scenario playlist_scenario not null,
  name text not null,
  status text default 'active',
  target_track_count int default 30,
  last_generated_for_date date,
  last_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, scenario)
);

create table if not exists playlist_tracks (
  playlist_id uuid references playlists(id) on delete cascade,
  generation_date date not null,
  track_id uuid references tracks(id),
  spotify_track_id text not null,
  position int not null,
  score numeric not null,
  score_breakdown jsonb,
  is_exploration boolean default false,
  user_feedback text,
  removed_at timestamptz,
  created_at timestamptz default now(),
  primary key (playlist_id, generation_date, track_id)
);

create table if not exists listening_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  track_id uuid references tracks(id),
  played_at timestamptz not null,
  play_duration_ms int,
  track_duration_ms int,
  skipped boolean default false,
  saved boolean default false,
  liked boolean default false,
  repeated boolean default false,
  removed_from_playlist boolean default false,
  source text default 'spotify_recently_played',
  raw_payload jsonb,
  created_at timestamptz default now(),
  unique(user_id, track_id, played_at, source)
);

create table if not exists recommendation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  playlist_id uuid references playlists(id) on delete set null,
  track_id uuid references tracks(id),
  scenario playlist_scenario not null,
  recommended_at timestamptz default now(),
  cooldown_until timestamptz,
  score numeric,
  selected boolean default true
);

create table if not exists user_preferences (
  user_id uuid references users(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  score numeric default 0,
  positive_count int default 0,
  negative_count int default 0,
  last_event_at timestamptz,
  updated_at timestamptz default now(),
  primary key (user_id, entity_type, entity_key)
);

create index if not exists idx_listening_user_played_at
  on listening_events(user_id, played_at desc);

create index if not exists idx_rec_history_user_track_time
  on recommendation_history(user_id, track_id, recommended_at desc);

create index if not exists idx_playlist_user_scenario
  on playlists(user_id, scenario);

create index if not exists idx_playlist_tracks_generation
  on playlist_tracks(playlist_id, generation_date);

create index if not exists idx_tracks_artist
  on tracks(primary_artist_id);
