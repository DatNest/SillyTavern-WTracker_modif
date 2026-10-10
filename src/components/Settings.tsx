import { FC, ChangeEvent, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  STConnectionProfileSelect,
  STPresetSelect,
  STButton,
  STTextarea,
  PresetItem,
} from 'sillytavern-utils-lib/components/react';
import {
  ExtensionSettings,
  Schema,
  DEFAULT_PROMPT,
  DEFAULT_PROMPT_JSON,
  DEFAULT_PROMPT_XML,
  DEFAULT_SCHEMA_VALUE,
  DEFAULT_SCHEMA_HTML,
  PromptEngineeringMode,
  PromptSenderRole,
} from '../config.js';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { useForceUpdate } from '../hooks/useForceUpdate.js';
import {
  settingsManager, PROFILE_CHANGED_EVENT, allConfigurations, activeConfigurationId,
  saveConfigurationEdit, switchConfiguration, createConfiguration,
  renameConfiguration, deleteConfiguration, exportConfiguration, importConfiguration,
  getBoundConfigurationId, bindConfigurationToChat, unbindConfigurationFromChat,
  hasCurrentChat,
} from '../profile-manager.js';

// Re-export for the original main module and external integrations.
export { settingsManager } from '../profile-manager.js';

export const WTrackerSettings: FC = () => {
  const forceUpdate = useForceUpdate();
  const settings = settingsManager.getSettings();
  const [profileMessage, setProfileMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(settings.schemaPresets[settings.schemaPreset]?.value, null, 2) ?? '',
  );

  const updateAndRefresh = useCallback(
    (updater: (currentSettings: ExtensionSettings) => void) => {
      const currentSettings = settingsManager.getSettings();
      updater(currentSettings);
      saveConfigurationEdit();
      forceUpdate();
    },
    [forceUpdate],
  );

  // The active profile may change when the user opens a different chat.
  // Keep both the original controls and the schema editor in sync.
  useEffect(() => {
    const refresh = () => {
      const latest = settingsManager.getSettings();
      setSchemaText(JSON.stringify(latest.schemaPresets[latest.schemaPreset]?.value ?? {}, null, 2));
      forceUpdate();
    };
    document.addEventListener(PROFILE_CHANGED_EVENT, refresh);
    return () => document.removeEventListener(PROFILE_CHANGED_EVENT, refresh);
  }, [forceUpdate]);

  const chooseProfile = (id: string) => {
    if (switchConfiguration(id, !getBoundConfigurationId())) setProfileMessage('Profile selected.');
  };

  const createProfile = () => {
    const name = window.prompt('Name for the new WTracker settings profile:', 'New profile')?.trim();
    if (!name) return;
    createConfiguration(name);
    setProfileMessage(`Created profile: ${name}`);
  };

  const renameProfile = () => {
    const id = activeConfigurationId();
    const current = allConfigurations()[id];
    if (!current) return;
    const name = window.prompt('Rename WTracker profile:', current.name)?.trim();
    if (!name) return;
    renameConfiguration(id, name);
    setProfileMessage(`Renamed to: ${name}`);
  };

  const removeProfile = async () => {
    const id = activeConfigurationId();
    if (Object.keys(allConfigurations()).length <= 1) {
      setProfileMessage('Keep at least one settings profile.');
      return;
    }
    const agreed = await SillyTavern.getContext().Popup.show.confirm(
      'Delete configuration profile',
      `Delete "${allConfigurations()[id]?.name}"? This will not delete tracker messages.`,
    );
    if (!agreed) return;
    deleteConfiguration(id);
    setProfileMessage('Profile deleted.');
  };

  const downloadProfile = () => {
    const id = activeConfigurationId();
    const exported = exportConfiguration(id);
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WTracker-${exported.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '_').slice(0, 60)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setProfileMessage('Profile exported to JSON.');
  };

  const loadProfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = JSON.parse(await file.text());
      const id = importConfiguration(content);
      setProfileMessage(`Imported profile: ${allConfigurations()[id].name}`);
    } catch (error) {
      setProfileMessage(`Import failed: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
    } finally {
      event.target.value = '';
    }
  };

  const bindProfile = () => {
    if (bindConfigurationToChat(activeConfigurationId())) {
      setProfileMessage('This profile will now load automatically with this chat.');
    } else {
      setProfileMessage('Open a chat first to bind a profile.');
    }
  };

  const unbindProfile = () => {
    if (unbindConfigurationFromChat()) {
      // Restore the global fallback when this chat is no longer bound.
      const fallback = settingsManager.getSettings().defaultConfigurationProfile;
      if (fallback) switchConfiguration(fallback);
      setProfileMessage('Chat binding removed.');
    }
  };

  // Memoized data for the schema preset dropdown
  const schemaPresetItems = useMemo((): PresetItem[] => {
    return Object.entries(settings.schemaPresets).map(([value, preset]) => ({
      value,
      label: preset.name,
    }));
  }, [settings.schemaPresets]);

  // Handler for when a new schema preset is selected
  const handleSchemaPresetChange = (newValue?: string) => {
    const newPresetKey = newValue ?? 'default';
    const newPreset = settings.schemaPresets[newPresetKey];
    if (newPreset) {
      updateAndRefresh((settings) => {
        settings.schemaPreset = newPresetKey;
      });
      setSchemaText(JSON.stringify(newPreset.value, null, 2));
    }
  };

  // Handler for when the list of presets is modified (created, renamed, deleted)
  const handleSchemaPresetsListChange = (newItems: PresetItem[]) => {
    updateAndRefresh((s) => {
      const newPresets: Record<string, Schema> = {};
      newItems.forEach((item) => {
        newPresets[item.value] =
          s.schemaPresets[item.value] ?? structuredClone(s.schemaPresets[s.schemaPreset] ?? s.schemaPresets['default']);
        // Ensure name is updated on rename
        newPresets[item.value].name = item.label;
      });
      s.schemaPresets = newPresets;
    });
  };

  // Handler for the schema JSON textarea
  const handleSchemaValueChange = (newSchemaText: string) => {
    setSchemaText(newSchemaText); // Update UI immediately
    try {
      const parsedJson = JSON.parse(newSchemaText);
      updateAndRefresh((s) => {
        const preset = s.schemaPresets[s.schemaPreset];
        if (preset) {
          // Create a new presets object with the updated value
          s.schemaPresets = {
            ...s.schemaPresets,
            [s.schemaPreset]: { ...preset, value: parsedJson },
          };
        }
      });
    } catch (e) {
      // Invalid JSON, do nothing until it's valid. A visual error could be added.
    }
  };

  // Handler for the schema HTML textarea
  const handleSchemaHtmlChange = (newHtml: string) => {
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[s.schemaPreset];
      if (preset) {
        // Create a new presets object with the updated html
        s.schemaPresets = {
          ...s.schemaPresets,
          [s.schemaPreset]: { ...preset, html: newHtml },
        };
      }
    });
  };

  // Restore the current schema preset to its default values
  const restoreSchemaToDefault = async () => {
    const confirm = await SillyTavern.getContext().Popup.show.confirm(
      'Restore Default',
      'Are you sure you want to restore the default schema and HTML for this preset?',
    );
    if (!confirm) return;

    const currentPresetKey = settings.schemaPreset;
    updateAndRefresh((s) => {
      const preset = s.schemaPresets[currentPresetKey];
      if (preset) {
        s.schemaPresets = {
          ...s.schemaPresets,
          [currentPresetKey]: {
            ...preset,
            value: DEFAULT_SCHEMA_VALUE,
            html: DEFAULT_SCHEMA_HTML,
          },
        };
      }
    });
    setSchemaText(JSON.stringify(DEFAULT_SCHEMA_VALUE, null, 2));
  };

  return (
    <div className="wtracker-settings">
      <div className="inline-drawer">
        <div className="inline-drawer-toggle inline-drawer-header">
          <b>WTracker</b>
          <div className="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div className="inline-drawer-content">
          <div className="wtracker-container">
            <fieldset className="wtracker-profile-panel">
              <legend>Configuration Profiles</legend>
              <label htmlFor="wtracker-profile-selector">Saved settings profile</label>
              <select
                id="wtracker-profile-selector"
                className="text_pole"
                value={activeConfigurationId()}
                onChange={(e) => chooseProfile(e.target.value)}
              >
                {Object.entries(allConfigurations()).map(([id, profile]) => (
                  <option key={id} value={id}>{profile.name}</option>
                ))}
              </select>
              <div className="wtracker-profile-actions">
                <button className="menu_button" type="button" onClick={createProfile}>New</button>
                <button className="menu_button" type="button" onClick={renameProfile}>Rename</button>
                <button className="menu_button" type="button" onClick={removeProfile}>Delete</button>
                <button className="menu_button" type="button" onClick={downloadProfile}>Export JSON</button>
                <button className="menu_button" type="button" onClick={() => fileInputRef.current?.click()}>Import JSON</button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={loadProfile}
                aria-label="Import WTracker profile"
              />
              <div className="wtracker-profile-chat">
                <span>
                  {hasCurrentChat()
                    ? getBoundConfigurationId()
                      ? `This chat: ${allConfigurations()[getBoundConfigurationId()!]?.name ?? 'missing profile'}`
                      : 'This chat: no profile bound (uses global default)'
                    : 'Open a chat to bind a profile.'}
                </span>
                <div className="wtracker-profile-actions">
                  <button className="menu_button" type="button" disabled={!hasCurrentChat()} onClick={bindProfile}>
                    Bind selected to this chat
                  </button>
                  <button className="menu_button" type="button" disabled={!getBoundConfigurationId()} onClick={unbindProfile}>
                    Unbind
                  </button>
                </div>
              </div>
              <small>Changes to the controls below are saved in the selected profile. Chat bindings are automatic on chat switch. Import/export includes schemas, templates, prompts and connection profile ID.</small>
              {profileMessage && <div className="wtracker-profile-message" role="status">{profileMessage}</div>}
            </fieldset>
            <div className="setting-row">
              <label>Connection Profile</label>
              <STConnectionProfileSelect
                key={activeConfigurationId()}
                initialSelectedProfileId={settings.profileId}
                onChange={(profile) =>
                  updateAndRefresh((s) => {
                    s.profileId = profile?.id ?? '';
                  })
                }
              />
            </div>

            <div className="setting-row">
              <label>Auto Mode</label>
              <select
                className="text_pole"
                value={settings.autoMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.autoMode = e.target.value as AutoModeOptions;
                  })
                }
              >
                <option value="none">None</option>
                <option value="responses">Process responses</option>
                <option value="inputs">Process inputs</option>
                <option value="both">Process both</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Prompt Engineering</label>
              <select
                className="text_pole"
                value={settings.promptEngineeringMode}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptEngineeringMode = e.target.value as PromptEngineeringMode;
                  })
                }
              >
                <option value="native">Native API</option>
                <option value="json">Prompt Engineering (JSON)</option>
                <option value="xml">Prompt Engineering (XML)</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Prompt Sender Role</label>
              <select
                className="text_pole"
                value={settings.promptRole}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptRole = e.target.value as PromptSenderRole;
                  })
                }
              >
                <option value="user">User</option>
                <option value="assistant">Assistant</option>
              </select>
            </div>

            <div className="setting-row">
              <label>Schema Preset</label>
              <STPresetSelect
                label="Schema Preset"
                items={schemaPresetItems}
                value={settings.schemaPreset}
                onChange={handleSchemaPresetChange}
                onItemsChange={handleSchemaPresetsListChange}
                readOnlyValues={['default']}
                enableCreate
                enableDelete
                enableRename
              />

              <div className="title_restorable">
                <span>Schema</span>
                <STButton className="fa-solid fa-undo" title="Restore default" onClick={restoreSchemaToDefault} />
              </div>

              <STTextarea value={schemaText} onChange={(e) => handleSchemaValueChange(e.target.value)} rows={4} />
              <STTextarea
                value={settings.schemaPresets[settings.schemaPreset]?.html ?? ''}
                onChange={(e) => handleSchemaHtmlChange(e.target.value)}
                rows={4}
                placeholder="Enter your schema HTML here..."
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.prompt = DEFAULT_PROMPT;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.prompt}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.prompt = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt (JSON)</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.promptJson = DEFAULT_PROMPT_JSON;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.promptJson}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptJson = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <div className="title_restorable">
                <span>Prompt (XML)</span>
                <STButton
                  className="fa-solid fa-undo"
                  title="Restore main context template to default"
                  onClick={() =>
                    updateAndRefresh((s) => {
                      s.promptXml = DEFAULT_PROMPT_XML;
                    })
                  }
                />
              </div>
              <STTextarea
                value={settings.promptXml}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.promptXml = e.target.value;
                  })
                }
                rows={4}
              />
            </div>

            <div className="setting-row">
              <label>Max Response Tokens</label>
              <input
                type="number"
                className="text_pole"
                min="1"
                step="1"
                value={settings.maxResponseToken}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.maxResponseToken = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
            <div className="setting-row">
              <label>Include Last X Messages (0 means all, 1 means last)</label>
              <input
                type="number"
                className="text_pole"
                min="0"
                step="1"
                title="0 means all messages."
                value={settings.includeLastXMessages}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.includeLastXMessages = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
            <div className="setting-row">
              <label>Include Last X WTracker Messages</label>
              <input
                type="number"
                className="text_pole"
                min="0"
                step="1"
                title="0 means none."
                value={settings.includeLastXWTrackerMessages}
                onChange={(e) =>
                  updateAndRefresh((s) => {
                    s.includeLastXWTrackerMessages = parseInt(e.target.value) || 0;
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
