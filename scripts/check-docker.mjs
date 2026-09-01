#!/usr/bin/env node
/**
 * Fails if a Dockerfile has fallen behind the workspace.
 *
 * Both images copy workspace manifests one line at a time, before the source arrives, so that
 * `pnpm install` is cached against dependency changes rather than every edit. The cost of that
 * arrangement is a list that has to be kept in step with the workspace by hand — and when it
 * is not, nothing fails until an image is built. `packages/corpus` was added in one slice and
 * broke both images in the next: `pnpm install` skipped it, `pnpm build` compiled it anyway
 * without its own type definitions, and the whole storefront deploy died on a package it does
 * not even ship.
 *
 * A second failure is worse because it survives the build: a workspace package the API imports
 * at runtime whose compiled output is never copied into the runtime stage. `pnpm install
 * --prod` creates the symlink, the image builds clean, and the container dies on "cannot find
 * module" the first time it starts.
 *
 * Both are checkable here in a few milliseconds, without Docker.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const IMAGES = ['Dockerfile', 'Dockerfile.storefront'];

/** Every package in the workspace, as `{ name, dir, manifest }`. */
function workspacePackages() {
  const packages = [];
  for (const parent of ['apps', 'packages']) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent)) {
      const dir = `${parent}/${entry}`;
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      packages.push({ ...JSON.parse(readFileSync(manifest, 'utf8')), dir });
    }
  }
  return packages;
}

/** Workspace packages `name` needs at runtime, transitively, excluding devDependencies. */
function runtimeClosure(name, byName) {
  const needed = new Set();
  const queue = [name];

  while (queue.length > 0) {
    const current = byName.get(queue.pop());
    if (current === undefined) continue;

    for (const dependency of Object.keys(current.dependencies ?? {})) {
      if (!dependency.startsWith('@sentinel/') || needed.has(dependency)) continue;
      needed.add(dependency);
      queue.push(dependency);
    }
  }
  return needed;
}

const packages = workspacePackages();
const byName = new Map(packages.map((p) => [p.name, p]));
const problems = [];

for (const image of IMAGES) {
  const contents = readFileSync(image, 'utf8');

  for (const { dir, name } of packages) {
    if (!contents.includes(`COPY ${dir}/package.json`)) {
      problems.push(
        `${image} — does not copy ${dir}/package.json, so ${name} would be installed without its dependencies`,
      );
    }
  }
}

// The API image is the only one that ships a Node runtime, so it is the only one where a
// missing `dist` becomes a crash rather than an unused layer.
const api = readFileSync('Dockerfile', 'utf8');
for (const dependency of runtimeClosure('@sentinel/api', byName)) {
  const { dir } = byName.get(dependency);
  if (!api.includes(`COPY --from=build /repo/${dir}/dist`)) {
    problems.push(
      `Dockerfile — ${dependency} is a runtime dependency of the API but its dist is never copied; the container would start and then fail to resolve it`,
    );
  }
}

/**
 * Runtime files that are not code and would therefore be missed by every check above.
 *
 * `policy.yaml` is the one that matters: the API refuses to start without it, deliberately,
 * because the alternative is acting on defaults nobody chose. An image that shipped the parser
 * and not the file would build cleanly and then fail to boot.
 */
const RUNTIME_FILES = [
  'policy.yaml',
  'ml/models/incident/artifacts/model.json',
  'ml/models/incident/artifacts/registry.json',
  'ml/models/incident/artifacts/metrics.json',
];

for (const file of RUNTIME_FILES) {
  if (!api.includes(`COPY --from=build /repo/${file}`)) {
    problems.push(
      `Dockerfile — ${file} is read at startup but never copied into the runtime image; the container would not boot`,
    );
  }
}

if (problems.length > 0) {
  console.error('check:docker failed — an image would not build, or would not run\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nAdd the missing COPY line, or drop the package from the workspace.');
  process.exit(1);
}

console.warn(
  `check:docker — ${packages.length} workspace package(s) accounted for in ${IMAGES.length} image(s)`,
);
