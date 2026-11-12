// Regression: src/mentions.js (composer @-mentions, picked and dropped paths).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const win = {};
new Function("window", readFileSync(new URL("../src/mentions.js", import.meta.url), "utf8"))(win);
const M = win.OMP_MENTIONS;

// Paths read back by omp's own mention pattern (omp 18.18.3, extractFileMentions).
const OMP = /@(?:"([^"]+)"|'([^']+)'|([^\s@]+))/g;
const readBack = s => [...s.matchAll(OMP)].map(m => m[1] ?? m[2] ?? m[3]);

const paths = ["/home/u/a.ts", "/home/u/My Docs/b c.pdf", '/tmp/say "hi"/x.log', "/img/shot.png"];
const out = M.mentionsForPaths(paths);
assert.equal(out, '@/home/u/a.ts @"/home/u/My Docs/b c.pdf" @\'/tmp/say "hi"/x.log\' @/img/shot.png');
assert.deepEqual(readBack(out), paths);
assert.equal(M.mentionsForPaths([]), "");
assert.deepEqual(M.applyMention("ab", { start: 1, end: 1 }, "@x "), { text: "a@x b", caret: 4 });

// Into a draft: set off from a word before it, nothing added after a space
// or at the start, and still what omp reads back.
assert.equal(M.mentionsAt("", 0, ["/a b/c"]), '@"/a b/c" ');
assert.equal(M.mentionsAt("see ", 4, ["/x"]), "@/x ");
assert.equal(M.mentionsAt("see", 3, ["/x", "/y"]), " @/x @/y ");
assert.equal(M.mentionsAt("a\nb", 2, ["/x"]), "@/x ");
const draft = "check";
assert.deepEqual(readBack(draft + M.mentionsAt(draft, draft.length, paths)), paths);
console.log("mentions: all checks passed");
