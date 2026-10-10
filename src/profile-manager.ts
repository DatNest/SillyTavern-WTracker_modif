/**
 * Configuration profiles for WTracker.
 *
 * The original tracker configuration fields remain the source of truth for
 * generation. Profiles are snapshots of those fields; neither existing message
 * trackers nor chat-specific schemaKey metadata are modified by this module.
 */
import { ExtensionSettingsManager } from 'sillytavern-utils-lib';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import {
  defaultSettings, EXTENSION_KEY, ExtensionSettings,
  PromptEngineeringMode,
} from './config.js';

export type TrackerConfiguration = Pick<ExtensionSettings,
  | 'profileId' | 'autoMode' | 'schemaPreset' | 'schemaPresets'
  | 'prompt' | 'promptJson' | 'promptXml' | 'promptEngineeringMode'
  | 'promptRole' | 'maxResponseToken' | 'includeLastXMessages'
  | 'includeLastXWTrackerMessages'
>;

export interface NamedConfiguration {
  name: string;
  config: TrackerConfiguration;
}

export interface ProfileStore {
  configurationProfiles: Record<string, NamedConfiguration>;
  activeConfigurationProfile: string;
  defaultConfigurationProfile: string;
}

export const PROFILE_CHANGED_EVENT = 'wtracker:configuration-changed';
export const CHAT_CONFIGURATION_KEY = 'configurationProfileId';

export const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

const CONFIG_KEYS: (keyof TrackerConfiguration)[] = [
  'profileId', 'autoMode', 'schemaPreset', 'schemaPresets', 'prompt', 'promptJson',
  'promptXml', 'promptEngineeringMode', 'promptRole', 'maxResponseToken',
  'includeLastXMessages', 'includeLastXWTrackerMessages',
];

const copy = <T,>(value: T): T => structuredClone(value);

export function readConfiguration(settings: ExtensionSettings = settingsManager.getSettings()): TrackerConfiguration {
  const result: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) result[key] = copy(settings[key]);
  return result as unknown as TrackerConfiguration;
}

function applyConfiguration(settings: ExtensionSettings, config: TrackerConfiguration) {
  for (const key of CONFIG_KEYS) {
    // Assign to the existing settings object: generateTracker and the auto-mode
    // handlers in the original extension use that same object.
    (settings as unknown as Record<string, unknown>)[key] = copy(config[key]);
  }
}

function store(settings: ExtensionSettings): ProfileStore {
  return settings as ExtensionSettings & ProfileStore;
}

export function announceConfigurationChange() {
  document.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
}

export function initializeConfigurationProfiles() {
  const settings = settingsManager.getSettings();
  const state = store(settings);
  if (!state.configurationProfiles || !Object.keys(state.configurationProfiles).length) {
    // Migration: preserve the user's ENTIRE pre-existing WTracker configuration.
    state.configurationProfiles = {
      original: { name: 'My existing settings', config: readConfiguration(settings) },
    };
    state.activeConfigurationProfile = 'original';
    state.defaultConfigurationProfile = 'original';
  }
  if (!state.configurationProfiles[state.activeConfigurationProfile]) {
    state.activeConfigurationProfile = Object.keys(state.configurationProfiles)[0];
  }
  if (!state.configurationProfiles[state.defaultConfigurationProfile]) {
    state.defaultConfigurationProfile = state.activeConfigurationProfile;
  }
  settingsManager.saveSettings();
}

/** Called for every edit to the original settings UI, including schema edits. */
export function saveConfigurationEdit() {
  const settings = settingsManager.getSettings();
  const state = store(settings);
  const active = state.configurationProfiles?.[state.activeConfigurationProfile];
  if (active) active.config = readConfiguration(settings);
  settingsManager.saveSettings();
}

export function activeConfigurationId(): string {
  return store(settingsManager.getSettings()).activeConfigurationProfile;
}

export function allConfigurations(): Record<string, NamedConfiguration> {
  return store(settingsManager.getSettings()).configurationProfiles;
}

export function switchConfiguration(id: string, updateDefault = false): boolean {
  const settings = settingsManager.getSettings();
  const state = store(settings);
  const target = state.configurationProfiles[id];
  if (!target) return false;
  applyConfiguration(settings, target.config);
  state.activeConfigurationProfile = id;
  if (updateDefault) state.defaultConfigurationProfile = id;
  settingsManager.saveSettings();
  announceConfigurationChange();
  return true;
}

