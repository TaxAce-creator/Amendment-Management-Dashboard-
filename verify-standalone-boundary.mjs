import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const scanRoots = ["client", "server", "shared", "scripts"];
const rootFiles = ["package.json", "vite.config.ts", "drizzle.config.ts", "Dockerfile", "compose.yaml"];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".html", ".css", ".yaml", ".yml"]);

const forbidden = [
  { label: "Manus runtime plugin", pattern: /vite-plugin-manus-runtime/i },
  { label: "Manus hosted storage path", pattern: /manus-storage/i },
  { label: "Manus injected runtime path", pattern: /__manus__/i },
  { label: "Manus OAuth implementation", pattern: /manus[^\n]{0,40}oauth|oauth[^\n]{0,40}manus/i },
  { label: "Forge runtime integration", pattern: /forgeapi|forge[_-](?:llm|image|voice|data|map|notification)/i },
  { label: "Google Fonts runtime", pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i },
];

const ignoredPaths = new Set([
  "scripts/verify-standalone-boundary.mjs",
]);

function collect(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    if (["node_modules", "dist", ".git"].includes(entry)) continue;
    files.push(...collect(join(path, entry)));
  }
  return files;
}

const files = [...scanRoots.flatMap(collect), ...rootFiles.flatMap(collect)].filter(file => textExtensions.has(extname(file)) || rootFiles.some(item => resolve(root, item) === file));
const violations = [];

for (const file of files) {
  const repoPath = relative(root, file).replaceAll("\\", "/");
  if (ignoredPaths.has(repoPath)) continue;
  const content = readFileSync(file, "utf8");
  for (const check of forbidden) {
    if (check.pattern.test(content)) violations.push(`${repoPath}: ${check.label}`);
  }
}

const rootEntries = readdirSync(root);
for (const entry of rootEntries) {
  if (/^CanopyTasks_.*\.(csv|xlsx)$/i.test(entry)) violations.push(`${entry}: real Canopy export must not be committed`);
}

if (violations.length) {
  console.error("Standalone boundary audit failed:\n- " + violations.join("\n- "));
  process.exit(1);
}

console.log(`PASS: standalone boundary audit scanned ${files.length} source/config files with no forbidden runtime coupling.`);
