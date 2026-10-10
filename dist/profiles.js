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
    'sendTrackerStateToRoleplayModel',
];
const clone = value => structuredClone(value);
const snapshot = settings => Object.fromEntries(PROFILE_KEYS.map(key =>
    [key, key === 'sendTrackerStateToRoleplayModel' ? settings[key] === true : clone(settings[key])]));
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
        config: Object.fromEntries(PROFILE_KEYS.map(key =>
            [key, key === 'sendTrackerStateToRoleplayModel' ? c[key] === true : clone(c[key])])),
    };
}



const FIELD_TOOLTIPS = {
    'Connection Profile': 'Which SillyTavern connection profile WTracker uses for tracker generation.',
    'Auto Mode': 'Choose when WTracker runs automatically: never, on responses, on user inputs, or on both.',
    'Prompt Engineering': 'Select the prompting strategy used when asking the model to update WTracker.',
    'Prompt Sender Role': 'Controls whether WTracker sends its prompt as the user role or assistant role.',
    'Schema Preset': 'Reusable schema preset: contains the tracked data structure and the HTML card template.',
    'Schema': 'The JSON structure/example that tells WTracker what fields to track.',
    'Prompt': 'Main prompt template for native mode.',
    'Prompt (JSON)': 'Prompt template used in JSON prompt-engineering mode.',
    'Prompt (XML)': 'Prompt template used in XML prompt-engineering mode.',
    'Max Response Tokens': 'Maximum tokens WTracker may generate in its response.',
    'Include Last X Messages (0 means all, 1 means last)': 'How many recent chat messages to include. 0 means all available messages.',
    'Include Last X WTracker Messages': 'How many previous tracker states to include as extra context. 0 means none.',
    'Saved settings profile': 'Choose which complete WTracker configuration is currently active.',
};

const PROFILE_ACTION_META = {
    new: { icon: 'fa-plus', title: 'Create a new profile from the current settings' },
    rename: { icon: 'fa-pen', title: 'Rename the selected profile' },
    delete: { icon: 'fa-trash-can', title: 'Delete the selected profile' },
    default: { icon: 'fa-house', title: 'Use the selected profile as the fallback for chats without a binding' },
    export: { icon: 'fa-download', title: 'Export the selected profile to JSON' },
    import: { icon: 'fa-upload', title: 'Import a JSON settings profile' },
    bind: { icon: 'fa-link', title: 'Attach the selected profile to this chat' },
    unbind: { icon: 'fa-link-slash', title: 'Remove the profile binding from this chat' },
};

function addHelpIcon(node, tooltip) {
    if (!node || !tooltip) return;
    node.title = tooltip;
    if (node.querySelector('.wtracker-help-icon')) return;
    const icon = document.createElement('span');
    icon.className = 'wtracker-help-icon fa-regular fa-circle-question';
    icon.title = tooltip;
    icon.setAttribute('aria-hidden', 'true');
    node.append(' ');
    node.append(icon);
}

function makeSection(title, subtitle, icon, open = false) {
    const section = document.createElement('details');
    section.className = 'wtracker-ui-section';
    section.open = open;
    section.innerHTML = `
      <summary>
        <span class="fa-solid ${icon} wtracker-ui-section-icon" aria-hidden="true"></span>
        <span class="wtracker-ui-section-text">
          <span class="wtracker-ui-section-title">${title}</span>
          <span class="wtracker-ui-section-subtitle">${subtitle}</span>
        </span>
      </summary>
      <div class="wtracker-ui-section-body"></div>`;
    return section;
}

