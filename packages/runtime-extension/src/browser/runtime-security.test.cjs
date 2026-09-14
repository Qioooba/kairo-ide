'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  AgentEndpointValidator,
  WorkspaceTrustManager,
  WorkspaceUntrustedError,
  DiagnosticLogRedactor,
  DEFAULT_ALLOWED_HOSTS,
} = require('../../lib/browser/runtime-security');

const {
  RuntimeConnectionService,
} = require('../../lib/browser/runtime-connection-service');

describe('Runtime Security - PR16 (F24 / T51 ~ T53)', () => {

  // =========================================================================
  // T51: Agent Endpoint Validation & Secret Isolation
  // =========================================================================
  describe('T51: AgentEndpointValidator', () => {
    test('permits loopback addresses (127.0.0.1, localhost, [::1])', () => {
      const urls = [
        'http://127.0.0.1:18080',
        'http://localhost:18080/api/v1',
        'http://[::1]:18080',
        'https://127.0.0.1:8443',
      ];

      for (const u of urls) {
        const res = AgentEndpointValidator.isAllowedAgentUrl(u);
        assert.strictEqual(res.allowed, true, `Expected ${u} to be allowed`);
        assert.ok(res.host);
      }
    });

    test('rejects external or unapproved endpoints', () => {
      const untrustedUrls = [
        'http://evil.com:18080',
        'https://attacker.example.org/api',
        'http://192.168.1.50:18080',
        'http://10.0.0.1:8080',
      ];

      for (const u of untrustedUrls) {
        const res = AgentEndpointValidator.isAllowedAgentUrl(u);
        assert.strictEqual(res.allowed, false, `Expected ${u} to be blocked`);
        assert.ok(res.reason?.includes('not on the approved endpoint allowlist'));
      }
    });

    test('supports custom allowed hosts', () => {
      const customUrl = 'http://trusted-internal-agent.corp:18080';
      const before = AgentEndpointValidator.isAllowedAgentUrl(customUrl);
      assert.strictEqual(before.allowed, false);

      const after = AgentEndpointValidator.isAllowedAgentUrl(customUrl, ['trusted-internal-agent.corp']);
      assert.strictEqual(after.allowed, true);
    });

    test('handles malformed and empty URLs gracefully', () => {
      assert.strictEqual(AgentEndpointValidator.isAllowedAgentUrl('').allowed, false);
      assert.strictEqual(AgentEndpointValidator.isAllowedAgentUrl('   ').allowed, false);
      assert.strictEqual(AgentEndpointValidator.isAllowedAgentUrl('not a url').allowed, false);
    });

    test('sanitizeAgentUrl returns input when valid or fallback when blocked', () => {
      assert.strictEqual(
        AgentEndpointValidator.sanitizeAgentUrl('http://127.0.0.1:18080'),
        'http://127.0.0.1:18080',
      );
      assert.strictEqual(
        AgentEndpointValidator.sanitizeAgentUrl('http://malicious.org:9999'),
        'http://127.0.0.1:18080',
      );
      assert.strictEqual(
        AgentEndpointValidator.sanitizeAgentUrl('http://malicious.org:9999', 'http://localhost:8080'),
        'http://localhost:8080',
      );
    });

    test('RuntimeConnectionService: refuses to bind secret to untrusted endpoint on initialize', () => {
      const service = new RuntimeConnectionService();
      // Initialize with untrusted host
      service.initialize('http://evil.com:18080', 'super-secret-token');

      // Secret must be empty and baseUrl must NOT be set to untrusted host
      assert.ok(!service.getAgentSecret());
      assert.notStrictEqual(service.baseUrl(), 'http://evil.com:18080');

      // Initialize with trusted loopback host
      service.initialize('http://127.0.0.1:18080', 'super-secret-token');
      assert.strictEqual(service.getAgentSecret(), 'super-secret-token');
      assert.strictEqual(service.baseUrl(), 'http://127.0.0.1:18080');
    });
  });

  // =========================================================================
  // T52: Workspace Trust Manager
  // =========================================================================
  describe('T52: WorkspaceTrustManager', () => {
    test('defaults to untrusted for unconfigured workspaces (secure by default)', () => {
      const mgr = new WorkspaceTrustManager();
      assert.strictEqual(mgr.getTrustState('file:///c:/projects/unknown'), 'untrusted');
      assert.strictEqual(mgr.isWorkspaceTrusted('file:///c:/projects/unknown'), false);
      assert.strictEqual(mgr.canExecute('file:///c:/projects/unknown', 'build_script'), false);
    });

    test('grantTrust enables operations and notifies listeners', () => {
      const mgr = new WorkspaceTrustManager();
      const events = [];
      const sub = mgr.onDidTrustChange(e => events.push(e));

      const uri = 'file:///c:/projects/my-safe-repo';
      mgr.grantTrust(uri);

      assert.strictEqual(mgr.getTrustState(uri), 'trusted');
      assert.strictEqual(mgr.isWorkspaceTrusted(uri), true);
      assert.strictEqual(mgr.canExecute(uri, 'server_autostart'), true);

      // Listener fired
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].state, 'trusted');

      // Assert does not throw
      assert.doesNotThrow(() => {
        mgr.assertOperationAllowed(uri, 'build_script');
      });

      sub.dispose();
    });

    test('assertOperationAllowed throws WorkspaceUntrustedError when workspace is untrusted', () => {
      const mgr = new WorkspaceTrustManager();
      const uri = 'file:///c:/projects/untrusted-repo';

      assert.throws(
        () => mgr.assertOperationAllowed(uri, 'build_script'),
        (err) => {
          assert.ok(err instanceof WorkspaceUntrustedError);
          assert.strictEqual(err.name, 'WorkspaceUntrustedError');
          assert.strictEqual(err.workspaceUri, uri);
          assert.strictEqual(err.operation, 'build_script');
          assert.ok(err.message.includes('Explicit user trust confirmation is required'));
          return true;
        },
      );
    });

    test('revokeTrust transitions workspace back to untrusted', () => {
      const mgr = new WorkspaceTrustManager();
      const uri = 'file:///c:/projects/my-repo';
      mgr.grantTrust(uri);
      assert.strictEqual(mgr.isWorkspaceTrusted(uri), true);

      mgr.revokeTrust(uri);
      assert.strictEqual(mgr.isWorkspaceTrusted(uri), false);
      assert.strictEqual(mgr.getTrustState(uri), 'untrusted');

      assert.throws(() => {
        mgr.assertOperationAllowed(uri, 'server_autostart');
      }, WorkspaceUntrustedError);
    });
  });

  // =========================================================================
  // T53: Diagnostic Log Redactor & Credential Masking
  // =========================================================================
  describe('T53: DiagnosticLogRedactor', () => {
    test('redactString masks X-Kairo-Secret headers', () => {
      const log = '2026-09-13T10:00:00Z Request headers: X-Kairo-Secret: mySecretToken123, Content-Type: application/json';
      const redacted = DiagnosticLogRedactor.redactString(log);
      assert.ok(!redacted.includes('mySecretToken123'));
      assert.ok(redacted.includes('X-Kairo-Secret: [REDACTED]'));
    });

    test('redactString masks Authorization Bearer / Basic tokens', () => {
      const bearerLog = 'Sending HTTP request Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test to server';
      const redactedBearer = DiagnosticLogRedactor.redactString(bearerLog);
      assert.ok(!redactedBearer.includes('eyJhbGciOiJIUzI1NiJ9.test'));
      assert.ok(redactedBearer.includes('Authorization: Bearer [REDACTED]'));

      const basicLog = 'Authorization: Basic dXNlcjpwYXNz';
      const redactedBasic = DiagnosticLogRedactor.redactString(basicLog);
      assert.ok(!redactedBasic.includes('dXNlcjpwYXNz'));
      assert.ok(redactedBasic.includes('Authorization: Basic [REDACTED]'));
    });

    test('redactString masks query parameter secrets and passwords', () => {
      const log = 'Connecting to http://127.0.0.1:18080/events?secret=verysecret&workspaceId=ws1&token=tok789';
      const redacted = DiagnosticLogRedactor.redactString(log);
      assert.ok(!redacted.includes('verysecret'));
      assert.ok(!redacted.includes('tok789'));
      assert.ok(redacted.includes('?secret=[REDACTED]'));
      assert.ok(redacted.includes('&token=[REDACTED]'));
      assert.ok(redacted.includes('workspaceId=ws1'));
    });

    test('redactString masks JDBC passwords', () => {
      const log = 'Connecting to jdbc:oracle:thin:@//localhost:1521/xe;user=scott;password=tiger;';
      const redacted = DiagnosticLogRedactor.redactString(log);
      assert.ok(!redacted.includes('tiger'));
      assert.ok(redacted.includes('password=[REDACTED]'));
      assert.ok(redacted.includes('user=scott'));
    });

    test('redactString masks WebSocket subprotocol secret token', () => {
      const log = 'Upgrading WS with protocols ["kairo-secret-v1", "topsecrettoken"]';
      const redacted = DiagnosticLogRedactor.redactString(log);
      assert.ok(!redacted.includes('topsecrettoken'));
      assert.ok(redacted.includes('["kairo-secret-v1", "[REDACTED]"]'));
    });

    test('redactObject recursively masks sensitive fields', () => {
      const payload = {
        serverName: 'Tomcat 6.0',
        port: 8080,
        auth: {
          username: 'admin',
          password: 'mypassword',
          nested: {
            bearerToken: 'secretbearer',
            safeValue: 42,
          },
        },
        api_key: 'key12345',
      };

      const redacted = DiagnosticLogRedactor.redactObject(payload);
      assert.strictEqual(redacted.serverName, 'Tomcat 6.0');
      assert.strictEqual(redacted.port, 8080);
      assert.strictEqual(redacted.auth.username, 'admin');
      assert.strictEqual(redacted.auth.password, '[REDACTED]');
      assert.strictEqual(redacted.auth.nested.bearerToken, '[REDACTED]');
      assert.strictEqual(redacted.auth.nested.safeValue, 42);
      assert.strictEqual(redacted.api_key, '[REDACTED]');
    });

    test('redactString masks escaped JSON quotes and escaped WS protocols', () => {
      const escapedJson = '{"data": "{\\"password\\": \\"secret-12345\\", \\"apiKey\\": \\"key-999\\"}"}';
      const redacted = DiagnosticLogRedactor.redactString(escapedJson);
      assert.ok(!redacted.includes('secret-12345'));
      assert.ok(!redacted.includes('key-999'));
      assert.ok(redacted.includes('\\"password\\": \\"[REDACTED]\\"'));
      assert.ok(redacted.includes('\\"apiKey\\": \\"[REDACTED]\\"'));

      const escapedWs = 'WS handshake protocols: [\\"kairo-secret-v1\\", \\"ws-secret-xyz\\"]';
      const redactedWs = DiagnosticLogRedactor.redactString(escapedWs);
      assert.ok(!redactedWs.includes('ws-secret-xyz'));
      assert.ok(redactedWs.includes('[\\"kairo-secret-v1\\", \\"[REDACTED]\\"]'));
    });

    test('redactObject handles Set and Map instances without losing types', () => {
      const testSet = new Set(['safe-string', 'X-Kairo-Secret: secret999']);
      const redactedSet = DiagnosticLogRedactor.redactObject(testSet);
      assert.ok(redactedSet instanceof Set);
      assert.strictEqual(redactedSet.size, 2);
      const setArr = Array.from(redactedSet);
      assert.strictEqual(setArr[0], 'safe-string');
      assert.strictEqual(setArr[1], 'X-Kairo-Secret: [REDACTED]');

      const testMap = new Map([
        ['normalKey', 'safe-value'],
        ['password', 'plain-secret-pass'],
        ['nested', new Set(['Authorization: Bearer secret-tok'])],
      ]);
      const redactedMap = DiagnosticLogRedactor.redactObject(testMap);
      assert.ok(redactedMap instanceof Map);
      assert.strictEqual(redactedMap.get('normalKey'), 'safe-value');
      assert.strictEqual(redactedMap.get('password'), '[REDACTED]');
      const nestedSet = redactedMap.get('nested');
      assert.ok(nestedSet instanceof Set);
      assert.strictEqual(Array.from(nestedSet)[0], 'Authorization: Bearer [REDACTED]');
    });

    test('redactUrl sanitizes sensitive query params in URL', () => {
      const url = 'http://127.0.0.1:18080/deploy?token=secret123&env=production&secret=mykey';
      const redacted = DiagnosticLogRedactor.redactUrl(url);
      assert.ok(!redacted.includes('secret123'));
      assert.ok(!redacted.includes('mykey'));
      assert.ok(redacted.includes('token=%5BREDACTED%5D') || redacted.includes('token=[REDACTED]'));
      assert.ok(redacted.includes('env=production'));
    });
  });
});
