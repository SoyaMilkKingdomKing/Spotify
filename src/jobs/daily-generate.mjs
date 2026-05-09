import { SCENARIOS, DEFAULT_SCENARIO_IDS } from "../../config/scenarios.mjs";
import { readBooleanEnv, readEnv, readNumberEnv } from "../lib/env.mjs";
import { createSupabaseClientFromEnv, eq, gte } from "../lib/supabase.mjs";
import {
  refreshAccessToken,
  SpotifyClient
} from "../lib/spotify.mjs";
import {
  getDatePrefix,
  getZonedParts,
  getLocalDateKey,
} from "../lib/time.mjs";
import {
  cooldownUntilForSelection,
  scoreCandidate,
  selectTracks
} from "../lib/recommender.mjs";

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function inferLanguage(candidate) {
  const text = [candidate.name, candidate.albumName, candidate.primaryArtistName].join(" ");
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  return null;
}

function mergeCandidate(map, track, source, extra = {}) {
  if (!track?.id || !track?.uri || track.type !== "track") return null;

  const existing = map.get(track.id);
  const artists = (track.artists ?? []).map((artist) => ({
    spotifyArtistId: artist.id,
    name: artist.name
  }));

  const candidate = existing ?? {
    spotifyTrackId: track.id,
    uri: track.uri,
    name: track.name,
    albumSpotifyId: track.album?.id ?? null,
    albumName: track.album?.name ?? null,
    durationMs: track.duration_ms ?? null,
    popularity: track.popularity ?? null,
    explicit: Boolean(track.explicit),
    artists,
    primaryArtistSpotifyId: artists[0]?.spotifyArtistId ?? null,
    primaryArtistName: artists[0]?.name ?? null,
    primaryArtistDbId: null,
    genres: [],
    language: null,
    sourceSet: new Set(),
    searchScenarioIds: new Set(),
    saved: false,
    recentPlayCount: 0,
    topScore: 0,
    topArtistScore: 0,
    isExploration: false,
    tempo: null,
    energy: null,
    valence: null,
    danceability: null,
    acousticness: null,
    instrumentalness: null,
    speechiness: null,
    dbTrackId: null
  };

  candidate.sourceSet.add(source);
  candidate.saved ||= Boolean(extra.saved);
  candidate.recentPlayCount += extra.recentPlayCount ?? 0;
  candidate.topScore = Math.max(candidate.topScore, extra.topScore ?? 0);
  candidate.topArtistScore = Math.max(candidate.topArtistScore, extra.topArtistScore ?? 0);

  if (extra.scenarioId) {
    candidate.searchScenarioIds.add(extra.scenarioId);
  }

  map.set(track.id, candidate);
  return candidate;
}

function candidateToTrackRow(candidate) {
  return {
    spotify_track_id: candidate.spotifyTrackId,
    spotify_uri: candidate.uri,
    name: candidate.name,
    primary_artist_id: candidate.primaryArtistDbId,
    spotify_album_id: candidate.albumSpotifyId,
    album_name: candidate.albumName,
    genres: candidate.genres,
    language: candidate.language,
    duration_ms: candidate.durationMs,
    popularity: candidate.popularity,
    explicit: candidate.explicit,
    tempo: candidate.tempo,
    energy: candidate.energy,
    valence: candidate.valence,
    danceability: candidate.danceability,
    acousticness: candidate.acousticness,
    instrumentalness: candidate.instrumentalness,
    speechiness: candidate.speechiness,
    audio_features_available: candidate.energy !== null || candidate.tempo !== null,
    updated_at: new Date().toISOString()
  };
}

