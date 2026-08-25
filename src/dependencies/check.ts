/**
 * npm·pnpm lockfile의 resolved dependency graph를 읽고 registry metadata 기반 정책을 평가한다.
 *
 * 호출 관계:
 * - 진입: `buildpouch dependencies check`
 * - 입력: 현재 lockfile, 선택적 기준 lockfile와 npm-compatible registry metadata
 *
 * 데이터·부수효과:
 * - lockfile과 registry metadata만 읽으며 package를 설치하거나 package code를 실행하지 않는다.
 *
 * 실패·보안 경계:
 * - metadata·공개 시각·integrity를 확인할 수 없으면 통과시키지 않는다.
 */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parse } from "yaml";

import { BuildPouchError } from "../errors.js";

type UnknownRecord = Record<string, unknown>;

interface DependencyNode {
  "id": string;
  "name": string;
  "version": string;
  "selector": string;
  "integrity"?: string;
  "source"?: string;
  "exoticSource": boolean;
}

interface DependencyGraph {
  "format": "npm" | "pnpm";
  "nodes": Map<string, DependencyNode>;
  "roots": string[];
  "edges": Map<string, string[]>;
}

interface PackageVersionMetadata {
  "dist"?: { "integrity"?: string };
  "scripts"?: Record<string, string>;
}

interface PackageMetadata {
  "time"?: Record<string, string>;
  "versions"?: Record<string, PackageVersionMetadata>;
}

export interface DependencyViolation {
  "code": "EXOTIC_SOURCE" | "INSTALL_SCRIPT" | "INTEGRITY_MISMATCH" | "INTEGRITY_MISSING" | "METADATA_UNAVAILABLE" | "NEW_PACKAGE" | "PUBLISH_TIME_MISSING" | "RELEASE_TOO_NEW";
  "package": string;
  "message": string;
  "path": string[];
}

export interface DependencyCheckResult {
  "ok": boolean;
  "lockfile": { "format": "npm" | "pnpm"; "path": string };
  "policy": { "minimumReleaseAgeHours": number; "registry": string };
  "summary": { "packages": number; "changedVersions": number; "newPackages": number; "violations": number };
  "violations": DependencyViolation[];
}

