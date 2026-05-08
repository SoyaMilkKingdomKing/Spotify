import { addDays, diffDays } from "./time.mjs";

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function textIncludesAny(text, keywords) {
  const normalized = normalize(text);
  return keywords.some((keyword) => normalized.includes(normalize(keyword)));
}

function keywordMatchScore(candidate, scenario) {
  const text = [
    candidate.name,
    candidate.albumName,
    candidate.primaryArtistName,
    candidate.genres.join(" ")
  ].join(" ");

  const positiveMatches = scenario.positiveKeywords.filter((keyword) =>
    normalize(text).includes(normalize(keyword))
  ).length;
  const hasNegative = textIncludesAny(text, scenario.negativeKeywords ?? []);

  return clamp01((positiveMatches / Math.max(3, scenario.positiveKeywords.length / 4)) - (hasNegative ? 0.35 : 0));
}

function audioMatchScore(candidate, scenario) {
  const target = scenario.targetAudio ?? {};
  const available = ["energy", "valence", "danceability"].filter(
    (key) => candidate[key] !== null && candidate[key] !== undefined && target[key] !== undefined
  );

  let score = 0;
  if (available.length) {
    const distance = available.reduce((sum, key) => sum + Math.abs(candidate[key] - target[key]), 0);
    score += clamp01(1 - distance / available.length);
  }

  if (candidate.tempo && target.tempoMin && target.tempoMax) {
    const midpoint = (target.tempoMin + target.tempoMax) / 2;
    const halfRange = (target.tempoMax - target.tempoMin) / 2;
    score += clamp01(1 - Math.abs(candidate.tempo - midpoint) / Math.max(halfRange, 1));
  }

  return available.length || candidate.tempo ? clamp01(score / (candidate.tempo ? 2 : 1)) : null;
}

function genreMatchScore(candidate, scenario) {
  if (!scenario.preferredGenres?.length) return 0.5;

  const genreText = normalize(candidate.genres.join(" "));
  const matches = scenario.preferredGenres.filter((genre) => genreText.includes(normalize(genre)));
  return clamp01(matches.length / Math.min(3, scenario.preferredGenres.length));
}

function preferenceScore(preferences, type, key) {
  const row = preferences.get(`${type}:${normalize(key)}`);
  if (!row) return 0;
  return clamp01(Number(row.score ?? 0) / 5);
}

function recentRecommendationPenalty(candidate, recencyByTrackId, now) {
  const latest = recencyByTrackId.get(candidate.dbTrackId);
  if (!latest) {
    return { penalty: 0, freshnessScore: 1, blockedReason: null };
  }

  if (latest.cooldown_until && new Date(latest.cooldown_until) > now) {
    return { penalty: 1, freshnessScore: 0, blockedReason: "cooldown" };
  }

  const daysSince = diffDays(now, new Date(latest.recommended_at));
  const highPreference = candidate.saved || candidate.recentPlayCount >= 2 || candidate.topScore >= 0.75;

  if (daysSince < 1.7) {
    return { penalty: 1, freshnessScore: 0, blockedReason: "recommended_too_recently" };
  }

  if (daysSince < 3) {
    return {
      penalty: highPreference ? 0.08 : 0.28,
      freshnessScore: highPreference ? 0.55 : 0.25,
      blockedReason: null
    };
  }

  if (daysSince < 5) {
    return { penalty: highPreference ? 0.03 : 0.14, freshnessScore: 0.55, blockedReason: null };
  }

  if (daysSince < 10) {
    return { penalty: 0.05, freshnessScore: 0.75, blockedReason: null };
  }

  return { penalty: 0, freshnessScore: 0.9, blockedReason: null };
}

function eventPenalty(candidate, eventStatsByTrackId) {
  const stats = eventStatsByTrackId.get(candidate.dbTrackId) ?? {};
  return {
    skipPenalty: clamp01((stats.skipCount ?? 0) * 0.18),
    removedPenalty: clamp01((stats.removedCount ?? 0) * 0.32)
  };
}

function similarityPenalty(candidate, selected) {
  let penalty = 0;

  for (const item of selected) {
    const other = item.candidate;
    let localPenalty = 0;

    if (candidate.primaryArtistSpotifyId === other.primaryArtistSpotifyId) {
      localPenalty += 0.1;
    }

    if (candidate.albumSpotifyId && candidate.albumSpotifyId === other.albumSpotifyId) {
      localPenalty += 0.12;
    }

    const sharedGenres = candidate.genres.filter((genre) => other.genres.includes(genre)).length;
    if (sharedGenres >= 2) {
      localPenalty += 0.05;
    }

    const audioKeys = ["energy", "valence", "danceability"].filter(
      (key) => candidate[key] !== null && candidate[key] !== undefined && other[key] !== null && other[key] !== undefined
    );
    if (audioKeys.length) {
      const distance = audioKeys.reduce((sum, key) => sum + Math.abs(candidate[key] - other[key]), 0);
      localPenalty += clamp01(1 - distance / audioKeys.length) * 0.06;
    }

    penalty = Math.max(penalty, localPenalty);
  }

  return clamp01(penalty);
}