async function collectCandidates(spotify, scenarios, config) {
  const candidates = new Map();
  const recentItems = [];

  const recentlyPlayed = await spotify.getRecentlyPlayed(50);
  for (const item of recentlyPlayed) {
    const candidate = mergeCandidate(candidates, item.track, "recent", { recentPlayCount: 1 });
    if (candidate) {
      recentItems.push({
        candidate,
        playedAt: item.played_at,
        raw: item
      });
    }
  }

  const savedTracks = await spotify.getSavedTracks(config.savedTracksLimit, config.market);
  for (const item of savedTracks) {
    mergeCandidate(candidates, item.track, "saved", { saved: true });
  }

  for (const [timeRange, weight] of [
    ["short_term", 1],
    ["medium_term", 0.75]
  ]) {
    const topTracks = await spotify.getTopTracks(timeRange, 50);
    topTracks.forEach((track, index) => {
      mergeCandidate(candidates, track, `top_${timeRange}`, {
        topScore: weight * (1 - index / Math.max(1, topTracks.length))
      });
    });
  }

  for (const [timeRange, weight] of [
    ["short_term", 1],
    ["medium_term", 0.75]
  ]) {
    const topArtists = await spotify.getTopArtists(timeRange, 50);
    for (const artist of topArtists) {
      for (const candidate of candidates.values()) {
        if (candidate.primaryArtistSpotifyId === artist.id) {
          candidate.topArtistScore = Math.max(candidate.topArtistScore, weight);
        }
      }
    }
  }

  for (const scenario of scenarios) {
    for (const query of scenario.searchQueries.slice(0, config.searchQueriesPerScenario)) {
      const tracks = await spotify.searchTracks(query, config.searchLimitPerQuery, config.market);
      for (const track of tracks) {
        mergeCandidate(candidates, track, "search", { scenarioId: scenario.id });
      }
    }
  }

  for (const candidate of candidates.values()) {
    candidate.isExploration =
      candidate.sourceSet.has("search") &&
      !candidate.sourceSet.has("saved") &&
      !candidate.sourceSet.has("recent") &&
      ![...candidate.sourceSet].some((source) => source.startsWith("top_"));
  }

  return {
    candidates: [...candidates.values()],
    recentItems
  };
}

async function enrichAndPersistCatalog(db, spotify, candidates, config) {
  const artistIds = unique(candidates.flatMap((candidate) =>
    candidate.artists.map((artist) => artist.spotifyArtistId)
  ));
  const artistDetails = [];

  try {
    for (const batch of chunk(artistIds, 50)) {
      artistDetails.push(...await spotify.getSeveralArtists(batch));
    }
  } catch (error) {
    console.warn(`Artist details unavailable; continuing with track artist data. ${error.message}`);
  }

  const artistDetailsById = new Map(artistDetails.map((artist) => [artist.id, artist]));
  const artistNamesById = new Map();
  for (const candidate of candidates) {
    for (const artist of candidate.artists) {
      if (!artistNamesById.has(artist.spotifyArtistId)) {
        artistNamesById.set(artist.spotifyArtistId, artist.name);
      }
    }
  }
  const artistRows = artistIds.map((artistId) => {
    const details = artistDetailsById.get(artistId);
    return {
      spotify_artist_id: artistId,
      name: details?.name ?? artistNamesById.get(artistId) ?? "Unknown artist",
      genres: details?.genres ?? [],
      popularity: details?.popularity ?? null,
      image_url: details?.images?.[0]?.url ?? null,
      updated_at: new Date().toISOString()
    };
  });
  const persistedArtists = await db.upsert("artists", artistRows, "spotify_artist_id");
  const artistDbBySpotifyId = new Map(
    persistedArtists.map((artist) => [artist.spotify_artist_id, artist.id])
  );

  if (config.enableAudioFeatures) {
    try {
      const audioFeatureRows = [];
      for (const batch of chunk(candidates.map((candidate) => candidate.spotifyTrackId), 100)) {
        audioFeatureRows.push(...await spotify.getSeveralAudioFeatures(batch));
      }

      const featuresById = new Map(audioFeatureRows.map((features) => [features.id, features]));
      for (const candidate of candidates) {
        const features = featuresById.get(candidate.spotifyTrackId);
        if (!features) continue;
        candidate.tempo = features.tempo ?? null;
        candidate.energy = features.energy ?? null;
        candidate.valence = features.valence ?? null;
        candidate.danceability = features.danceability ?? null;
        candidate.acousticness = features.acousticness ?? null;
        candidate.instrumentalness = features.instrumentalness ?? null;
        candidate.speechiness = features.speechiness ?? null;
      }
    } catch (error) {
      console.warn(`Audio features unavailable; continuing without them. ${error.message}`);
    }
  }

  for (const candidate of candidates) {
    candidate.primaryArtistDbId = artistDbBySpotifyId.get(candidate.primaryArtistSpotifyId) ?? null;
    candidate.genres = unique(candidate.artists.flatMap((artist) =>
      artistDetailsById.get(artist.spotifyArtistId)?.genres ?? []
    ));
    candidate.language = inferLanguage(candidate);
  }

  const persistedTracks = await db.upsert(
    "tracks",
    candidates.map(candidateToTrackRow),
    "spotify_track_id"
  );
  const trackDbBySpotifyId = new Map(
    persistedTracks.map((track) => [track.spotify_track_id, track.id])
  );

  for (const candidate of candidates) {
    candidate.dbTrackId = trackDbBySpotifyId.get(candidate.spotifyTrackId);
  }
}