function decorateFieldLabels(scope) {
    scope.querySelectorAll('label').forEach(label => {
        const text = label.textContent?.trim();
        const tooltip = FIELD_TOOLTIPS[text];
        if (tooltip) addHelpIcon(label, tooltip);
    });
    scope.querySelectorAll('.title_restorable > span:first-child').forEach(span => {
        const text = span.textContent?.trim();
        const tooltip = FIELD_TOOLTIPS[text];
        if (tooltip) addHelpIcon(span, tooltip);
    });
    scope.querySelectorAll('select, input, textarea').forEach(control => {
        const row = control.closest('.setting-row, .wtracker-profile-panel');
        const label = row?.querySelector('label, .title_restorable > span:first-child');
        const text = label?.textContent?.replace(/\s+/g, ' ')?.trim();
        const tooltip = FIELD_TOOLTIPS[text];
        if (tooltip && !control.title) control.title = tooltip;
    });
}

function decorateProfilePanel(panel) {
    if (!panel || panel.dataset.compactDecorated === '1') return;
    panel.dataset.compactDecorated = '1';
    const legend = panel.querySelector('legend');
    if (legend && !legend.querySelector('.wtracker-profile-legend-icon')) {
        legend.innerHTML = `<span class="fa-solid fa-layer-group wtracker-profile-legend-icon" aria-hidden="true"></span><span>${legend.textContent}</span>`;
    }
    const chatStatus = panel.querySelector('[data-chat-status]');
    if (chatStatus && !chatStatus.closest('.wtracker-profile-status')) {
        const wrap = document.createElement('div');
        wrap.className = 'wtracker-profile-status';
        wrap.append(chatStatus);
        const debug = panel.querySelector('[data-chat-debug]');
        if (debug) wrap.append(debug);
        const actions = panel.querySelector('.wtracker-profile-chat .wtracker-profile-actions');
        if (actions) wrap.append(actions);
        panel.querySelector('.wtracker-profile-chat').replaceChildren(wrap);
    }
    panel.querySelectorAll('button[data-action]').forEach(button => {
        const meta = PROFILE_ACTION_META[button.dataset.action];
        if (!meta) return;
        button.title = meta.title;
        if (!button.querySelector('.fa-solid')) {
            const text = button.textContent;
            button.textContent = '';
            const icon = document.createElement('span');
            icon.className = `fa-solid ${meta.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.textContent = text;
            button.append(icon, label);
        }
    });
    const selectLabel = panel.querySelector('label[for="wtracker-profile-select"]');
    if (selectLabel) addHelpIcon(selectLabel, FIELD_TOOLTIPS['Saved settings profile']);
}

function decorateSettingsLayout(container) {
    if (!container || container.querySelector('.wtracker-ui-section')) {
        decorateFieldLabels(container);
        decorateProfilePanel(container.querySelector('#wtracker-config-profiles'));
        return;
    }
    decorateProfilePanel(container.querySelector('#wtracker-config-profiles'));
    const rows = Array.from(container.children).filter(node => node.classList?.contains('setting-row'));
    if (!rows.length) return;
    const groups = [
        { title: 'Generation', subtitle: 'Model and behaviour', icon: 'fa-sliders', open: true, items: rows.slice(0, 4) },
        { title: 'Schema & Card', subtitle: 'Tracked data and visual template', icon: 'fa-table-list', open: false, items: rows.slice(4, 5) },
        { title: 'Prompt Templates', subtitle: 'Instructions used by the model', icon: 'fa-file-lines', open: false, items: rows.slice(5, 8) },
        { title: 'Context Limits', subtitle: 'How much recent history is included', icon: 'fa-gauge-high', open: false, items: rows.slice(8) },
    ];
    groups.forEach(group => {
        if (!group.items.length) return;
        const section = makeSection(group.title, group.subtitle, group.icon, group.open);
        const body = section.querySelector('.wtracker-ui-section-body');
        group.items.forEach(row => body.append(row));
        if (group.title === 'Generation') {
            const row = document.createElement('label');
            row.className = 'wtracker-roleplay-injection-row';
            row.title = 'When enabled, the last tracker JSON is sent to the main roleplay model as a user message. Leave disabled to prevent technical JSON appearing in roleplay responses. WTracker Qwen still receives its previous tracker states.';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = 'wtracker-roleplay-injection';
            checkbox.checked = settings.sendTrackerStateToRoleplayModel === true;
            checkbox.addEventListener('change', () => {
                const enabled = checkbox.checked;
                settings.sendTrackerStateToRoleplayModel = enabled;
                store()[activeId()].config.sendTrackerStateToRoleplayModel = enabled;
                save();
            });
            const text = document.createElement('span');
            text.className = 'wtracker-roleplay-injection-label';
            text.textContent = 'Send tracker JSON to roleplay model';
            const help = document.createElement('span');
            help.className = 'fa-regular fa-circle-question wtracker-help-icon';
            help.setAttribute('aria-hidden', 'true');
            row.append(checkbox, text, help);
            body.append(row);
        }
        container.append(section);
    });
    decorateFieldLabels(container);
}

function startAddon(manager, context) {
    const settings = manager.getSettings();
    const saveNative = manager.saveSettings.bind(manager);
    let applying = false;
    let activeChatKey = null;
    let activeChatBinding = null;
    let observedChatEvents = 0;
    let lastChatEvent = 'none';
    let settingsFieldsDirty = false;
    const save = () => saveNative();
    const store = () => settings.configurationProfiles;
    const activeId = () => settings.activeConfigurationProfile;
    // Save chat-to-profile mappings in WTracker's extension settings, keyed by
    // both owner and chat file. Earlier versions depended on chatMetadata; on
    // some hosts its reference can remain stale during a chat transition.
    // Keeping a distinct key for each character/group also prevents collisions
    // when two characters have chats with the same filename.
    const chatContext = () => {
        const current = SillyTavern.getContext();
        if (!current) return null;
        const chatId = current.getCurrentChatId?.() ?? current.chatId;
        return chatId != null && chatId !== '' ? current : null;
    };
    // The identifier is read from the *fresh* ST context. CHAT_CHANGED also
    // supplies the authoritative new chat ID; use it when available rather
    // than polling and accidentally re-reading the outgoing chat.
    const chatIdentity = (eventChatId) => {
        const current = SillyTavern.getContext();
        if (!current) return null;
        const id = eventChatId != null && eventChatId !== ''
            ? eventChatId
            : current.getCurrentChatId?.() ?? current.chatId;
        if (id == null || id === '') return null;
        const group = current.groupId;
        if (group !== null && group !== undefined && group !== '') {
            return JSON.stringify(['group', String(group), String(id)]);
        }
        const charId = current.characterId;
        if (charId === null || charId === undefined || charId === '') return null;
        const avatar = current.characters?.[charId]?.avatar;
        return JSON.stringify(['character', String(avatar || charId), String(id)]);
    };
    const bindings = () => settings.configurationChatBindings;
    const boundId = (key = chatIdentity()) =>
        key && Object.hasOwn(bindings(), key) ? bindings()[key] : null;

    if (!isObject(settings.configurationProfiles) || !Object.keys(settings.configurationProfiles).length) {
        settings.configurationProfiles = {
            original: { name: 'My existing settings', config: snapshot(settings) },
        };
        settings.activeConfigurationProfile = 'original';
        settings.defaultConfigurationProfile = 'original';
    }
    if (!store()[activeId()]) settings.activeConfigurationProfile = Object.keys(store())[0];
    if (!store()[settings.defaultConfigurationProfile]) settings.defaultConfigurationProfile = activeId();
    if (!isObject(settings.configurationChatBindings)) settings.configurationChatBindings = {};
    // Backward-compatible default: do not inject tracker JSON into roleplay AI.
    // This field is per-profile; existing profile files can omit it.
    for (const profile of Object.values(store())) {
        profile.config.sendTrackerStateToRoleplayModel = profile.config.sendTrackerStateToRoleplayModel === true;
    }
    settings.sendTrackerStateToRoleplayModel = store()[activeId()].config.sendTrackerStateToRoleplayModel === true;
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
        if (configurationChanged) {
            settingsFieldsDirty = true;
            // If the settings are open, refresh the native controls. When
            // closed, do nothing costly on every CHAT_CHANGED event.
            refreshNativeSettingsIfVisible();
        }
        scheduleDraw();
        return true;
    }

    function refreshNativeSettingsIfVisible() {
        if (!settingsFieldsDirty || typeof globalThis.__wtrackerRefreshSettings !== 'function') return;
        const root = document.getElementById('wtracker-react-settings-root');
        const drawer = root?.querySelector('.inline-drawer-content');
        if (!root || !drawer || (typeof getComputedStyle === 'function'
            ? getComputedStyle(drawer).display === 'none'
            : drawer.style.display === 'none')) return;
        settingsFieldsDirty = false;
        // This affects ONLY the WTracker settings UI; never #chat or messages.
        if (typeof MutationObserver === 'undefined') {
            globalThis.__wtrackerRefreshSettings();
            return;
        }
        const observer = new MutationObserver(() => {
            const newDrawer = root.querySelector('.inline-drawer-content');
            if (!newDrawer || newDrawer === drawer) return;
            newDrawer.style.display = 'block';
            root.querySelector('.inline-drawer-icon')?.classList.remove('down');
            observer.disconnect();
        });
        observer.observe(root, { childList: true, subtree: true });
        globalThis.__wtrackerRefreshSettings();
        // One short cleanup for the UI observer (not chat polling).
        setTimeout(() => observer.disconnect(), 300);
    }

    function setChatBinding(id) {
        const key = chatIdentity();
        if (!key || !store()[id]) return false;
        // Overwrite only THIS chat's mapping. Other chat bindings are untouched.
        bindings()[key] = id;
        activeChatKey = key;
        activeChatBinding = id;
        save();
        switchTo(id);
        scheduleDraw();
        return true;
    }
    function removeChatBinding() {
        const key = chatIdentity();
        if (!key || !Object.hasOwn(bindings(), key)) return false;
        delete bindings()[key];
        activeChatKey = key;
        activeChatBinding = null;
        save();
        switchTo(settings.defaultConfigurationProfile);
        scheduleDraw();
        return true;
    }
    function syncChat(eventChatId) {
        const key = chatIdentity(eventChatId);
        let selected = boundId(key);
        if (selected && !store()[selected]) {
            delete bindings()[key];
            save();
            selected = null;
        }
        const targetId = selected || settings.defaultConfigurationProfile;
        // Ignore redundant events. In particular, do not remount React, walk
        // chat messages, or touch the #chat DOM just to display a profile.
        if (key === activeChatKey && selected === activeChatBinding && activeId() === targetId) {
            scheduleDraw();
            return;
        }
        activeChatKey = key;
        activeChatBinding = selected;
        switchTo(targetId);
        scheduleDraw();
    }
    function handleChatChanged(eventChatId) {
        observedChatEvents += 1;
        lastChatEvent = typeof eventChatId === 'string' || typeof eventChatId === 'number'
            ? String(eventChatId) : '(no chat id passed)';
        // SillyTavern officially publishes CHAT_CHANGED after loading the
        // chat. One event -> one settings switch, no 75/350ms timers.
        syncChat(eventChatId);
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
            <button class="menu_button" type="button" data-action="default">Set as default</button>
            <button class="menu_button" type="button" data-action="export">Export JSON</button>
            <button class="menu_button" type="button" data-action="import">Import JSON</button>
          </div>
          <input type="file" accept=".json,application/json" style="display:none" aria-label="Import WTracker profile" />
          <div class="wtracker-profile-chat">
            <span data-chat-status></span>
            <small data-chat-debug style="display:block;opacity:.7;overflow-wrap:anywhere"></small>
            <div class="wtracker-profile-actions">
              <button class="menu_button" type="button" data-action="bind">Bind selected to this chat</button>
              <button class="menu_button" type="button" data-action="unbind">Unbind</button>
            </div>
          </div>
          <small>Edits below are saved automatically in the selected profile. A bound profile loads when this chat opens. Imported connection profile IDs must exist on this installation.</small>
          <div data-profile-message role="status" class="wtracker-profile-message"></div>`;
        container.prepend(panel);
        panel.querySelector('#wtracker-profile-select').addEventListener('change', event => {
            // Choosing a profile is a preview, not a global default change.
            // Bind explicitly below or use the dedicated Default button.
            switchTo(event.target.value);
        });
        panel.querySelector('input[type=file]').addEventListener('change', async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const profile = validateProfile(JSON.parse(await file.text()));
                const id = uuid();
                store()[id] = profile;
                save();
                switchTo(id);
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
                    switchTo(id);
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
                case 'default': {
                    switchTo(activeId(), true);
                    notify('Default profile updated for unbound chats.');
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
                    for (const [key, id] of Object.entries(bindings())) {
                        if (id === removedId) delete bindings()[key];
                    }
                    activeChatBinding = boundId();
                    switchTo(activeChatBinding || settings.defaultConfigurationProfile);
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
                    if (removeChatBinding()) notify('Chat binding removed.');
                    break;
            }
            scheduleDraw();
        });
        updateControls(panel);
        decorateSettingsLayout(container);
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
        const debug = panel.querySelector('[data-chat-debug]');
        if (debug) {
            const key = chatIdentity();
            const id = activeId();
            debug.textContent = `Detected chat: ${key ? JSON.parse(key).at(-1) : '(none)'} · Active: ${store()[id]?.name || id} · Switch events: ${observedChatEvents}`;
            debug.title = `Last CHAT_CHANGED argument: ${lastChatEvent}; mapping key: ${key || '(none)'}`;
        }
        panel.querySelector('[data-action=bind]').disabled = !chatIdentity();
        panel.querySelector('[data-action=bind]').textContent = linkedId
            ? 'Bind selected (replace this chat binding)'
            : 'Bind selected to this chat';
        panel.querySelector('[data-action=unbind]').disabled = !linkedId;
        panel.querySelector('[data-action=default]').disabled = settings.defaultConfigurationProfile === activeId();
        const sendCheckbox = document.querySelector('#wtracker-roleplay-injection');
        if (sendCheckbox) sendCheckbox.checked = settings.sendTrackerStateToRoleplayModel === true;
        decorateProfilePanel(panel);
    }
    function notify(message) {
        const element = document.querySelector('#wtracker-config-profiles [data-profile-message]');
        if (element) element.textContent = message;
    }

    const root = document.getElementById('wtracker-react-settings-root');
    if (root && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
            if (!document.getElementById('wtracker-config-profiles')) scheduleDraw();
        });
        observer.observe(root, { childList: true, subtree: true });
        // Native controls may need refreshing when someone OPENS the drawer.
        // This is UI-only; it does not modify/reload a chat.
        root.addEventListener('click', event => {
            if (!event.target.closest('.inline-drawer-toggle')) return;
            queueMicrotask(() => refreshNativeSettingsIfVisible());
        });
    }
    scheduleDraw();
    const eventType = context.eventTypes?.CHAT_CHANGED || context.event_types?.CHAT_CHANGED;
    if (!eventType) console.error('[WTracker Profiles] CHAT_CHANGED event is not available.');
    else context.eventSource.on(eventType, handleChatChanged);
    // Initial sync once, after the original settings have been initialized.
    syncChat();

    return { switchTo, setChatBinding, removeChatBinding, syncChat, snapshot: () => snapshot(settings) };
}

// Instantiated after WTracker has loaded its normal settings manager.
globalThis.__wtrackerProfileAddon = { init: startAddon, validateProfile };
