import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, PortalState, TownLiveState } from './shared';
const api: DesktopAPI = {
  platform: process.platform,
  appearance: theme => ipcRenderer.invoke('beings:appearance', theme),
  town: query => ipcRenderer.invoke('beings:town', query),
  townLive: () => ipcRenderer.invoke('beings:town-live'),
  reconnectTown: () => ipcRenderer.invoke('beings:town-reconnect'),
  sendTown: input => ipcRenderer.invoke('beings:town-send', input),
  onTownLive: callback => {
    const listener = (_event: unknown, state: TownLiveState) => callback(state);
    ipcRenderer.on('beings:town-live', listener);
    return () => ipcRenderer.removeListener('beings:town-live', listener);
  },
  townAuth: () => ipcRenderer.invoke('beings:town-auth'),
  pairTown: input => ipcRenderer.invoke('beings:town-pair', input),
  saveTownToken: token => ipcRenderer.invoke('beings:town-token', token),
  localKits: () => ipcRenderer.invoke('beings:kits'),
  importKit: () => ipcRenderer.invoke('beings:kit-import'),
  prepareKit: id => ipcRenderer.invoke('beings:kit-prepare', id),
  installKit: input => ipcRenderer.invoke('beings:kit-install', input),
  discardKit: ticket => ipcRenderer.invoke('beings:kit-discard', ticket),
  applyKits: () => ipcRenderer.invoke('beings:kits-apply'),
  openKits: () => ipcRenderer.invoke('beings:kits-open'),
  openTownLink: route => ipcRenderer.invoke('beings:town-open', route),
  snapshot: () => ipcRenderer.invoke('beings:snapshot'),
  save: input => ipcRenderer.invoke('beings:save', input),
  choose: kind => ipcRenderer.invoke('beings:choose', kind),
  startPortal: () => ipcRenderer.invoke('beings:portal-start'),
  stopPortal: () => ipcRenderer.invoke('beings:portal-stop'),
  openWorkspace: () => ipcRenderer.invoke('beings:workspace'),
  onPortal: callback => {
    const listener = (_event: unknown, state: PortalState) => callback(state);
    ipcRenderer.on('beings:portal-state', listener);
    return () => ipcRenderer.removeListener('beings:portal-state', listener);
  },
};
if (process.isMainFrame) contextBridge.exposeInMainWorld('beings', api);
