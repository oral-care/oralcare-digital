// Stops the em dash (U+2014) anywhere in the repo's text files (plan 14.2).
// Runs in lint-staged with the staged files, and in CI over every tracked file.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EM_DASH = String.fromCharCode(0x2014);
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|age)$/i;

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

const offenders = [];
for (const file of files) {
  if (BINARY.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, index) => {
    if (line.includes(EM_DASH)) offenders.push(`${file}:${index + 1}`);
  });
}

if (offenders.length > 0) {
  console.error(`Em dash found (U+2014). Use a comma, a colon or a full stop:\n${offenders.join("\n")}`);
  process.exit(1);
}
