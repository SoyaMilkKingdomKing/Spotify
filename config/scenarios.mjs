export const SCENARIOS = [
  {
    id: "late_night_drive",
    displayName: "适合深夜开车",
    playlistSuffix: "适合深夜开车歌单",
    artistCap: 5,
    explorationRatio: 0.22,
    preferredGenres: [
      "chill",
      "r&b",
      "synthwave",
      "indie pop",
      "mandopop",
      "cantopop",
      "dream pop",
      "lo-fi",
      "soul"
    ],
    positiveKeywords: [
      "night",
      "drive",
      "road",
      "moon",
      "late",
      "chill",
      "lonely",
      "midnight",
      "深夜",
      "夜",
      "开车",
      "公路",
      "月",
      "凌晨",
      "慢"
    ],
    negativeKeywords: ["kids", "workout", "party", "sleep white noise"],
    targetAudio: {
      energy: 0.45,
      valence: 0.45,
      danceability: 0.55,
      tempoMin: 65,
      tempoMax: 120
    },
    searchQueries: [
      "late night drive",
      "night drive chill",
      "midnight road songs",
      "深夜 开车 华语",
      "夜晚 公路 情歌",
      "chill r&b late night",
      "synthwave night drive",
      "mandopop night drive",
      "cantonese night songs",
      "after dark drive"
    ]
  },
  {
    id: "emo",
    displayName: "emo",
    playlistSuffix: "emo歌单",
    artistCap: 5,
    explorationRatio: 0.18,
    preferredGenres: [
      "sad",
      "emo",
      "indie",
      "indie pop",
      "mandopop",
      "cantopop",
      "r&b",
      "ballad",
      "singer-songwriter"
    ],
    positiveKeywords: [
      "sad",
      "alone",
      "lonely",
      "miss",
      "hurt",
      "tears",
      "cry",
      "heartbreak",
      "emo",
      "孤单",
      "孤独",
      "想你",
      "眼泪",
      "心碎",
      "失眠",
      "遗憾",
      "难过",
      "分手"
    ],
    negativeKeywords: ["party", "workout", "happy dance"],
    targetAudio: {
      energy: 0.35,
      valence: 0.25,
      danceability: 0.45,
      tempoMin: 55,
      tempoMax: 110
    },
    searchQueries: [
      "emo sad songs",
      "heartbreak ballad",
      "sad mandopop",
      "emo 华语",
      "失恋 情歌",
      "sad chinese songs",
      "lonely r&b",
      "breakup pop",
      "melancholy mandopop",
      "sad indie pop"
    ]
  },
  {
    id: "love_songs",
    displayName: "情歌",
    playlistSuffix: "情歌歌单",
    artistCap: 5,
    explorationRatio: 0.16,
    preferredGenres: [
      "pop",
      "mandopop",
      "cantopop",
      "r&b",
      "soul",
      "ballad",
      "singer-songwriter"
    ],
    positiveKeywords: [
      "love",
      "lover",
      "heart",
      "kiss",
      "forever",
      "romance",
      "情歌",
      "爱",
      "喜欢",
      "心动",
      "告白",
      "恋人",
      "温柔",
      "拥抱"
    ],
    negativeKeywords: ["workout", "rage", "metal"],
    targetAudio: {
      energy: 0.48,
      valence: 0.52,
      danceability: 0.5,
      tempoMin: 60,
      tempoMax: 125
    },
    searchQueries: [
      "love songs",
      "romantic pop",
      "r&b love songs",
      "华语 情歌",
      "经典 情歌",
      "mandopop love ballads",
      "cantonese love songs",
      "soft r&b love",
      "classic mandopop love",
      "romantic chinese pop"
    ]
  },
  {
    id: "fast_paced",
    displayName: "快节奏",
    playlistSuffix: "快节奏歌单",
    artistCap: 5,
    explorationRatio: 0.24,
    preferredGenres: [
      "pop",
      "dance",
      "edm",
      "hip hop",
      "rap",
      "electropop",
      "k-pop",
      "mandopop",
      "rock"
    ],
    positiveKeywords: [
      "energy",
      "dance",
      "run",
      "speed",
      "fast",
      "party",
      "power",
      "快",
      "燃",
      "节奏",
      "跑步",
      "派对",
      "热",
      "动感"
    ],
    negativeKeywords: ["sleep", "sad piano", "ambient"],
    targetAudio: {
      energy: 0.78,
      valence: 0.68,
      danceability: 0.72,
      tempoMin: 105,
      tempoMax: 170
    },
    searchQueries: [
      "fast paced pop",
      "high energy songs",
      "dance hits",
      "workout pop",
      "快节奏 华语",
      "upbeat mandopop",
      "party pop hits",
      "edm pop energetic",
      "high bpm rap",
      "running playlist songs"
    ]
  }
];

export const DEFAULT_SCENARIO_IDS = SCENARIOS.map((scenario) => scenario.id);

export function getScenarioById(id) {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
