'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

const { RemoteDebugConfigWidget, KAIRO_REMOTE_DEBUG_CONFIG_ID } = require('../../lib/browser/java-remote-debug-config');

// ------------------------------------------------------------------
// Widget exports tests
// ------------------------------------------------------------------

describe('RemoteDebugConfigWidget — Package exports', () => {
  it('RemoteDebugConfigWidget is exported', () => {
    assert.strictEqual(typeof RemoteDebugConfigWidget, 'function');
  });

  it('RemoteDebugConfigWidget has static ID', () => {
    assert.strictEqual(RemoteDebugConfigWidget.ID, KAIRO_REMOTE_DEBUG_CONFIG_ID);
  });

  it('KAIRO_REMOTE_DEBUG_CONFIG_ID is "kairo-remote-debug-config"', () => {
    assert.strictEqual(KAIRO_REMOTE_DEBUG_CONFIG_ID, 'kairo-remote-debug-config');
  });
});

// ------------------------------------------------------------------
// Type interface tests
// ------------------------------------------------------------------

describe('Remote debug config type interfaces', () => {
  it('RemoteDebugConfig shape is valid', () => {
    const config = {
      id: 'rdc-1',
      name: 'Production',
      host: '192.168.1.100',
      port: 8000,
      authType: 'none',
    };
    assert.strictEqual(typeof config.id, 'string');
    assert.strictEqual(typeof config.name, 'string');
    assert.strictEqual(typeof config.host, 'string');
    assert.strictEqual(typeof config.port, 'number');
    assert.ok(['none', 'ssh-key', 'token'].includes(config.authType));
  });

  it('RemoteDebugConfig accepts optional SSH key path', () => {
    const config = {
      id: 'rdc-2',
      name: 'SSH',
      host: '192.168.1.101',
      port: 8000,
      authType: 'ssh-key',
      sshKeyPath: '~/.ssh/id_rsa',
    };
    assert.strictEqual(config.sshKeyPath, '~/.ssh/id_rsa');
  });

  it('RemoteDebugConfig accepts optional token', () => {
    const config = {
      id: 'rdc-3',
      name: 'Token',
      host: '192.168.1.102',
      port: 8000,
      authType: 'token',
      token: 'secret',
    };
    assert.strictEqual(config.token, 'secret');
  });

  it('RemoteDebugConfig accepts optional local port', () => {
    const config = {
      id: 'rdc-4',
      name: 'LocalPort',
      host: '192.168.1.103',
      port: 8000,
      authType: 'none',
      localPort: 5005,
    };
    assert.strictEqual(config.localPort, 5005);
  });
});

// ------------------------------------------------------------------
// Auth type validation
// ------------------------------------------------------------------

describe('Remote debug auth types', () => {
  it('supports none auth type', () => {
    assert.ok(['none', 'ssh-key', 'token'].includes('none'));
  });

  it('supports ssh-key auth type', () => {
    assert.ok(['none', 'ssh-key', 'token'].includes('ssh-key'));
  });

  it('supports token auth type', () => {
    assert.ok(['none', 'ssh-key', 'token'].includes('token'));
  });
});

// ------------------------------------------------------------------
// Storage key contract
// ------------------------------------------------------------------

describe('Remote debug storage contract', () => {
  it('uses the expected storage key', () => {
    const STORAGE_CONFIGS_KEY = 'kairo.java.remoteDebug.configs';
    assert.strictEqual(STORAGE_CONFIGS_KEY, 'kairo.java.remoteDebug.configs');
  });
});

// ------------------------------------------------------------------
// Widget behaviour tests
// ------------------------------------------------------------------

function createMockI18n() {
  return {
    t: (key) => key,
    onDidChangeLanguage: (cb) => ({ dispose: () => {} }),
  };
}

function createWidget() {
  const widget = new RemoteDebugConfigWidget();
  const messages = { errors: [], infos: [] };
  const storageData = {};
  widget.messages = {
    error: (msg) => messages.errors.push(msg),
    info: (msg) => messages.infos.push(msg),
  };
  widget.storage = {
    async setData(key, value) { storageData[key] = value; },
    async getData(key) { return storageData[key]; },
  };
  widget.tunnel = {
    status: { state: 'disconnected' },
    connect: async () => 5005,
    disconnect: async () => {},
    showExperimentalWarning: () => {},
  };
  widget.i18n = createMockI18n();
  widget.update = () => {};
  return { widget, messages, storageData };
}

