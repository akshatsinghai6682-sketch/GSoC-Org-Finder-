const fs = require('fs');
const path = require('path');

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const MENTORS_FILE = path.join(
  process.cwd(),
  '.github',
  'reviewers',
  'gssoc-mentors.json'
);

const STATS_FILE = path.join(
  process.cwd(),
  '.github',
  'reviewers',
  'mentor-stats.json'
);

const MAX_OPEN_REVIEWS = 15;

const INACTIVE_PENALTY_DAYS = 14;
const INACTIVE_EXCLUDE_DAYS = 30;

const DEFAULT_COUNT = 2;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function safeReadJSON(file, fallback = {}) {
  try {
    return JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
  } catch (e) {
    return fallback;
  }
}

function daysSince(dateString) {
  if (!dateString) return Infinity;

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return Infinity;
  }

  const now = Date.now();

  return (
    (now - date.getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

function shuffle(array) {
  return [...array].sort(
    () => Math.random() - 0.5
  );
}

// --------------------------------------------------
// LOAD DATA
// --------------------------------------------------

function loadMentors() {
  const mentorsData = safeReadJSON(
    MENTORS_FILE,
    { reviewers: [] }
  );

  return Array.isArray(
    mentorsData.reviewers
  )
    ? mentorsData.reviewers
    : [];
}

function loadStats() {
  return safeReadJSON(
    STATS_FILE,
    {}
  );
}

// --------------------------------------------------
// SCORE CALCULATION
// --------------------------------------------------

function calculateMentorScore(stats = {}) {
  const reviews =
    Number(stats.reviews || 0);

  const approvals =
    Number(stats.approvals || 0);

  const mergedReviews =
    Number(stats.merged_reviews || 0);

  const assignmentApprovals =
    Number(stats.assignment_approvals || 0);

  const reviewQuality =
    Number(stats.review_quality_score || 0);

  let score =
    (reviews * 1) +
    (approvals * 2) +
    (mergedReviews * 3) +
    (assignmentApprovals * 2) +
    (reviewQuality * 4);

  // --------------------------------------------------
  // ACTIVITY DECAY
  // --------------------------------------------------

  const inactiveDays = daysSince(
    stats.last_reviewed_at
  );

  if (
    inactiveDays >
    INACTIVE_EXCLUDE_DAYS
  ) {
    return -1;
  }

  if (
    inactiveDays >
    INACTIVE_PENALTY_DAYS
  ) {
    score *= 0.3;
  }

  return Math.max(
    0,
    Math.round(score)
  );
}

// --------------------------------------------------
// ACTIVE MENTOR SELECTION
// --------------------------------------------------

function selectActiveMentors(options = {}) {
  const {
    count = DEFAULT_COUNT,
    excludeMentors = [],
    excludeUsers = []
  } = options;

  const mentors = loadMentors();
  const stats = loadStats();

  const excluded = new Set([
    ...excludeMentors.map(m =>
      m.toLowerCase()
    ),
    ...excludeUsers.map(m =>
      m.toLowerCase()
    )
  ]);

  const ranked = [];

  for (const mentor of mentors) {
    if (!mentor) continue;

    const login =
      mentor.toLowerCase();

    // --------------------------------------------------
    // EXCLUSIONS
    // --------------------------------------------------

    if (excluded.has(login)) {
      continue;
    }

    const mentorStats =
      stats[mentor] || {};

    // --------------------------------------------------
    // OVERLOAD PROTECTION
    // --------------------------------------------------

    const openReviews =
      Number(
        mentorStats.open_reviews || 0
      );

    if (
      openReviews >=
      MAX_OPEN_REVIEWS
    ) {
      continue;
    }

    // --------------------------------------------------
    // SCORE
    // --------------------------------------------------

    const score =
      calculateMentorScore(
        mentorStats
      );

    // Excluded due to inactivity
    if (score < 0) {
      continue;
    }

    ranked.push({
      login: mentor,
      score,

      reviews:
        mentorStats.reviews || 0,

      approvals:
        mentorStats.approvals || 0,

      merged_reviews:
        mentorStats.merged_reviews || 0,

      assignment_approvals:
        mentorStats.assignment_approvals || 0,

      review_quality_score:
        mentorStats.review_quality_score || 0,

      open_reviews:
        mentorStats.open_reviews || 0,

      last_reviewed_at:
        mentorStats.last_reviewed_at || null
    });
  }

  // --------------------------------------------------
  // SORT BY SCORE
  // --------------------------------------------------

  ranked.sort(
    (a, b) => b.score - a.score
  );

  // --------------------------------------------------
  // LOAD BALANCING
  // --------------------------------------------------

  const topPool = ranked.slice(
    0,
    Math.max(count * 3, 5)
  );

  const randomized =
    shuffle(topPool);

  return randomized
    .slice(0, count)
    .sort(
      (a, b) => b.score - a.score
    );
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
  selectActiveMentors,
  calculateMentorScore
};

// --------------------------------------------------
// CLI MODE
// --------------------------------------------------

if (require.main === module) {
  const mentors =
    selectActiveMentors({
      count: 5
    });

  console.log(
    JSON.stringify(
      mentors,
      null,
      2
    )
  );
}