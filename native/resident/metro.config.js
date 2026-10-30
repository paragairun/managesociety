// Metro, taught to see the web app's business logic.
//
// The pure modules in <repo>/src/lib — permissions, route access,
// attendance rules, vehicle plates, guest passes — are plain
// TypeScript with no DOM in them, and the website and this app must
// agree on every one of them. Sharing the files is the only way to
// guarantee that; a second copy in this directory would drift the first
// time somebody fixed a rule in one place.
//
// Metro refuses to load anything outside the project root unless it is
// listed in watchFolders, hence the two entries below.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");
const sharedLib = path.resolve(repoRoot, "src/lib");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedLib];

// Only this project's node_modules. Without pinning it, Metro walks up
// to the repo root and resolves React from the WEBSITE's dependencies,
// which produces two copies of React and a blank screen.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@core": sharedLib,
};

module.exports = config;