async function syncListeningEvents(db, userId, recentItems) {
  const rows = recentItems
    .filter((item) => item.candidate.dbTrackId && item.playedAt)
    .map((item) => ({
      user_id: userId,
      track_id: item.candidate.dbTrackId,
      played_at: item.playedAt,
      play_duration_ms: null,
      track_duration_ms: item.candidate.durationMs,
      skipped: false,
      saved: item.candidate.saved,
      liked: item.candidate.saved,
      repeated: item.candidate.recentPlayCount > 1,
      removed_from_playlist: false,
      source: "spotify_recently_played",
      raw_payload: {
        spotify_track_id: item.candidate.spotifyTrackId,
        context: item.raw.context ?? null
      }
    }));

  await db.upsert(
    "listening_events",
    rows,
    "user_id,track_id,played_at,source",
    { returning: "minimal" }
  );
}

async function upsertPreferences(db, userId, candidates) {
  const scores = new Map();

  function add(type, key, amount) {
    if (!key || !Number.isFinite(amount) || amount <= 0) return;
    const normalizedKey = String(key).toLowerCase();
    const mapKey = `${type}:${normalizedKey}`;
    const current = scores.get(mapKey) ?? { type, key: normalizedKey, score: 0, count: 0 };
    current.score += amount;
    current.count += 1;
    scores.set(mapKey, current);
  }

  for (const candidate of candidates) {
    const base =
      (candidate.saved ? 1.4 : 0) +
      candidate.topScore * 1.1 +
      Math.min(candidate.recentPlayCount, 4) * 0.25;

    add("track", candidate.spotifyTrackId, base);
    add("artist", candidate.primaryArtistSpotifyId, base * 0.8);
    for (const genre of candidate.genres) {
      add("genre", genre, base * 0.45);
    }
  }

  const rows = [...scores.values()].map((item) => ({
    user_id: userId,
    entity_type: item.type,
    entity_key: item.key,
    score: Math.min(10, item.score),
    positive_count: item.count,
    negative_count: 0,
    last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  await db.upsert("user_preferences", rows, "user_id,entity_type,entity_key", {
    returning: "minimal"
  });
}

async function loadPreferenceMap(db, userId) {
  const rows = await db.select("user_preferences", {
    select: "entity_type,entity_key,score,positive_count,negative_count",
    user_id: eq(userId)
  });

  return new Map(rows.map((row) => [`${row.entity_type}:${String(row.entity_key).toLowerCase()}`, row]));
}

async function loadRecentRecommendationMap(db, userId, now) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.select("recommendation_history", {
    select: "track_id,recommended_at,cooldown_until,scenario,score",
    user_id: eq(userId),
    recommended_at: gte(since),
    order: "recommended_at.desc"
  });

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.track_id)) {
      map.set(row.track_id, row);
    }
  }
  return map;
}

