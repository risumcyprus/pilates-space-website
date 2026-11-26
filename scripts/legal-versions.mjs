// Computes the version and "updated" date of each legal document from Git and
// writes lib/legal-versions.generated.json (read by lib/legal.ts at build time).
// Runs automatically before `npm run build` and `npm run dev`.
//
// A document is content/legal/<slug>.en.md + <slug>.ru.md; a commit changes the
// document if it changes either file.
// - Version on master: number of first-parent commits that changed the document
//   (a merge commit is compared with its first parent, so one merged PR = one version).
// - Version on any other branch / deploy preview: master's number, plus 1 if this
//   branch changes the document compared with master (the version it will get on merge).
// - Date: committer date of the latest first-parent commit on the current branch that
//   changed the document, as a calendar date in Europe/Nicosia.
// Never falls back to today's date or a guessed number: missing history fails the build.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SLUGS = ["terms", "privacy", "waiver", "informed-consent", "marketing-consent"];
const LEGAL_DIR = "content/legal";
const OUT_FILE = path.join("lib", "legal-versions.generated.json");
const MASTER_REFS = ["refs/remotes/origin/master", "refs/heads/master"];

function fail(message) {
  console.error(`[legal-versions] ERROR: ${message}`);
  console.error("[legal-versions] Legal page versions are computed from Git history; the build cannot continue without it.");
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitError(error) {
  return (error.stderr?.toString() || error.message).trim();
}

function findMasterRef() {
  for (const ref of MASTER_REFS) {
    try {
      git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
      return ref;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** slug -> committer dates (ISO, newest first) of first-parent commits from `ref` that changed it */
function documentChanges(ref) {
  const out = git(
    "log",
    "--first-parent",
    "--diff-merges=first-parent",
    "--name-only",
    "--format=@%H%x09%cI",
    ref,
    "--",
    LEGAL_DIR,
  );
  const changes = Object.fromEntries(SLUGS.map((slug) => [slug, []]));
  let commit = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@")) {
      const [hash, date] = line.slice(1).split("\t");
      commit = { hash, date, slugs: new Set() };
      continue;
    }
    const match = line.match(/^content\/legal\/(.+)\.(en|ru)\.md$/);
    if (!commit || !match || !(match[1] in changes) || commit.slugs.has(match[1])) continue;
    commit.slugs.add(match[1]);
    changes[match[1]].push(commit.date);
  }
  return changes;
}

function nicosiaDate(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Nicosia", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 1. A full Git history must be available.
try {
  if (git("rev-parse", "--is-inside-work-tree") !== "true") throw new Error("not inside a work tree");
} catch (error) {
  fail(`not a Git repository (${gitError(error)}).`);
}

const shallow = git("rev-parse", "--is-shallow-repository") === "true";
if (shallow) {
  fail("the repository is a shallow clone, so commit counts would be wrong. A full clone is required.");
}

// 2. Find master; fetch it if this clone does not have it (the repository is public).
let masterRef = findMasterRef();
if (!masterRef) {
  console.log("[legal-versions] master ref missing, fetching origin/master");
  try {
    git("fetch", "--filter=blob:none", "origin", "+refs/heads/master:refs/remotes/origin/master");
  } catch (error) {
    fail(`no master branch in this clone and \`git fetch origin master\` failed:\n${gitError(error)}`);
  }
  masterRef = findMasterRef();
  if (!masterRef) fail(`master branch not found (looked for ${MASTER_REFS.join(", ")}), even after fetching origin.`);
  console.log(`[legal-versions] fetched ${masterRef}`);
}

// 3. Which branch is being built? Netlify sets BRANCH; HEAD is often detached there.
let branch = process.env.BRANCH || "";
if (!branch) {
  try {
    branch = git("symbolic-ref", "--short", "HEAD");
  } catch {
    branch = "";
  }
}
const onMaster = branch === "master";

const headChanges = documentChanges("HEAD");
const masterChanges = onMaster ? headChanges : documentChanges(masterRef);

function branchChangesDocument(slug) {
  try {
    git("diff", "--quiet", `${masterRef}...HEAD`, "--", `${LEGAL_DIR}/${slug}.en.md`, `${LEGAL_DIR}/${slug}.ru.md`);
    return false;
  } catch (error) {
    if (error.status === 1) return true;
    fail(`could not compare this branch with ${masterRef}:\n${gitError(error)}`);
  }
}

// 4. Version and date per document.
const result = {};
for (const slug of SLUGS) {
  const version = masterChanges[slug].length + (onMaster ? 0 : branchChangesDocument(slug) ? 1 : 0);
  const latest = headChanges[slug][0];
  if (version < 1 || !latest) {
    fail(`no commit found that adds ${LEGAL_DIR}/${slug}.en.md / .ru.md on this branch. Commit the document first.`);
  }
  result[slug] = { version, date: nicosiaDate(latest) };
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`);

console.log(
  "Legal versions from Git: " +
  [
    `shallow=${shallow}`,
    `branch=${branch || "(detached)"}`,
    `master=${masterRef.replace(/^refs\/(remotes\/|heads\/)/, "")}`,
    ...SLUGS.map((slug) => `${slug} v${result[slug].version} (${result[slug].date})`),
  ].join(" · "),
);
