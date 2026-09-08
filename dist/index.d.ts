export interface DeviceMemory {
  totalGb: number;
  freeGb: number | null;
}

export interface GpuInfo {
  webgpu: boolean;
  adapter: string | null;
}

export interface ModelCapability {
  capable: boolean;
  tier: string;
  reason?: string;
}

export interface DeviceProfile {
  runtime: 'browser' | 'node' | 'unknown';
  cores: number;
  memory: DeviceMemory;
  gpu: GpuInfo;
  wasmSimd: boolean;
  online: boolean;
  models: {
    llm: ModelCapability;
    stt: ModelCapability;
    tts: ModelCapability;
  };
}

export interface RoutingDecision {
  target: 'local' | 'cloud';
  confidence: number;
  complexity: number;
  reason: string;
}

export interface AskResult {
  text: string;
  confidence?: number;
  latency?: number;
  source: 'local' | 'cloud';
}

export interface TranscribeResult {
  text: string;
  confidence?: number;
  latency?: number;
  source: 'local' | 'cloud';
}

export interface SpeakResult {
  audio: ArrayBuffer | Blob | null;
  latency?: number;
  source: 'local' | 'cloud';
}

export type RoutingMode = 'auto' | 'prefer-local' | 'prefer-cloud' | 'local-only' | 'cloud-only';

export interface RoutingRule {
  match?: RegExp | string;
  if?: (context: { task: string; input: any; complexity: number; confidence: number; device: DeviceProfile }) => boolean;
  target: 'local' | 'cloud';
  reason?: string;
}

export interface TaskRouteOptions {
  mode?: RoutingMode;
  threshold?: number;
}

export interface CallOptions {
  target?: 'local' | 'cloud';
  mode?: RoutingMode;
  confidenceThreshold?: number;
  threshold?: number;
  rules?: RoutingRule[];
  router?: (context: any) => 'local' | 'cloud' | void;
  [key: string]: any;
}

export interface HybridOptions {
  mode?: RoutingMode;
  confidenceThreshold?: number;
  threshold?: number;
  preload?: boolean | Array<'llm' | 'stt' | 'tts'>;
  apiKey?: string;
  endpoint?: string;
  transport?: 'sse' | 'ws';
  probe?: (context: { taskType: string; input: any; complexity: number; deviceProfile: DeviceProfile }) => number;
  router?: (context: { task: string; input: any; complexity: number; confidence: number; device: DeviceProfile; options: any }) => 'local' | 'cloud' | void;
  rules?: RoutingRule[];
  llm?: TaskRouteOptions;
  stt?: TaskRouteOptions;
  tts?: TaskRouteOptions;
  local?: {
    llm?: any;
    stt?: any;
    tts?: any;
  };
  cloud?: {
    apiKey?: string;
    endpoint?: string;
    transport?: 'sse' | 'ws';
    models?: {
      llm?: string;
      stt?: string;
      tts?: string;
    };
    ask?: (prompt: string, options?: any) => Promise<string | { text: string }>;
    stream?: (prompt: string, options?: any) => AsyncIterable<StreamChunk>;
    transcribe?: (audio: any, options?: any) => Promise<string | { text: string }>;
    speak?: (text: string, options?: any) => Promise<any>;
  };
}

export class Router {
  mode: RoutingMode;
  confidenceThreshold: number;
  rules: RoutingRule[];
  constructor(options?: Partial<HybridOptions>);
  decide(taskType: 'llm' | 'stt' | 'tts', input: any, deviceProfile: DeviceProfile, runOptions?: CallOptions): RoutingDecision;
  estimateComplexity(taskType: string, input: any): number;
  estimateConfidence(taskType: string, input: any, complexity: number, deviceProfile: DeviceProfile): number;
}

export interface StreamChunk {
  token: string;
  text: string;
  source: 'local' | 'cloud';
  confidence?: number;
  done: boolean;
}

export interface ModelState {
  state: 'unloaded' | 'loading' | 'resident' | 'error';
  loadedAt?: number | null;
  error?: string;
}

export class LocalProvider {
  constructor(options?: any);
  status(taskType?: string): ModelState | Record<string, ModelState>;
  load(taskType: string): Promise<boolean>;
  unload(taskType: string): Promise<boolean>;
  generate(prompt: string, options?: any): Promise<AskResult>;
  transcribe(audio: any, options?: any): Promise<TranscribeResult>;
  speak(text: string, options?: any): Promise<SpeakResult>;
}

export class CloudProvider {
  constructor(options?: any);
  generate(prompt: string, options?: any): Promise<AskResult>;
  transcribe(audio: any, options?: any): Promise<TranscribeResult>;
  speak(text: string, options?: any): Promise<SpeakResult>;
}

export class HybridEngine {
  device: DeviceProfile;
  router: Router;
  local: LocalProvider;
  cloud: CloudProvider;
  constructor(options?: HybridOptions, deviceProfile?: DeviceProfile);
  on(event: 'route' | 'fallback' | 'load' | 'unload' | string, handler: (data: any) => void): this;
  off(event: string, handler: (data: any) => void): this;
  once(event: string, handler: (data: any) => void): this;
  status(taskType?: 'llm' | 'stt' | 'tts'): ModelState | Record<string, ModelState>;
  detect(): Promise<DeviceProfile>;
  can(taskType: 'llm' | 'stt' | 'tts'): boolean;
  load(taskType: 'llm' | 'stt' | 'tts'): Promise<boolean>;
  unload(taskType: 'llm' | 'stt' | 'tts'): Promise<boolean>;
  route(taskType: 'llm' | 'stt' | 'tts', input: any, options?: CallOptions): RoutingDecision;
  ask(prompt: string, options?: CallOptions): Promise<AskResult>;
  askStream(prompt: string, options?: CallOptions): AsyncIterable<StreamChunk>;
  transcribe(audio: any, options?: CallOptions): Promise<TranscribeResult>;
  speak(text: string, options?: CallOptions): Promise<SpeakResult>;
}

export function detect(options?: { cache?: boolean; forceRefresh?: boolean }): Promise<DeviceProfile>;

export default function localfirst(options?: HybridOptions): Promise<HybridEngine>;
export function localfirst(options?: HybridOptions): Promise<HybridEngine>;
export function hybrid(options?: HybridOptions): Promise<HybridEngine>;