async function loadEventStats(db, userId, now) {
  const since = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.select("listening_events", {
    select: "track_id,skipped,saved,liked,repeated,removed_from_playlist,played_at",
    user_id: eq(userId),
    played_at: gte(since)
  });

  const map = new Map();
  for (const row of rows) {
    const stats = map.get(row.track_id) ?? {
      skipCount: 0,
      savedCount: 0,
      repeatedCount: 0,
      removedCount: 0
    };
    if (row.skipped) stats.skipCount += 1;
    if (row.saved || row.liked) stats.savedCount += 1;
    if (row.repeated) stats.repeatedCount += 1;
    if (row.removed_from_playlist) stats.removedCount += 1;
    map.set(row.track_id, stats);
  }
  return map;
}

async function upsertUser(db, spotifyUser, targetTrackCount) {
  const [user] = await db.upsert("users", [
    {
      spotify_user_id: spotifyUser.id,
      display_name: spotifyUser.display_name,
      email: spotifyUser.email ?? null,
      country: spotifyUser.country ?? null,
      target_track_count: targetTrackCount,
      updated_at: new Date().toISOString()
    }
  ], "spotify_user_id");

  return user;
}

async function getPlaylistRows(db, userId) {
  return db.select("playlists", {
    select: "*",
    user_id: eq(userId)
  });
}

async function observeRemovedTracks(db, spotify, userId, playlistRow, now) {
  if (!playlistRow.spotify_playlist_id || !playlistRow.last_generated_for_date) return;

  const currentItems = await spotify.getPlaylistItems(playlistRow.spotify_playlist_id, 100);
  const currentTrackIds = new Set(
    currentItems.map((item) => item.track?.id).filter(Boolean)
  );

  const previousRows = await db.select("playlist_tracks", {
    select: "playlist_id,generation_date,track_id,spotify_track_id,user_feedback,removed_at",
    playlist_id: eq(playlistRow.id),
    generation_date: eq(playlistRow.last_generated_for_date)
  });

  const removedRows = previousRows.filter((row) =>
    row.spotify_track_id && !currentTrackIds.has(row.spotify_track_id) && !row.removed_at
  );

  if (!currentTrackIds.size && previousRows.length) {
    console.warn(`Could not read current playlist items for ${playlistRow.scenario}; skipping removal observation.`);
    return;
  }

  for (const row of removedRows) {
    await db.update(
      "playlist_tracks",
      {
        user_feedback: "removed",
        removed_at: now.toISOString()
      },
      {
        playlist_id: eq(row.playlist_id),
        generation_date: eq(row.generation_date),
        track_id: eq(row.track_id)
      },
      { returning: "minimal" }
    );
  }

  await db.upsert(
    "listening_events",
    removedRows.map((row) => ({
      user_id: userId,
      track_id: row.track_id,
      played_at: now.toISOString(),
      skipped: false,
      saved: false,
      liked: false,
      repeated: false,
      removed_from_playlist: true,
      source: "spotify_playlist_observer",
      raw_payload: {
        scenario: playlistRow.scenario,
        spotify_track_id: row.spotify_track_id
      }
    })),
    "user_id,track_id,played_at,source",
    { returning: "minimal" }
  );

  if (removedRows.length) {
    console.log(`Observed ${removedRows.length} removed tracks from ${playlistRow.scenario}.`);
  }
}

