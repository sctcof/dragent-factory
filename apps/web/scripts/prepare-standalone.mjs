import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const appRoot = process.cwd();
const nextRoot = join(appRoot, ".next");
const standaloneRoot = join(nextRoot, "standalone", "apps", "web");
const standaloneNextRoot = join(standaloneRoot, ".next");

if (!existsSync(standaloneNextRoot)) {
  process.exit(0);
}

mkdirSync(standaloneNextRoot, { recursive: true });
cpSync(join(nextRoot, "static"), join(standaloneNextRoot, "static"), {
  recursive: true,
  force: true
});

const publicRoot = join(appRoot, "public");
if (existsSync(publicRoot)) {
  cpSync(publicRoot, join(standaloneRoot, "public"), {
    recursive: true,
    force: true
  });
}