function nextId() {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createConfiguration(name: string): string {
  const settings = settingsManager.getSettings();
  const state = store(settings);
  const id = nextId();
  state.configurationProfiles[id] = { name: name.trim(), config: readConfiguration(settings) };
  settingsManager.saveSettings();
  switchConfiguration(id, !getBoundConfigurationId());
  return id;
}

export function renameConfiguration(id: string, name: string) {
  const state = store(settingsManager.getSettings());
  if (!state.configurationProfiles[id]) return;
  state.configurationProfiles[id].name = name.trim();
  settingsManager.saveSettings();
  announceConfigurationChange();
}

export function deleteConfiguration(id: string): boolean {
  const state = store(settingsManager.getSettings());
  if (!state.configurationProfiles[id] || Object.keys(state.configurationProfiles).length < 2) return false;
  delete state.configurationProfiles[id];
  const fallback = Object.keys(state.configurationProfiles)[0];
  if (state.defaultConfigurationProfile === id) state.defaultConfigurationProfile = fallback;
  if (getBoundConfigurationId() === id) unbindConfigurationFromChat();
  if (state.activeConfigurationProfile === id) {
    switchConfiguration(state.defaultConfigurationProfile);
  } else {
    settingsManager.saveSettings();
    announceConfigurationChange();
  }
  return true;
}

// Chat-bound profiles are saved in chat metadata, not the global extension
// settings. This remains separate from WTracker's existing chat schemaKey.
function currentChat(): any | null {
  const context = SillyTavern.getContext() as any;
  if (!context?.chatMetadata) return null;
  // ST uses chatId for existing (including group) chats. Do not accidentally
  // attach a profile to the welcome screen.
  if (!context.chatId) return null;
  return context;
}

export function hasCurrentChat(): boolean {
  return !!currentChat();
}

export function getBoundConfigurationId(): string | null {
  const context = currentChat();
  const id = context?.chatMetadata?.[EXTENSION_KEY]?.[CHAT_CONFIGURATION_KEY];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function bindConfigurationToChat(id: string): boolean {
  const context = currentChat();
  const state = store(settingsManager.getSettings());
  if (!context || !state.configurationProfiles[id]) return false;
  context.chatMetadata[EXTENSION_KEY] ||= {};
  context.chatMetadata[EXTENSION_KEY][CHAT_CONFIGURATION_KEY] = id;
  context.saveMetadataDebounced();
  switchConfiguration(id);
  return true;
}

export function unbindConfigurationFromChat(): boolean {
  const context = currentChat();
  if (!context?.chatMetadata?.[EXTENSION_KEY]?.[CHAT_CONFIGURATION_KEY]) return false;
  delete context.chatMetadata[EXTENSION_KEY][CHAT_CONFIGURATION_KEY];
  context.saveMetadataDebounced();
  announceConfigurationChange();
  return true;
}

export function synchronizeChatConfiguration() {
  const settings = settingsManager.getSettings();
  const state = store(settings);
  const boundId = getBoundConfigurationId();
  if (boundId && !state.configurationProfiles[boundId]) {
    // A profile was deleted after being bound to this chat: forget this stale
    // reference and use the global default rather than leaking another chat's.
    unbindConfigurationFromChat();
  }
  switchConfiguration(boundId && state.configurationProfiles[boundId] ? boundId : state.defaultConfigurationProfile);
}

export interface ExportedConfiguration {
  type: 'SillyTavern-WTracker-configuration-profile';
  formatVersion: 1;
  name: string;
  config: TrackerConfiguration;
}

export function exportConfiguration(id: string): ExportedConfiguration {
  const profile = allConfigurations()[id];
  if (!profile) throw new Error('Profile not found.');
  return { type: 'SillyTavern-WTracker-configuration-profile', formatVersion: 1,
    name: profile.name, config: copy(profile.config) };
}

function plainObject(value: any): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reject malformed/foreign JSON without changing any current settings. */
export function validateImportedConfiguration(input: unknown): ExportedConfiguration {
  if (!plainObject(input) || input.type !== 'SillyTavern-WTracker-configuration-profile' || input.formatVersion !== 1 ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150 || !plainObject(input.config)) {
    throw new Error('This is not a WTracker configuration profile (format 1).');
  }
  const candidate = input.config as Record<string, unknown>;
  const stringKeys = ['profileId', 'schemaPreset', 'prompt', 'promptJson', 'promptXml'];
  if (stringKeys.some(key => typeof candidate[key] !== 'string') ||
      !['none','responses','inputs','both'].includes(candidate.autoMode as string) ||
      !Object.values(PromptEngineeringMode).includes(candidate.promptEngineeringMode as PromptEngineeringMode) ||
      !['user','assistant'].includes(candidate.promptRole as string) ||
      ['maxResponseToken','includeLastXMessages','includeLastXWTrackerMessages'].some(key =>
        !Number.isSafeInteger(candidate[key]) || (candidate[key] as number) < (key === 'maxResponseToken' ? 1 : 0)) ||
      !plainObject(candidate.schemaPresets) || !Object.keys(candidate.schemaPresets).length) {
    throw new Error('The WTracker profile contains invalid settings.');
  }
  for (const [key, value] of Object.entries(candidate.schemaPresets)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !plainObject(value) ||
        typeof value.name !== 'string' || !plainObject(value.value) || typeof value.html !== 'string') {
      throw new Error('The imported profile contains an invalid schema preset.');
    }
  }
  if (!Object.hasOwn(candidate.schemaPresets, candidate.schemaPreset as string)) {
    throw new Error('The selected schema preset does not exist in this profile.');
  }
  const config = {} as Record<string, unknown>;
  for (const key of CONFIG_KEYS) config[key] = copy(candidate[key]);
  return { type: 'SillyTavern-WTracker-configuration-profile', formatVersion: 1,
    name: input.name.trim(), config: config as unknown as TrackerConfiguration };
}

export function importConfiguration(input: unknown): string {
  const imported = validateImportedConfiguration(input);
  const settings = settingsManager.getSettings();
  const state = store(settings);
  const id = nextId();
  state.configurationProfiles[id] = { name: imported.name, config: imported.config };
  settingsManager.saveSettings();
  switchConfiguration(id, !getBoundConfigurationId());
  return id;
}
