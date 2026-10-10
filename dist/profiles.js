/*
 * WTracker Configuration Profiles add-on.
 * Runtime-compatible addition to the original bundled WTracker 0.1.1.
 * Existing tracker generation, HTML, and per-message data are untouched.
 * MIT License; original project by bmen25124.
 */
const PROFILE_KEYS = [
    'profileId', 'autoMode', 'schemaPreset', 'schemaPresets', 'prompt',
    'promptJson', 'promptXml', 'promptEngineeringMode', 'promptRole',
    'maxResponseToken', 'includeLastXMessages', 'includeLastXWTrackerMessages',
];
const CHATTRACKER = 'WTracker';
const BINDKEY = 'configurationProfileId';
const clone = value => structuredClone(value);
const snapshot = settings => Object.fromEntries(PROFILE_KEYS.map(key => [key, clone(settings[key])]));
const uuid = () => `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

function validateProfile(raw) {
    if (!isObject(raw) || raw.type !== 'SillyTavern-WTracker-configuration-profile' ||
        raw.formatVersion !== 1 || typeof raw.name !== 'string' || !raw.name.trim() ||
        raw.name.length > 150 || !isObject(raw.config)) {
        throw new Error('Not a WTracker settings profile (format 1).');
    }
    const c = raw.config;
    for (const field of ['profileId', 'schemaPreset', 'prompt', 'promptJson', 'promptXml']) {
        if (typeof c[field] !== 'string') throw new Error(`Invalid setting: ${field}.`);
    }
    if (!['none', 'responses', 'inputs', 'both'].includes(c.autoMode) ||
        !['native', 'json', 'xml'].includes(c.promptEngineeringMode) ||
        !['user', 'assistant'].includes(c.promptRole)) throw new Error('Invalid generation settings.');
    for (const field of ['maxResponseToken', 'includeLastXMessages', 'includeLastXWTrackerMessages']) {
        if (!Number.isSafeInteger(c[field]) || c[field] < (field === 'maxResponseToken' ? 1 : 0)) {
            throw new Error(`Invalid numeric setting: ${field}.`);
        }
    }
    if (!isObject(c.schemaPresets) || !Object.keys(c.schemaPresets).length ||
        !Object.hasOwn(c.schemaPresets, c.schemaPreset)) {
        throw new Error('Invalid schema presets.');
    }
    for (const [key, schema] of Object.entries(c.schemaPresets)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key) || !isObject(schema) ||
            typeof schema.name !== 'string' || !isObject(schema.value) || typeof schema.html !== 'string') {
            throw new Error(`Invalid schema: ${key}.`);
        }
    }
    return {
        name: raw.name.trim(),
        config: Object.fromEntries(PROFILE_KEYS.map(key => [key, clone(c[key])])),
    };
}

function startAddon(manager, context) {
    const settings = manager.getSettings();
    const saveNative = manager.saveSettings.bind(manager);
    let applying = false;
    let activeChatKey = null;
    let activeChatBinding = null;
    const save = () => saveNative();
    const store = () => settings.configurationProfiles;
    const activeId = () => settings.activeConfigurationProfile;
    const chatContext = () => {
        const current = SillyTavern.getContext();
        return current && current.chatId && current.chatMetadata ? current : null;
    };
    const boundId = () => chatContext()?.chatMetadata?.[CHATTRACKER]?.[BINDKEY] || null;
    const chatIdentity = () => chatContext()?.chatId || null;

    if (!isObject(settings.configurationProfiles) || !Object.keys(settings.configurationProfiles).length) {
        settings.configurationProfiles = {
            original: { name: 'My existing settings', config: snapshot(settings) },
        };
        settings.activeConfigurationProfile = 'original';
        settings.defaultConfigurationProfile = 'original';
    }
    if (!store()[activeId()]) settings.activeConfigurationProfile = Object.keys(store())[0];
    if (!store()[settings.defaultConfigurationProfile]) settings.defaultConfigurationProfile = activeId();
    save();

    // The original React controls save through this manager. Mirror their edits
    // into the selected configuration without changing the controls themselves.
    manager.saveSettings = function (...args) {
        if (!applying && store()[activeId()]) store()[activeId()].config = snapshot(settings);
        return saveNative(...args);
    };

    function switchTo(id, setDefault = false) {
        const found = store()[id];
        if (!found) return false;
        const configurationChanged = activeId() !== id;
        const defaultChanged = setDefault && settings.defaultConfigurationProfile !== id;
        // Binding an already active profile must NOT remount the whole React
        // settings drawer; doing so makes the open panel collapse.
        if (!configurationChanged && !defaultChanged) {
            scheduleDraw();
            return true;
        }
        applying = true;
        try {
            if (configurationChanged) {
                for (const key of PROFILE_KEYS) settings[key] = clone(found.config[key]);
                settings.activeConfigurationProfile = id;
            }
            if (setDefault) settings.defaultConfigurationProfile = id;
            save();
        } finally {
            applying = false;
        }
        if (configurationChanged) refreshNativeSettings();
        scheduleDraw();
        return true;
    }

    function refreshNativeSettings() {
        if (typeof globalThis.__wtrackerRefreshSettings !== 'function') return;
        const root = document.getElementById('wtracker-react-settings-root');
        const oldDrawer = root?.querySelector('.inline-drawer-content');
        // Only restore the drawer when it was previously open. Preserve the
        // original SillyTavern closed-state CSS for all other cases.
        const wasOpen = !!oldDrawer && (typeof getComputedStyle !== 'function'
            ? oldDrawer.style.display !== 'none'
            : getComputedStyle(oldDrawer).display !== 'none');
        if (!wasOpen || !root || typeof MutationObserver === 'undefined') {
            globalThis.__wtrackerRefreshSettings();
            return;
        }
        let restored = false;
        const observer = new MutationObserver(() => {
            const drawer = root.querySelector('.inline-drawer-content');
            if (!drawer || drawer === oldDrawer) return;
            if (restored) return;
            restored = true;
            // React recreated the drawer, so restore its visible state.
            drawer.style.display = 'block';
            root.querySelector('.inline-drawer-icon')?.classList.remove('down');
            observer.disconnect();
        });
        observer.observe(root, { childList: true, subtree: true });
        globalThis.__wtrackerRefreshSettings();
        // Safety: observer is only needed during this React commit.
        setTimeout(() => observer.disconnect(), 1500);
    }

    function persistChatMetadata(current) {
        // saveMetadataDebounced exists in recent SillyTavern versions. Use the
        // official saveMetadata fallback for older builds.
        if (typeof current.saveMetadataDebounced === 'function') current.saveMetadataDebounced();
        else if (typeof current.saveMetadata === 'function') {
            Promise.resolve(current.saveMetadata()).catch(error =>
                console.error('WTracker: could not save chat binding', error));
        }
    }
    function setChatBinding(id) {
        const current = chatContext();
        if (!current || !store()[id]) return false;
        current.chatMetadata[CHATTRACKER] ||= {};
        current.chatMetadata[CHATTRACKER][BINDKEY] = id;
        activeChatKey = chatIdentity();
        activeChatBinding = id;
        persistChatMetadata(current);
        switchTo(id);
        scheduleDraw();
        return true;
    }
    function removeChatBinding() {
        const current = chatContext();
        if (!current?.chatMetadata?.[CHATTRACKER]?.[BINDKEY]) return;
        delete current.chatMetadata[CHATTRACKER][BINDKEY];
        activeChatBinding = null;
        persistChatMetadata(current);
        switchTo(settings.defaultConfigurationProfile);
        scheduleDraw();
    }
    function syncChat() {
        const key = chatIdentity();
        let selected = boundId();
        if (selected && !store()[selected]) {
            const current = chatContext();
            if (current?.chatMetadata?.[CHATTRACKER]) {
                delete current.chatMetadata[CHATTRACKER][BINDKEY];
                persistChatMetadata(current);
            }
            selected = null;
        }
        // Checking both the chat and its binding also handles cases in which
        // the host supplies chatMetadata shortly after the chat ID changes.
        if (key === activeChatKey && selected === activeChatBinding &&
            activeId() === (selected || settings.defaultConfigurationProfile)) {
            scheduleDraw();
            return;
        }
        activeChatKey = key;
        activeChatBinding = selected;
        switchTo(selected || settings.defaultConfigurationProfile);
        scheduleDraw();
    }

    // Observe the settings drawer because native WTracker is rendered by React,
    // which may replace our additive controls during a profile switch.
    let scheduled = false;
    function scheduleDraw() {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; draw(); });
    }
    function draw() {
        const container = document.querySelector('#wtracker-react-settings-root .wtracker-container');
        if (!container) return;
        if (container.querySelector('#wtracker-config-profiles')) {
            updateControls(container.querySelector('#wtracker-config-profiles'));
            return;
        }
        const panel = document.createElement('fieldset');
        panel.id = 'wtracker-config-profiles';
        panel.className = 'wtracker-profile-panel';
        panel.innerHTML = `
          <legend>Configuration Profiles</legend>
          <label for="wtracker-profile-select">Saved settings profile</label>
          <select id="wtracker-profile-select" class="text_pole"></select>
          <div class="wtracker-profile-actions">
            <button class="menu_button" type="button" data-action="new">New</button>
            <button class="menu_button" type="button" data-action="rename">Rename</button>
            <button class="menu_button" type="button" data-action="delete">Delete</button>
            <button class="menu_button" type="button" data-action="export">Export JSON</button>
            <button class="menu_button" type="button" data-action="import">Import JSON</button>
          </div>
          <input type="file" accept=".json,application/json" style="display:none" aria-label="Import WTracker profile" />
          <div class="wtracker-profile-chat">
            <span data-chat-status></span>
            <div class="wtracker-profile-actions">
              <button class="menu_button" type="button" data-action="bind">Bind selected to this chat</button>
              <button class="menu_button" type="button" data-action="unbind">Unbind</button>
            </div>
          </div>
          <small>Edits below are saved automatically in the selected profile. A bound profile loads when this chat opens. Imported connection profile IDs must exist on this installation.</small>
          <div data-profile-message role="status" class="wtracker-profile-message"></div>`;
        container.prepend(panel);
        panel.querySelector('#wtracker-profile-select').addEventListener('change', event => {
            switchTo(event.target.value, !boundId());
        });
        panel.querySelector('input[type=file]').addEventListener('change', async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const profile = validateProfile(JSON.parse(await file.text()));
                const id = uuid();
                store()[id] = profile;
                save();
                switchTo(id, !boundId());
                notify(`Imported: ${profile.name}`);
            } catch (error) {
                notify(`Import failed: ${error.message}`);
            } finally {
                event.target.value = '';
            }
        });
        panel.addEventListener('click', async event => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            event.stopPropagation();
            switch (button.dataset.action) {
                case 'new': {
                    const name = window.prompt('Name of new settings profile:', 'New profile')?.trim();
                    if (!name) return;
                    const id = uuid();
                    store()[id] = { name, config: snapshot(settings) };
                    save();
                    switchTo(id, !boundId());
                    notify(`Created: ${name}`);
                    break;
                }
                case 'rename': {
                    const name = window.prompt('Rename settings profile:', store()[activeId()].name)?.trim();
                    if (!name) return;
                    store()[activeId()].name = name;
                    save();
                    updateControls();
                    notify(`Renamed: ${name}`);
                    break;
                }
                case 'delete': {
                    if (Object.keys(store()).length <= 1) { notify('At least one profile is required.'); return; }
                    const confirmed = await SillyTavern.getContext().Popup.show.confirm(
                        'Delete configuration profile',
                        `Delete “${store()[activeId()].name}”? Existing tracker messages will remain.`,
                    );
                    if (!confirmed) return;
                    const removedId = activeId();
                    delete store()[removedId];
                    const fallback = Object.keys(store())[0];
                    if (settings.defaultConfigurationProfile === removedId) settings.defaultConfigurationProfile = fallback;
                    if (boundId() === removedId) {
                        const current = chatContext();
                        delete current.chatMetadata[CHATTRACKER][BINDKEY];
                        persistChatMetadata(current);
                    }
                    switchTo(settings.defaultConfigurationProfile);
                    notify('Profile deleted.');
                    break;
                }
                case 'export': {
                    const profile = store()[activeId()];
                    const payload = {type:'SillyTavern-WTracker-configuration-profile', formatVersion:1,
                        name: profile.name, config:clone(profile.config)};
                    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `WTracker-${profile.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '_').slice(0, 60)}.json`;
                    document.body.append(link);
                    link.click();
                    link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    notify('Profile exported.');
                    break;
                }
                case 'import': panel.querySelector('input[type=file]').click(); break;
                case 'bind':
                    if (setChatBinding(activeId())) notify('Profile bound to this chat.');
                    else notify('Open a chat first.');
                    break;
                case 'unbind':
                    removeChatBinding();
                    notify('Chat binding removed.');
                    break;
            }
            scheduleDraw();
        });
        updateControls(panel);
    }
    function updateControls(panel = document.getElementById('wtracker-config-profiles')) {
        if (!panel) return;
        const select = panel.querySelector('#wtracker-profile-select');
        // DOM options instead of interpolated user strings: no HTML injection.
        select.replaceChildren(...Object.entries(store()).map(([id, profile]) => new Option(profile.name, id)));
        select.value = activeId();
        const linkedId = boundId();
        panel.querySelector('[data-chat-status]').textContent = !chatContext()
            ? 'Open a chat to bind a profile.'
            : linkedId ? `This chat: ${store()[linkedId]?.name || 'missing profile'}`
              : 'This chat: no binding (uses global default)';
        panel.querySelector('[data-action=bind]').disabled = !chatContext();
        panel.querySelector('[data-action=unbind]').disabled = !linkedId;
    }
    function notify(message) {
        const element = document.querySelector('#wtracker-config-profiles [data-profile-message]');
        if (element) element.textContent = message;
    }

    const root = document.getElementById('wtracker-react-settings-root');
    if (root) {
        const observer = new MutationObserver(() => {
            if (!document.getElementById('wtracker-config-profiles')) scheduleDraw();
        });
        observer.observe(root, { childList: true, subtree: true });
    }
    scheduleDraw();
    context.eventSource.on(context.eventTypes?.CHAT_CHANGED || context.event_types?.CHAT_CHANGED || 'chat_id_changed', syncChat);
    // Cheap consistency check when returning to the extension settings after
    // a chat transition. It does not poll and does not remount unnecessarily.
    const settingsRoot = document.getElementById('wtracker-react-settings-root');
    settingsRoot?.addEventListener('pointerdown', () => {
        if (chatIdentity() !== activeChatKey) syncChat();
    }, true);
    // The original module subscribes asynchronously after loading a template;
    // this handler is independent and runs when a chat is opened.
    syncChat();
    return { switchTo, setChatBinding, removeChatBinding, syncChat, snapshot: () => snapshot(settings) };
}

// Instantiated after WTracker has loaded its normal settings manager.
globalThis.__wtrackerProfileAddon = { init: startAddon, validateProfile };
