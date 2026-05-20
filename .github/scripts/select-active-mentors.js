const fs = require('fs');

const mentorsPath = '.github/reviewers/gssoc-mentors.json';
const statsPath = '.github/reviewers/mentor-stats.json';

function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function toNum(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

function daysSince(iso) {
  if (!iso) return 9999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 9999;
  return Math.max(0, (Date.now() - t) / 86400000);
}

const prAuthor = (process.env.PR_AUTHOR || '').toLowerCase();
function parseArrayEnv(name) {
  try {
    const v = JSON.parse(process.env[name] || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const existingRequested = new Set(parseArrayEnv('EXISTING_REQUESTED').map(v => String(v).toLowerCase()));
const existingReviewers = new Set(parseArrayEnv('EXISTING_REVIEWERS').map(v => String(v).toLowerCase()));
const recentPings = new Set(parseArrayEnv('RECENT_MENTOR_PINGS').map(v => String(v).toLowerCase()));
const maxReviewers = Math.max(1, toNum(process.env.MAX_REVIEWERS || 2));

const mentors = (readJsonSafe(mentorsPath, { reviewers: [] }).reviewers || []).filter(Boolean);
const stats = readJsonSafe(statsPath, { mentors: {} }).mentors || {};

const scored = mentors.map((username) => {
  const m = stats[username] || {};
  const recencyDays = daysSince(m.last_reviewed_at);
  const inactivityPenalty = Math.min(40, recencyDays * 0.8);
  const reviewQuality = toNum(m.review_quality_score);
  const merged = toNum(m.merged_reviews);
  const approvals = toNum(m.approvals);
  const assignmentApprovals = toNum(m.assignment_approvals);
  const priorityReviews = toNum(m.priority_reviews);
  const totalReviews = toNum(m.reviews);
  const overloadPenalty = Math.max(0, totalReviews - approvals * 2) * 0.15;

  let score = 0;
  score += Math.min(25, approvals * 1.2);
  score += Math.min(20, merged * 2);
  score += Math.min(25, reviewQuality);
  score += Math.min(10, assignmentApprovals * 1.5);
  score += Math.min(8, priorityReviews * 0.7);
  score += Math.min(8, Math.log2(totalReviews + 1) * 3);
  score -= inactivityPenalty;
  score -= overloadPenalty;

  const lower = username.toLowerCase();
  const disqualified = (
    lower === prAuthor ||
    existingRequested.has(lower) ||
    existingReviewers.has(lower) ||
    recentPings.has(lower) ||
    recencyDays > 60
  );

  return { username, score, recencyDays, disqualified };
});

const selected = scored
  .filter(s => !s.disqualified)
  .sort((a, b) => b.score - a.score || a.recencyDays - b.recencyDays || a.username.localeCompare(b.username))
  .slice(0, maxReviewers)
  .map(s => s.username);

process.stdout.write(JSON.stringify({ selected, candidates: scored.length }));