async function getOrCreatePlaylist(db, spotify, user, spotifyUserId, scenario, playlistName, config) {
  const existingRows = await db.select("playlists", {
    select: "*",
    user_id: eq(user.id),
    scenario: eq(scenario.id)
  });
  let playlistRow = existingRows[0];

  if (!playlistRow?.spotify_playlist_id) {
    const playlist = await spotify.createPlaylist(spotifyUserId, {
      name: playlistName,
      public: config.playlistPublic,
      collaborative: false,
      description: `每天 Montreal 时间 6:00 自动更新：${scenario.displayName}`
    });

    [playlistRow] = await db.upsert("playlists", [
      {
        user_id: user.id,
        spotify_playlist_id: playlist.id,
        spotify_snapshot_id: playlist.snapshot_id ?? null,
        scenario: scenario.id,
        name: playlistName,
        target_track_count: config.targetTrackCount,
        status: "active",
        updated_at: new Date().toISOString()
      }
    ], "user_id,scenario");
  }

  return playlistRow;
}

async function writeGeneration(db, playlistRow, selected, scenario, localDateKey, now) {
  const playlistTrackRows = selected.map((selection, index) => ({
    playlist_id: playlistRow.id,
    generation_date: localDateKey,
    track_id: selection.candidate.dbTrackId,
    spotify_track_id: selection.candidate.spotifyTrackId,
    position: index + 1,
    score: Number(selection.adjustedScore.toFixed(6)),
    score_breakdown: selection.breakdown,
    is_exploration: selection.candidate.isExploration,
    user_feedback: null,
    removed_at: null,
    created_at: now.toISOString()
  }));

  await db.upsert(
    "playlist_tracks",
    playlistTrackRows,
    "playlist_id,generation_date,track_id",
    { returning: "minimal" }
  );

  const historyRows = selected.map((selection) => ({
    user_id: playlistRow.user_id,
    playlist_id: playlistRow.id,
    track_id: selection.candidate.dbTrackId,
    scenario: scenario.id,
    recommended_at: now.toISOString(),
    cooldown_until: cooldownUntilForSelection(selection, now).toISOString(),
    score: Number(selection.adjustedScore.toFixed(6)),
    selected: true
  }));

  await db.insert("recommendation_history", historyRows, { returning: "minimal" });
}

function loadRuntimeConfig() {
  const scenarioIds = (process.env.SCENARIOS ?? DEFAULT_SCENARIO_IDS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const scenarios = scenarioIds.map((id) => {
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`Unknown scenario id: ${id}`);
    return scenario;
  });

  return {
    scenarios,
    timezone: readEnv("AUTOMATION_TIMEZONE", { required: false, defaultValue: "America/Toronto" }),
    runLocalHour: readNumberEnv("RUN_LOCAL_HOUR", 6),
    targetTrackCount: readNumberEnv("TARGET_TRACK_COUNT", 30),
    market: readEnv("DEFAULT_MARKET", { required: false, defaultValue: "CA" }),
    playlistPublic: readBooleanEnv("PLAYLIST_PUBLIC", false),
    forceRun: readBooleanEnv("FORCE_RUN", false),
    savedTracksLimit: readNumberEnv("SAVED_TRACKS_LIMIT", 150),
    searchQueriesPerScenario: readNumberEnv("SEARCH_QUERIES_PER_SCENARIO", 5),
    searchLimitPerQuery: readNumberEnv("SEARCH_LIMIT_PER_QUERY", 10),
    enableAudioFeatures: readBooleanEnv("ENABLE_SPOTIFY_AUDIO_FEATURES", false)
  };
}

