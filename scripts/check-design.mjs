// Stops local styling (plan 4.14): colour codes outside the token files,
// Tailwind arbitrary values, style props that set anything but a CSS variable
// from data, extra CSS files and !important.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TOKEN_FILES = new Set([
  "src/styles/oralcare-tokens.css",
  "src/styles/app-tokens.css",
  "src/lib/email/tokens.ts",
]);
const ALLOWED_CSS = new Set([...TOKEN_FILES, "src/app/globals.css"].filter((file) => file.endsWith(".css")));

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/;
const ARBITRARY = /\b[a-z][a-z0-9-]*-\[[^\]]+\]/;
const STYLE_PROP = /style=\{\{([^}]*)\}\}/g;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const problems = [];
for (const file of walk("src")) {
  const relative = file.split(path.sep).join("/");
  if (relative.endsWith(".test.ts")) continue;
  const text = readFileSync(file, "utf8");

  if (relative.endsWith(".css") && !ALLOWED_CSS.has(relative)) problems.push(`${relative}: extra CSS file`);
  if (TOKEN_FILES.has(relative)) continue;

  text.split("\n").forEach((line, index) => {
    const at = `${relative}:${index + 1}`;
    if (COLOUR.test(line)) problems.push(`${at}: colour code outside the token files`);
    if (/\.(tsx|ts)$/.test(relative) && /className|cn\(|cva\(/.test(line) && ARBITRARY.test(line)) {
      problems.push(`${at}: Tailwind arbitrary value`);
    }
    if (line.includes("!important")) problems.push(`${at}: !important`);
    for (const match of line.matchAll(STYLE_PROP)) {
      const body = match[1] ?? "";
      const keys = [...body.matchAll(/(["']?)([\w-]+)\1\s*:/g)].map((m) => m[2]);
      if (keys.some((key) => !key.startsWith("--")))
        problems.push(`${at}: style may only set a CSS variable from data`);
    }
  });
}

if (problems.length > 0) {
  console.error(`Local styling found. Use the design tokens (plan 4.14):\n${problems.join("\n")}`);
  process.exit(1);
}
