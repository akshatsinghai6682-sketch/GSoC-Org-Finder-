const fs = require('fs');

async function run({ github, context, core }) {
  const pr = context.payload.pull_request;

  if (!pr) {
    core.info('No PR payload found');
    return;
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issue_number = pr.number;

  const body = (pr.body || '').toLowerCase();
  const branch = (pr.head.ref || '').toLowerCase();

  // --------------------------------------------------
  // CONFIG
  // --------------------------------------------------

  const VALID_PROGRAMS = [
    'gssoc',
    'nsoc',
    'general'
  ];

  const PROGRAM_LABELS = {
    gssoc: 'gssoc26',
    nsoc: 'nsoc26',
    general: 'general-contribution'
  };

  const MISSING_LABEL = 'missing-program-classification';
  const INVALID_LABEL = 'invalid-program-classification';

  const MARKER =
    '<!-- program-classification-validator -->';

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  async function safeAddLabels(labels = []) {
    if (!labels.length) return;

    try {
      await github.rest.issues.addLabels({
        owner,
        repo,
        issue_number,
        labels
      });
    } catch (e) {
      core.warning(
        `Failed adding labels: ${e.message}`
      );
    }
  }

  async function safeRemoveLabel(name) {
    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number,
        name
      });
    } catch (e) {
      core.info(`Label ${name} not present`);
    }
  }

  async function upsertStickyComment(content) {
    const comments = await github.paginate(
      github.rest.issues.listComments,
      {
        owner,
        repo,
        issue_number,
        per_page: 100
      }
    );

    const existing = comments.find(c =>
      c.user &&
      c.user.type === 'Bot' &&
      c.body &&
      c.body.includes(MARKER)
    );

    const finalBody =
      `${MARKER}\n${content}`;

    if (
      existing &&
      existing.body.trim() === finalBody.trim()
    ) {
      core.info('Sticky comment already up-to-date');
      return;
    }

    if (existing) {
      await github.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: finalBody
      });

      core.info('Updated sticky comment');
    } else {
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number,
        body: finalBody
      });

      core.info('Created sticky comment');
    }
  }

  // --------------------------------------------------
  // DETECT PROGRAM SOURCES
  // --------------------------------------------------

  const detected = new Set();

  // Body metadata
  if (
    body.includes('program: gssoc') ||
    body.includes('[x] gssoc')
  ) {
    detected.add('gssoc');
  }

  if (
    body.includes('program: nsoc') ||
    body.includes('[x] nsoc')
  ) {
    detected.add('nsoc');
  }

  if (
    body.includes('program: general') ||
    body.includes('[x] general')
  ) {
    detected.add('general');
  }

  // Branch detection
  if (branch.includes('gssoc')) {
    detected.add('gssoc');
  }

  if (branch.includes('nsoc')) {
    detected.add('nsoc');
  }

  // Existing labels
  const labels = (pr.labels || [])
    .map(l => l.name.toLowerCase());

  if (labels.includes('gssoc26')) {
    detected.add('gssoc');
  }

  if (labels.includes('nsoc26')) {
    detected.add('nsoc');
  }

  if (labels.includes('general-contribution')) {
    detected.add('general');
  }

  // --------------------------------------------------
  // LINKED ISSUE DETECTION
  // --------------------------------------------------

  const issueRefs =
    body.match(/#\d+/g) || [];

  for (const ref of issueRefs) {
    const num = parseInt(
      ref.replace('#', ''),
      10
    );

    if (!num || Number.isNaN(num)) continue;

    try {
      const { data: issue } =
        await github.rest.issues.get({
          owner,
          repo,
          issue_number: num
        });

      const issueLabels =
        (issue.labels || [])
          .map(l =>
            typeof l === 'string'
              ? l.toLowerCase()
              : l.name.toLowerCase()
          );

      if (
        issueLabels.includes('gssoc26')
      ) {
        detected.add('gssoc');
      }

      if (
        issueLabels.includes('nsoc26')
      ) {
        detected.add('nsoc');
      }

      if (
        issueLabels.includes(
          'general-contribution'
        )
      ) {
        detected.add('general');
      }

    } catch (e) {
      core.info(
        `Failed fetching issue ${num}`
      );
    }
  }

  // --------------------------------------------------
  // VALIDATION
  // --------------------------------------------------

  const detectedPrograms =
    [...detected].filter(p =>
      VALID_PROGRAMS.includes(p)
    );

  core.info(
    `Detected programs: ${detectedPrograms.join(', ')}`
  );

  // Remove old labels first
  await safeRemoveLabel(MISSING_LABEL);
  await safeRemoveLabel(INVALID_LABEL);

  // --------------------------------------------------
  // MISSING PROGRAM
  // --------------------------------------------------

  if (detectedPrograms.length === 0) {

    await safeAddLabels([
      MISSING_LABEL
    ]);

    await upsertStickyComment(
`## ⚠️ Missing Program Classification

Hi @${pr.user.login} 👋

Your PR could not be classified into a valid contribution program.

Please edit your PR body and select exactly ONE program:

- GSSOC
- NSOC
- General Contribution

### Example

\`\`\`md
Program Type

- [x] GSSOC
- [ ] NSOC
- [ ] General Contribution
\`\`\`

OR

\`\`\`
program: gssoc
\`\`\`

### Why this matters

Program classification powers:

- mentor routing
- contributor tracking
- leaderboard scoring
- review governance
- automation policies

### Current behavior

- Stage-2 routing is temporarily blocked
- Your PR is NOT closed
- You may fix this by editing the PR body

Once corrected, automation will re-validate automatically 🚀`
    );

    core.setFailed(
      'Missing program classification'
    );

    return;
  }

  // --------------------------------------------------
  // MULTIPLE PROGRAMS
  // --------------------------------------------------

  if (detectedPrograms.length > 1) {

    await safeAddLabels([
      INVALID_LABEL
    ]);

    await upsertStickyComment(
`## ⚠️ Invalid Program Classification

Hi @${pr.user.login} 👋

Your PR currently matches MULTIPLE contribution programs:

${detectedPrograms
  .map(p => `- ${p.toUpperCase()}`)
  .join('\n')}

A PR must belong to exactly ONE program.

Please update your PR body/template and keep only one valid classification.

### Allowed options

- GSSOC
- NSOC
- General Contribution

### Current behavior

- mentor/reviewer routing is blocked
- leaderboard scoring is paused
- your PR is NOT closed

After editing the PR body, validation will rerun automatically 🚀`
    );

    core.setFailed(
      'Multiple conflicting program classifications detected'
    );

    return;
  }

  // --------------------------------------------------
  // VALID CLASSIFICATION
  // --------------------------------------------------

  const finalProgram =
    detectedPrograms[0];

  const normalizedLabel =
    PROGRAM_LABELS[finalProgram];

  // Remove all program labels first
  for (const label of Object.values(PROGRAM_LABELS)) {
    if (label !== normalizedLabel) {
      await safeRemoveLabel(label);
    }
  }

  // Add normalized label
  await safeAddLabels([
    normalizedLabel
  ]);

  // Remove validation labels
  await safeRemoveLabel(MISSING_LABEL);
  await safeRemoveLabel(INVALID_LABEL);

  await upsertStickyComment(
`## ✅ Program Classification Verified

Hi @${pr.user.login} 👋

Your PR has been successfully classified as:

# ${finalProgram.toUpperCase()}

### Active Automation

${finalProgram === 'gssoc'
  ? `
- mentor routing enabled
- contributor scoring enabled
- leaderboard tracking enabled
- GSSOC governance active
`
  : finalProgram === 'nsoc'
    ? `
- reviewer routing enabled
- NSOC governance active
- structured review flow enabled
`
    : `
- standard OSS review flow enabled
- general contribution governance active
`
}

Thank you for following contribution guidelines 🚀`
  );

  core.info(
    `Validated program classification: ${finalProgram}`
  );
}

module.exports = run;

// CLI support
if (require.main === module) {
  console.log(
    'validate-program-classification.js loaded successfully'
  );
}