async function main() {
  const config = loadRuntimeConfig();
  const now = new Date();
  const localDateKey = getLocalDateKey(now, config.timezone);
  const datePrefix = getDatePrefix(now, config.timezone);

  const localParts = getZonedParts(now, config.timezone);

  if (!config.forceRun && localParts.hour < config.runLocalHour) {
    console.log(`Before ${config.runLocalHour}:00 in ${config.timezone}; skipping.`);
    return;
  }

  const db = createSupabaseClientFromEnv();
  const accessToken = await refreshAccessToken({
    clientId: readEnv("SPOTIFY_CLIENT_ID"),
    clientSecret: readEnv("SPOTIFY_CLIENT_SECRET"),
    refreshToken: readEnv("SPOTIFY_REFRESH_TOKEN")
  });
  const spotify = new SpotifyClient(accessToken);
  const spotifyUser = await spotify.getMe();
  const user = await upsertUser(db, spotifyUser, config.targetTrackCount);
  const existingPlaylists = await getPlaylistRows(db, user.id);

  if (!config.forceRun) {
    const generatedToday = new Set(
      existingPlaylists
        .filter((playlist) => playlist.last_generated_for_date === localDateKey)
        .map((playlist) => playlist.scenario)
    );

    if (config.scenarios.every((scenario) => generatedToday.has(scenario.id))) {
      console.log(`All configured scenarios already generated for ${localDateKey}; skipping.`);
      return;
    }
  }

  console.log(`Generating ${localDateKey} playlists for ${spotifyUser.display_name ?? spotifyUser.id}.`);

  const { candidates, recentItems } = await collectCandidates(spotify, config.scenarios, config);
  await enrichAndPersistCatalog(db, spotify, candidates, config);
  await syncListeningEvents(db, user.id, recentItems);
  await upsertPreferences(db, user.id, candidates);

  for (const playlistRow of existingPlaylists) {
    await observeRemovedTracks(db, spotify, user.id, playlistRow, now);
  }

  const preferences = await loadPreferenceMap(db, user.id);
  const recencyByTrackId = await loadRecentRecommendationMap(db, user.id, now);
  const eventStatsByTrackId = await loadEventStats(db, user.id, now);

  for (const scenario of config.scenarios) {
    const playlistName = `${datePrefix}${scenario.playlistSuffix}`;
    const playlistRow = await getOrCreatePlaylist(
      db,
      spotify,
      user,
      spotifyUser.id,
      scenario,
      playlistName,
      config
    );

    if (!config.forceRun && playlistRow.last_generated_for_date === localDateKey) {
      console.log(`${scenario.id} already generated for ${localDateKey}; skipping.`);
      continue;
    }

    const scopedCandidates = candidates.filter((candidate) =>
      candidate.dbTrackId &&
      (
        !candidate.searchScenarioIds.size ||
        candidate.searchScenarioIds.has(scenario.id) ||
        !candidate.isExploration
      )
    );

    const scored = scopedCandidates.map((candidate) =>
      scoreCandidate(candidate, {
        scenario,
        preferences,
        recencyByTrackId,
        eventStatsByTrackId,
        now
      })
    );
    const selected = selectTracks(scored, scenario, config.targetTrackCount);

    if (!selected.length) {
      throw new Error(`No tracks selected for scenario ${scenario.id}.`);
    }

    await spotify.updatePlaylistDetails(playlistRow.spotify_playlist_id, {
      name: playlistName,
      public: config.playlistPublic,
      collaborative: false,
      description: `每天 Montreal 时间 6:00 自动更新。场景：${scenario.displayName}。生成日期：${localDateKey}。`
    });
    const snapshot = await spotify.replacePlaylistItems(
      playlistRow.spotify_playlist_id,
      selected.map((selection) => selection.candidate.uri)
    );

    await writeGeneration(db, playlistRow, selected, scenario, localDateKey, now);
    await db.update(
      "playlists",
      {
        name: playlistName,
        spotify_snapshot_id: snapshot?.snapshot_id ?? null,
        last_generated_for_date: localDateKey,
        last_generated_at: now.toISOString(),
        status: "active",
        updated_at: now.toISOString()
      },
      { id: eq(playlistRow.id) },
      { returning: "minimal" }
    );

    console.log(
      `${playlistName}: selected ${selected.length} tracks, ${
        selected.filter((item) => item.candidate.isExploration).length
      } exploration tracks.`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
