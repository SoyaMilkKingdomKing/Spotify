const SPOTIFY_ACCOUNTS_BASE_URL = "https://accounts.spotify.com";
const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-recently-played",
  "user-top-read",
  "user-library-read",
  "playlist-modify-private",
  "playlist-modify-public"
];

function basicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildSpotifyAuthorizationUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SPOTIFY_SCOPES.join(" "),
    redirect_uri: redirectUri,
    state
  });

  return `${SPOTIFY_ACCOUNTS_BASE_URL}/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Spotify token exchange failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}

export class SpotifyClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  async request(path, options = {}) {
    const response = await fetch(`${SPOTIFY_API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (response.status === 429 && !options._retried) {
      const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "2");
      await sleep(Math.max(1, retryAfterSeconds) * 1000);
      return this.request(path, { ...options, _retried: true });
    }

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(`Spotify ${response.status} ${response.statusText}: ${text}`);
    }

    return payload;
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, { method: "POST", body });
  }

  put(path, body) {
    return this.request(path, { method: "PUT", body });
  }

  getMe() {
    return this.get("/me");
  }

  async getRecentlyPlayed(limit = 50) {
    const params = new URLSearchParams({ limit: String(Math.min(limit, 50)) });
    const payload = await this.get(`/me/player/recently-played?${params.toString()}`);
    return payload.items ?? [];
  }

  async getSavedTracks(limit = 100, market) {
    const items = [];
    let offset = 0;

    while (items.length < limit) {
      const batchLimit = Math.min(50, limit - items.length);
      const params = new URLSearchParams({
        limit: String(batchLimit),
        offset: String(offset)
      });
      if (market) params.set("market", market);

      const payload = await this.get(`/me/tracks?${params.toString()}`);
      items.push(...(payload.items ?? []));
      if (!payload.next || !payload.items?.length) break;
      offset += batchLimit;
    }

    return items;
  }

  async getTopTracks(timeRange = "short_term", limit = 50) {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(Math.min(limit, 50))
    });
    const payload = await this.get(`/me/top/tracks?${params.toString()}`);
    return payload.items ?? [];
  }

  async getTopArtists(timeRange = "short_term", limit = 50) {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(Math.min(limit, 50))
    });
    const payload = await this.get(`/me/top/artists?${params.toString()}`);
    return payload.items ?? [];
  }

  async getSeveralArtists(ids) {
    if (!ids.length) return [];
    const params = new URLSearchParams({ ids: ids.join(",") });
    const payload = await this.get(`/artists?${params.toString()}`);
    return payload.artists?.filter(Boolean) ?? [];
  }

  async getSeveralAudioFeatures(ids) {
    if (!ids.length) return [];
    const params = new URLSearchParams({ ids: ids.join(",") });
    const payload = await this.get(`/audio-features?${params.toString()}`);
    return payload.audio_features?.filter(Boolean) ?? [];
  }

  async searchTracks(query, limit = 20, market) {
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: String(Math.min(limit, 50))
    });
    if (market) params.set("market", market);

    const payload = await this.get(`/search?${params.toString()}`);
    return payload.tracks?.items?.filter(Boolean) ?? [];
  }

  createPlaylist(userId, body) {
    return this.post(`/users/${encodeURIComponent(userId)}/playlists`, body);
  }

  updatePlaylistDetails(playlistId, body) {
    return this.put(`/playlists/${encodeURIComponent(playlistId)}`, body);
  }

  replacePlaylistItems(playlistId, uris) {
    return this.put(`/playlists/${encodeURIComponent(playlistId)}/items`, { uris });
  }

  async getPlaylistItems(playlistId, limit = 100) {
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 100)),
      fields: "items(track(id,uri,name))"
    });
    const payload = await this.get(`/playlists/${encodeURIComponent(playlistId)}/items?${params.toString()}`);
    return payload.items ?? [];
  }
}