export interface DependencyCheckOptions {
  "lockfile": string;
  "minimumReleaseAgeHours": number;
  "registry": string;
  "allowInstallScripts": Set<string>;
  "allowNewPackages": Set<string>;
  "baselineLockfile"?: string;
  "checkedAt"?: Date;
  "loadMetadata"?: (name: string) => Promise<PackageMetadata>;
}

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BuildPouchError("INVALID_CONFIGURATION", `${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function selectorParts(selector: string): { "name": string; "version": string } | undefined {
  const base = selector.replace(/\(.*/, "");
  const separator = base.lastIndexOf("@");
  if (separator <= 0 || separator === base.length - 1) return undefined;
  return { "name": base.slice(0, separator), "version": base.slice(separator + 1) };
}

function dependencyNameFromNpmPath(path: string): string | undefined {
  const marker = "/node_modules/";
  const tail = path.includes(marker) ? path.slice(path.lastIndexOf(marker) + marker.length) : path.replace(/^node_modules\//, "");
  return tail === path || tail === "" ? undefined : tail;
}

function resolveNpmDependency(paths: Set<string>, owner: string, name: string): string | undefined {
  let directory = owner;
  while (true) {
    const candidate = directory === "" ? `node_modules/${name}` : `${directory}/node_modules/${name}`;
    if (paths.has(candidate)) return candidate;
    const marker = directory.lastIndexOf("/node_modules/");
    if (marker >= 0) directory = directory.slice(0, marker);
    else if (directory.startsWith("node_modules/")) directory = "";
    else if (directory !== "") directory = "";
    else return undefined;
  }
}

function parseNpmLock(value: UnknownRecord): DependencyGraph {
  if (value.lockfileVersion !== 3) throw new BuildPouchError("INVALID_CONFIGURATION", "Only package-lock.json lockfileVersion 3 is supported.");
  const packages = record(value.packages, "packages");
  const paths = new Set(Object.keys(packages));
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, string[]>();

  for (const [path, rawPackage] of Object.entries(packages)) {
    if (path === "") continue;
    if (!path.includes("node_modules/")) continue;
    const metadata = record(rawPackage, `packages.${path}`);
    const name = typeof metadata.name === "string" ? metadata.name : dependencyNameFromNpmPath(path);
    if (name === undefined || typeof metadata.version !== "string") continue;
    const resolved = typeof metadata.resolved === "string" ? metadata.resolved : undefined;
    nodes.set(path, {
      "id": path,
      "name": name,
      "version": metadata.version,
      "selector": `${name}@${metadata.version}`,
      ...(typeof metadata.integrity === "string" ? { "integrity": metadata.integrity } : {}),
      ...(resolved === undefined ? {} : { "source": resolved }),
      "exoticSource": resolved !== undefined && !/^https:\/\//.test(resolved)
    });
  }

  const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies"];
  const readEdges = (owner: string, metadata: UnknownRecord): string[] => {
    const targets = new Set<string>();
    for (const field of dependencyFields) {
      if (metadata[field] === undefined) continue;
      for (const name of Object.keys(record(metadata[field], `${owner || "root"}.${field}`))) {
        const target = resolveNpmDependency(paths, owner, name);
        if (target !== undefined && nodes.has(target)) targets.add(target);
      }
    }
    return [...targets];
  };

  for (const [path, rawPackage] of Object.entries(packages)) {
    edges.set(path, readEdges(path, record(rawPackage, `packages.${path || "root"}`)));
  }
  const roots = new Set<string>();
  for (const [path, targets] of edges) {
    if (!nodes.has(path)) for (const target of targets) roots.add(target);
  }
  return { "format": "npm", nodes, "roots": [...roots], edges };
}

function pnpmTarget(name: string, value: unknown, snapshots: UnknownRecord): string | undefined {
  const versionValue = typeof value === "string" ? value : record(value, `dependency ${name}`).version;
  if (typeof versionValue !== "string" || /^(?:link|workspace|file):/.test(versionValue)) return undefined;
  const exact = `${name}@${versionValue}`;
  if (snapshots[exact] !== undefined) return exact;
  const baseVersion = versionValue.replace(/\(.*/, "");
  return Object.keys(snapshots).find((key) => key === `${name}@${baseVersion}` || key.startsWith(`${name}@${baseVersion}(`));
}

function parsePnpmLock(value: UnknownRecord): DependencyGraph {
  if (value.lockfileVersion !== "9.0") throw new BuildPouchError("INVALID_CONFIGURATION", "Only pnpm-lock.yaml lockfileVersion 9.0 is supported.");
  const packages = record(value.packages, "packages");
  const snapshots = record(value.snapshots, "snapshots");
  const importers = record(value.importers, "importers");
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, string[]>();

  for (const id of Object.keys(snapshots)) {
    const parts = selectorParts(id);
    if (parts === undefined) continue;
    const packageKey = `${parts.name}@${parts.version}`;
    const packageMetadata = packages[packageKey] === undefined ? {} : record(packages[packageKey], `packages.${packageKey}`);
    const resolution = packageMetadata.resolution === undefined ? {} : record(packageMetadata.resolution, `packages.${packageKey}.resolution`);
    const tarball = typeof resolution.tarball === "string" ? resolution.tarball : undefined;
    nodes.set(id, {
      id,
      ...parts,
      "selector": packageKey,
      ...(typeof resolution.integrity === "string" ? { "integrity": resolution.integrity } : {}),
      ...(tarball === undefined ? {} : { "source": tarball }),
      "exoticSource": /^(?:git|file):/.test(parts.version) || (tarball !== undefined && !/^https:\/\//.test(tarball))
    });
  }

  for (const [id, rawSnapshot] of Object.entries(snapshots)) {
    if (!nodes.has(id)) continue;
    const snapshot = record(rawSnapshot, `snapshots.${id}`);
    const targets = new Set<string>();
    for (const field of ["dependencies", "optionalDependencies"]) {
      if (snapshot[field] === undefined) continue;
      for (const [name, dependency] of Object.entries(record(snapshot[field], `snapshots.${id}.${field}`))) {
        const target = pnpmTarget(name, dependency, snapshots);
        if (target !== undefined && nodes.has(target)) targets.add(target);
      }
    }
    edges.set(id, [...targets]);
  }

  const roots = new Set<string>();
  for (const [importerName, rawImporter] of Object.entries(importers)) {
    const importer = record(rawImporter, `importers.${importerName}`);
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (importer[field] === undefined) continue;
      for (const [name, dependency] of Object.entries(record(importer[field], `importers.${importerName}.${field}`))) {
        const target = pnpmTarget(name, dependency, snapshots);
        if (target !== undefined && nodes.has(target)) roots.add(target);
      }
    }
  }
  return { "format": "pnpm", nodes, "roots": [...roots], edges };
}

async function loadGraph(path: string): Promise<DependencyGraph> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new BuildPouchError("INVALID_CONFIGURATION", `Unable to read lockfile: ${path}.`);
  }
  const parsed = basename(path) === "package-lock.json" ? JSON.parse(source) : parse(source);
  const value = record(parsed, "lockfile");
  return basename(path) === "package-lock.json" ? parseNpmLock(value) : parsePnpmLock(value);
}

function shortestPath(graph: DependencyGraph, selector: string): string[] {
  const queue = graph.roots.map((id) => [id]);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const path = queue.shift() ?? [];
    const current = path.at(-1);
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (graph.nodes.get(current)?.selector === selector) return path.map((id) => graph.nodes.get(id)?.selector ?? id);
    for (const next of graph.edges.get(current) ?? []) queue.push([...path, next]);
  }
  return [selector];
}

async function fetchMetadata(registry: string, name: string): Promise<PackageMetadata> {
  const url = new URL(encodeURIComponent(name), registry.endsWith("/") ? registry : `${registry}/`);
  const response = await fetch(url, { "headers": { "accept": "application/json" }, "signal": AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
  return record(await response.json(), `registry metadata for ${name}`) as PackageMetadata;
}

export async function checkDependencies(options: DependencyCheckOptions): Promise<DependencyCheckResult> {
  const lockfile = resolve(options.lockfile);
  const graph = await loadGraph(lockfile);
  const baseline = options.baselineLockfile === undefined ? undefined : await loadGraph(resolve(options.baselineLockfile));
  const baselineSelectors = new Set([...(baseline?.nodes.values() ?? [])].map((node) => node.selector));
  const baselineNames = new Set([...(baseline?.nodes.values() ?? [])].map((node) => node.name));
  const current = new Map<string, DependencyNode>();
  for (const node of graph.nodes.values()) current.set(node.selector, node);
  const changed = [...current.values()].filter((node) => baseline !== undefined && !baselineSelectors.has(node.selector));
  const newPackages = changed.filter((node) => !baselineNames.has(node.name));
  const violations: DependencyViolation[] = [];
  const metadataCache = new Map<string, Promise<PackageMetadata>>();
  const loadMetadata = options.loadMetadata ?? ((name: string) => fetchMetadata(options.registry, name));
  const checkedAt = options.checkedAt ?? new Date();

  const addViolation = (node: DependencyNode, code: DependencyViolation["code"], message: string): void => {
    violations.push({ code, "package": node.selector, message, "path": shortestPath(graph, node.selector) });
  };

  await Promise.all([...current.values()].map(async (node) => {
    if (node.exoticSource || (node.source !== undefined && !node.source.startsWith(options.registry))) {
      addViolation(node, "EXOTIC_SOURCE", "Dependency resolves outside the configured npm registry.");
    }
    if (node.integrity === undefined) addViolation(node, "INTEGRITY_MISSING", "Lockfile entry has no integrity digest.");
    if (baseline !== undefined && !baselineNames.has(node.name) && !options.allowNewPackages.has(node.selector)) {
      addViolation(node, "NEW_PACKAGE", "Package name does not exist in the baseline lockfile.");
    }

    let metadata: PackageMetadata;
    try {
      const pending = metadataCache.get(node.name) ?? loadMetadata(node.name);
      metadataCache.set(node.name, pending);
      metadata = await pending;
    } catch (error) {
      addViolation(node, "METADATA_UNAVAILABLE", `Registry metadata is unavailable: ${error instanceof Error ? error.message : String(error)}.`);
      return;
    }

    const publishedAt = metadata.time?.[node.version];
    if (publishedAt === undefined || Number.isNaN(Date.parse(publishedAt))) {
      addViolation(node, "PUBLISH_TIME_MISSING", "Registry metadata has no valid publication time for this version.");
    } else {
      const ageHours = (checkedAt.getTime() - Date.parse(publishedAt)) / 3_600_000;
      if (ageHours < options.minimumReleaseAgeHours) {
        addViolation(node, "RELEASE_TOO_NEW", `Version is ${Math.max(0, ageHours).toFixed(1)} hours old; ${options.minimumReleaseAgeHours} hours are required.`);
      }
    }

    const versionMetadata = metadata.versions?.[node.version];
    if (versionMetadata === undefined) {
      addViolation(node, "METADATA_UNAVAILABLE", "Registry metadata has no manifest for this version.");
      return;
    }
    const registryIntegrity = versionMetadata.dist?.integrity;
    if (registryIntegrity === undefined) addViolation(node, "INTEGRITY_MISSING", "Registry metadata has no integrity digest.");
    if (node.integrity !== undefined && registryIntegrity !== undefined && node.integrity !== registryIntegrity) {
      addViolation(node, "INTEGRITY_MISMATCH", "Lockfile integrity does not match registry metadata.");
    }
    const lifecycleScripts = ["preinstall", "install", "postinstall"].filter((name) => versionMetadata.scripts?.[name] !== undefined);
    if (lifecycleScripts.length > 0 && !options.allowInstallScripts.has(node.selector)) {
      addViolation(node, "INSTALL_SCRIPT", `Lifecycle scripts require an exact-version allowance: ${lifecycleScripts.join(", ")}.`);
    }
  }));

  violations.sort((left, right) => left.package.localeCompare(right.package) || left.code.localeCompare(right.code));
  return {
    "ok": violations.length === 0,
    "lockfile": { "format": graph.format, "path": lockfile },
    "policy": { "minimumReleaseAgeHours": options.minimumReleaseAgeHours, "registry": options.registry },
    "summary": { "packages": current.size, "changedVersions": changed.length, "newPackages": newPackages.length, "violations": violations.length },
    violations
  };
}
