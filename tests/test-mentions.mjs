// Regression: src/mentions.js (composer @-mentions, dropped paths).
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
console.log("mentions: all checks passed");