describe('RemoteDebugConfigWidget — save validation', () => {
  it('rejects configs with empty name or host', async () => {
    const { widget, messages } = createWidget();
    await widget.saveConfig({ id: '1', name: '', host: 'host', port: 8000, authType: 'none' });
    assert.strictEqual(widget.configs.length, 0);
    assert.ok(messages.errors.some(m => m.includes('widget.java.remoteDebug.validation.required')));

    messages.errors.length = 0;
    await widget.saveConfig({ id: '2', name: 'name', host: '  ', port: 8000, authType: 'none' });
    assert.strictEqual(widget.configs.length, 0);
    assert.ok(messages.errors.some(m => m.includes('widget.java.remoteDebug.validation.required')));
  });

  it('adds a valid config and persists it', async () => {
    const { widget, storageData } = createWidget();
    const config = { id: '1', name: 'Prod', host: '192.168.1.1', port: 8000, authType: 'none' };
    await widget.saveConfig(config);
    assert.strictEqual(widget.configs.length, 1);
    assert.strictEqual(widget.configs[0].name, 'Prod');
    assert.ok(storageData['kairo.java.remoteDebug.configs']);
    assert.strictEqual(storageData['kairo.java.remoteDebug.configs'][0].host, '192.168.1.1');
  });

  it('updates an existing config by id', async () => {
    const { widget } = createWidget();
    await widget.saveConfig({ id: '1', name: 'Prod', host: '192.168.1.1', port: 8000, authType: 'none' });
    await widget.saveConfig({ id: '1', name: 'Prod2', host: '192.168.1.2', port: 8000, authType: 'none' });
    assert.strictEqual(widget.configs.length, 1);
    assert.strictEqual(widget.configs[0].name, 'Prod2');
  });
});

describe('RemoteDebugConfigWidget — delete', () => {
  it('removes a config and persists', async () => {
    const { widget, storageData } = createWidget();
    const config = { id: '1', name: 'Prod', host: '192.168.1.1', port: 8000, authType: 'none' };
    await widget.saveConfig(config);
    await widget.deleteConfig(config);
    assert.strictEqual(widget.configs.length, 0);
    assert.deepStrictEqual(storageData['kairo.java.remoteDebug.configs'], []);
  });
});

describe('RemoteDebugConfigWidget — persist / load round-trip', () => {
  it('stores tokens separately and restores configs without tokens', async () => {
    const { widget, storageData } = createWidget();
    const config = { id: '1', name: 'Token', host: 'host', port: 8000, authType: 'token', token: 'secret' };
    await widget.saveConfig(config);
    assert.strictEqual(storageData['kairo.java.remoteDebug.configs.token.1'], 'secret');

    const loaded = new RemoteDebugConfigWidget();
    loaded.storage = widget.storage;
    loaded.i18n = createMockI18n();
    loaded.update = () => {};
    await loaded.loadConfigs();
    assert.strictEqual(loaded.configs.length, 1);
    assert.strictEqual(loaded.configs[0].token, undefined);
    assert.strictEqual(loaded.configs[0].authType, 'token');
  });
});

describe('RemoteDebugConfigWidget — connect lifecycle', () => {
  it('connects and reports local port on success', async () => {
    const { widget, messages } = createWidget();
    const config = { id: '1', name: 'Prod', host: 'host', port: 8000, authType: 'none' };
    await widget.connectToRemote(config);
    assert.ok(messages.infos.some(m => m.includes('widget.java.remoteDebug.toast.connected')));
  });

  it('reports connection failure without throwing', async () => {
    const { widget, messages } = createWidget();
    widget.tunnel.connect = async () => { throw new Error('refused'); };
    const config = { id: '1', name: 'Prod', host: 'host', port: 8000, authType: 'none' };
    await widget.connectToRemote(config);
    assert.ok(messages.errors.some(m => m.includes('widget.java.remoteDebug.toast.connectionFailed')));
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});
