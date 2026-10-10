import assert from 'node:assert/strict';
import '../dist/profiles.js';

let saves = 0;
const sourceSettings = {
  profileId: 'model-first', autoMode: 'none', schemaPreset: 'default',
  schemaPresets: { default: { name: 'Default', value: { type: 'object' }, html: '<b>Original</b>' } },
  prompt: 'original prompt', promptJson: 'json', promptXml: 'xml',
  promptEngineeringMode: 'native', promptRole: 'user', maxResponseToken: 300,
  includeLastXMessages: 0, includeLastXWTrackerMessages: 1,
};
const manager = {
  settings: structuredClone(sourceSettings),
  getSettings() { return this.settings; },
  saveSettings() { saves += 1; },
};
let chatId = 'Yukio';
const metadata = new Map();
const listeners = new Map();
const ctx = {
  event_types: { CHAT_CHANGED: 'chat_id_changed' },
  eventSource: {on(name, listener) {listeners.set(name, listener);}},
  get chatId() {return chatId;},
  get chatMetadata() { return metadata.get(chatId); },
  saveMetadataDebounced() {},
};
function makeChat(name) { metadata.set(name, {}); }
makeChat('Yukio'); makeChat('Clark'); makeChat('Denji');
globalThis.SillyTavern = {getContext() {return ctx;}};
globalThis.document = {getElementById() {return null;}, querySelector() {return null;}};
globalThis.__wtrackerRefreshSettings = () => {};
const addon = globalThis.__wtrackerProfileAddon.init(manager, ctx);
assert.equal(manager.settings.configurationProfiles.original.config.prompt, 'original prompt');
assert.equal(manager.settings.activeConfigurationProfile, 'original');
assert.ok(listeners.has('chat_id_changed'), 'chat-switch listener must use SillyTavern event ID');
// Existing WTracker settings UI calls this manager method for every field edit.
manager.settings.prompt = 'Yukio prompt';
manager.settings.schemaPresets.default.html = '<b>Yukio</b>';
manager.saveSettings();
assert.equal(manager.settings.configurationProfiles.original.config.prompt, 'Yukio prompt');
assert.equal(manager.settings.configurationProfiles.original.config.schemaPresets.default.html, '<b>Yukio</b>');
// Give another profile a separate prompt, schema and API connection.
manager.settings.configurationProfiles.clark = {
  name: 'Clark', config: {...structuredClone(manager.settings.configurationProfiles.original.config),
    prompt: 'Clark prompt', profileId: 'model-second', schemaPresets: {
      default: {name:'Default',value:{type:'object'},html:'<b>Clark</b>'}
    }
  }
};
// Bind Yukio and Clark independently.
assert.equal(addon.setChatBinding('original'), true);
chatId = 'Clark';
addon.syncChat();
assert.equal(manager.settings.prompt, 'Yukio prompt', 'unbound chat returns to global default');
assert.equal(addon.setChatBinding('clark'), true);
assert.equal(manager.settings.prompt, 'Clark prompt');
assert.equal(manager.settings.profileId, 'model-second');
assert.equal(manager.settings.schemaPresets.default.html, '<b>Clark</b>');
chatId = 'Yukio'; addon.syncChat();
assert.equal(manager.settings.prompt, 'Yukio prompt');
assert.equal(manager.settings.profileId, 'model-first');
assert.equal(manager.settings.schemaPresets.default.html, '<b>Yukio</b>');
chatId = 'Clark'; addon.syncChat();
assert.equal(manager.settings.prompt, 'Clark prompt');
// A different unbound chat must not inherit Clark's settings.
chatId = 'Denji'; addon.syncChat();
assert.equal(manager.settings.prompt, 'Yukio prompt');
assert.equal(manager.settings.profileId, 'model-first');
assert.ok(saves > 3);
console.log('PASS: migrated old settings; edits autosave; per-chat bindings; independent API/schema/prompt; unbound fallback.');
// Export/import format is accepted without guessing or changing existing state.
const good = {type:'SillyTavern-WTracker-configuration-profile', formatVersion:1,
  name:'Shareable Profile', config: structuredClone(manager.settings.configurationProfiles.original.config)};
assert.equal(globalThis.__wtrackerProfileAddon.validateProfile(good).config.prompt, 'Yukio prompt');
assert.throws(() => globalThis.__wtrackerProfileAddon.validateProfile({...good, formatVersion: 99}));
assert.throws(() => globalThis.__wtrackerProfileAddon.validateProfile({...good, config:{...good.config, schemaPresets:{}}}));
console.log('PASS: profile JSON import validation rejects incompatible or broken data.');