export function scoreCandidate(candidate, context) {
  const { scenario, preferences, recencyByTrackId, eventStatsByTrackId, now } = context;
  const trackPreference = preferenceScore(preferences, "track", candidate.spotifyTrackId);
  const artistPreference = preferenceScore(preferences, "artist", candidate.primaryArtistSpotifyId);
  const genrePreference = Math.max(
    0,
    ...candidate.genres.map((genre) => preferenceScore(preferences, "genre", genre))
  );

  const userTrackAffinity = clamp01(
    trackPreference * 0.45 +
      candidate.topScore * 0.25 +
      (candidate.saved ? 0.25 : 0) +
      Math.min(candidate.recentPlayCount, 4) * 0.08
  );
  const audioMood = audioMatchScore(candidate, scenario);
  const moodMatch = audioMood === null
    ? keywordMatchScore(candidate, scenario)
    : clamp01(audioMood * 0.7 + keywordMatchScore(candidate, scenario) * 0.3);
  const genreMatch = clamp01(genreMatchScore(candidate, scenario) * 0.75 + genrePreference * 0.25);
  const artistAffinity = clamp01(artistPreference * 0.7 + candidate.topArtistScore * 0.3);
  const savedBoost = candidate.saved ? 1 : 0;
  const repeatBoost = clamp01((candidate.recentPlayCount - 1) / 3);
  const discoveryScore = candidate.isExploration ? 1 : 0;
  const recency = recentRecommendationPenalty(candidate, recencyByTrackId, now);
  const penalties = eventPenalty(candidate, eventStatsByTrackId);

  if (recency.blockedReason) {
    return {
      candidate,
      eligible: false,
      blockedReason: recency.blockedReason,
      baseScore: 0,
      adjustedScore: 0,
      breakdown: { recency, penalties }
    };
  }

  const baseScore =
    0.22 * userTrackAffinity +
    0.18 * moodMatch +
    0.14 * genreMatch +
    0.12 * artistAffinity +
    0.08 * savedBoost +
    0.08 * repeatBoost +
    0.06 * recency.freshnessScore +
    0.04 * discoveryScore -
    recency.penalty -
    penalties.skipPenalty -
    penalties.removedPenalty;

  return {
    candidate,
    eligible: baseScore > 0,
    blockedReason: baseScore > 0 ? null : "low_score",
    baseScore,
    adjustedScore: baseScore,
    breakdown: {
      userTrackAffinity,
      moodMatch,
      genreMatch,
      artistAffinity,
      savedBoost,
      repeatBoost,
      freshnessScore: recency.freshnessScore,
      discoveryScore,
      recentRecommendationPenalty: recency.penalty,
      skipPenalty: penalties.skipPenalty,
      removedPenalty: penalties.removedPenalty
    }
  };
}

export function selectTracks(scoredCandidates, scenario, targetTrackCount) {
  const selected = [];
  const selectedIds = new Set();
  const artistCounts = new Map();
  const eligible = scoredCandidates
    .filter((item) => item.eligible)
    .sort((a, b) => b.baseScore - a.baseScore);
  const explorationTarget = Math.round(targetTrackCount * scenario.explorationRatio);

  while (selected.length < targetTrackCount && selectedIds.size < eligible.length) {
    const remainingSlots = targetTrackCount - selected.length;
    const selectedExploration = selected.filter((item) => item.candidate.isExploration).length;
    const explorationNeeded = Math.max(0, explorationTarget - selectedExploration);
    const mustPickExploration = explorationNeeded >= remainingSlots;

    let best = null;

    for (const item of eligible) {
      const candidate = item.candidate;
      if (selectedIds.has(candidate.spotifyTrackId)) continue;
      if (mustPickExploration && !candidate.isExploration) continue;

      const artistCount = artistCounts.get(candidate.primaryArtistSpotifyId) ?? 0;
      if (artistCount >= scenario.artistCap) continue;

      const diversityPenalty = similarityPenalty(candidate, selected);
      const quotaBoost =
        !mustPickExploration && candidate.isExploration && selectedExploration < explorationTarget
          ? 0.05
          : 0;
      const adjustedScore = item.baseScore - diversityPenalty + quotaBoost;

      if (!best || adjustedScore > best.adjustedScore) {
        best = {
          ...item,
          adjustedScore,
          breakdown: {
            ...item.breakdown,
            similarityPenalty: diversityPenalty,
            explorationQuotaBoost: quotaBoost
          }
        };
      }
    }

    if (!best && mustPickExploration) {
      for (const item of eligible) {
        const candidate = item.candidate;
        if (selectedIds.has(candidate.spotifyTrackId)) continue;
        const artistCount = artistCounts.get(candidate.primaryArtistSpotifyId) ?? 0;
        if (artistCount >= scenario.artistCap) continue;
        best = item;
        break;
      }
    }

    if (!best) break;

    selected.push(best);
    selectedIds.add(best.candidate.spotifyTrackId);
    artistCounts.set(
      best.candidate.primaryArtistSpotifyId,
      (artistCounts.get(best.candidate.primaryArtistSpotifyId) ?? 0) + 1
    );
  }

  return selected;
}

export function cooldownUntilForSelection(selection, now) {
  const candidate = selection.candidate;
  const highPreference =
    candidate.saved ||
    candidate.recentPlayCount >= 2 ||
    selection.breakdown.userTrackAffinity >= 0.7 ||
    selection.adjustedScore >= 0.55;

  if (highPreference) return addDays(now, 2);
  if (candidate.isExploration) return addDays(now, 6);
  return addDays(now, 4);
}
