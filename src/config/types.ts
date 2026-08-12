/**
 * 공개 YAML 설정과 검증 이후 context 계획에 사용하는 타입을 정의한다.
 */

export interface ContextEntry {
  "source": string;
  "target": string;
  "required": boolean;
}

export interface ContextConfig {
  "name": string;
  "root": string;
  "entries": ContextEntry[];
  "exclude": string[];
}

export interface GcpCloudBuildOptions {
  "config": string;
  "project": string;
  "region": string;
  "substitutions": Record<string, string>;
}

export interface BuildConfig extends GcpCloudBuildOptions {
  "provider": "gcp-cloud-build";
}

export interface GcpCloudBuildTarget {
  "provider": "gcp-cloud-build";
  "options": GcpCloudBuildOptions;
}

export interface NcpNksBuildkitOptions {
  "endpoint": string;
  "region": string;
  "bucket": string;
  "prefix": string;
  "awsProfile"?: string;
  "kubeContext": string;
  "namespace": string;
  "jobTemplate": string;
  "container": string;
  "timeoutSeconds": number;
  "pollIntervalSeconds": number;
  "variables": Record<string, string>;
}

export interface NcpNksBuildkitTarget {
  "provider": "ncp-nks-buildkit";
  "options": NcpNksBuildkitOptions;
}

export type BuildTargetConfig = GcpCloudBuildTarget | NcpNksBuildkitTarget;

export interface BuildPouchConfig {
  "schemaVersion": 1;
  "context": ContextConfig;
  "build"?: BuildConfig;
  "defaultTarget"?: string;
  "targets": Record<string, BuildTargetConfig>;
}

export interface LoadedConfig {
  "config": BuildPouchConfig;
  "configFile": string;
  "configDirectory": string;
}
