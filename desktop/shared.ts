export interface Settings {
  endpoint: string;
  being: string;
  hasToken: boolean;
  workspace: string;
  portalBinary: string;
  portalName: string;
  autoStart: boolean;
  backgroundEnabled?: boolean;
  allowExec: boolean;
  kitsEnabled: boolean;
  portalConfigPath?: string;
  portalEnvironmentPath?: string;
}
export interface SaveSettings {
  connectionLink?: string;
  workspace: string;
  portalBinary: string;
  portalName: string;
  autoStart: boolean;
  backgroundEnabled?: boolean;
  allowExec: boolean;
  kitsEnabled: boolean;
  portalConfigPath?: string;
  portalEnvironmentPath?: string;
}
export type PortalPhase = 'running' | 'stopped' | 'starting' | 'connected' | 'reconnecting' | 'stopping' | 'external' | 'error';
export interface PortalState { phase: PortalPhase; pid?: number; managed?: boolean; runtimePath?: string; message: string; logs: string[] }
export interface BackgroundState { supported: boolean; installed: boolean; enabled: boolean; running: boolean; existing: boolean; label?: string; pid?: number; message: string }
export interface Snapshot { settings: Settings; portal: PortalState; background?: BackgroundState }
export interface DesktopAPI {
  platform: string;
  checkUpdates(): Promise<void>;
  updateState(): Promise<import('./updates').UpdateState>;
  onUpdate(callback: (state: import('./updates').UpdateState) => void): () => void;
  appearance(theme?: 'light' | 'dark'): Promise<'light' | 'dark'>;
  town(query: TownQuery): Promise<TownResult>;
  townLive(): Promise<TownLiveState>;
  reconnectTown(): Promise<void>;
  onTownLive(callback: (state: TownLiveState) => void): () => void;
  sendTown(input: TownPost): Promise<TownResult>;
  townAuth(): Promise<{ configured: boolean; beingId?: string; suggestedBeingId?: string; warning?: string }>;
  pairTown(input: { beingId: string; code: string }): Promise<void>;
  saveTownToken(token: string): Promise<void>;
  localKits(): Promise<KitLibrary>;
  importKit(): Promise<{ installed: boolean; name?: string }>;
  prepareKit(id: string): Promise<KitInstallPlan>;
  installKit(input: KitInstallInput): Promise<{ name: string; tools: number; message: string }>;
  discardKit(ticket: string): Promise<void>;
  applyKits(): Promise<PortalState>;
  openKits(): Promise<void>;
  openTownLink(route: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  save(input: SaveSettings): Promise<Snapshot>;
  choose(kind: 'workspace' | 'binary'): Promise<string | null>;
  startPortal(): Promise<PortalState>;
  stopPortal(): Promise<PortalState>;
  openWorkspace(): Promise<void>;
  onPortal(callback: (state: PortalState) => void): () => void;
}
declare global { interface Window { beings: DesktopAPI } }

export type TownKind = 'home' | 'bonfire' | 'firesides' | 'fireside' | 'inbox' | 'sent' | 'embers' | 'scrolls' | 'my-scrolls' | 'grove' | 'kit' | 'ember' | 'scroll';
export interface TownQuery { kind: TownKind; offset?: number; id?: string; scrollKind?: string }
export type TownResult = { ok: true; data: Record<string, unknown>; fetchedAt: string } | { ok: false; code: 'auth' | 'forbidden' | 'not-found' | 'http' | 'network'; message: string };
export type TownChannel = 'bonfire' | 'mail' | 'firesides';
export interface TownLiveState {
  phase: 'unpaired' | 'connecting' | 'connected' | 'reconnecting' | 'auth-error';
  generation: number;
  revision: number;
  sync: number;
  beingId?: string;
  message: string;
  versions: Record<TownChannel, number>;
}
export type TownPost = { kind: 'bonfire'; content: string } | { kind: 'dm'; recipient: string; content: string } | { kind: 'fireside'; firesideId: string; content: string };
export interface KitTool { name: string; description: string; params?: unknown }
export interface LocalKit { name: string; version: string; description: string; directory: string; command: string[]; tools: KitTool[]; compatible: boolean; eager: boolean; problem?: string }
export interface KitLibrary { directory: string; enabled: boolean; kits: LocalKit[]; configPath?: string }
export interface KitInstallPlan { ticket: string; name: string; version: string; description: string; tools: number; command: string[]; environment: { name: string; description: string; required: boolean }[]; dependency: 'none' | 'npm' | 'python'; sha256: string; notes: string }
export interface KitInstallInput { ticket: string; environment: Record<string, string> }
