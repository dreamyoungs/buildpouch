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

export interface BuildConfig {
  "provider": "gcp-cloud-build";
  "config": string;
  "project": string;
  "region": string;
  "substitutions": Record<string, string>;
}

export interface BuildPouchConfig {
  "schemaVersion": 1;
  "context": ContextConfig;
  "build"?: BuildConfig;
}

export interface LoadedConfig {
  "config": BuildPouchConfig;
  "configFile": string;
  "configDirectory": string;
}
