/**
 * Chapter 22 — Run configurations, static contract checks (@contract).
 *
 * UI-07: source-text assertions only. A green run here proves registration
 * strings / schema keywords exist — it never proves the user flow works.
 * UI acceptance for this chapter lives in ch22-runconfig.spec.ts (@ui).
 */
import { test } from '@playwright/test';
import { expectContract } from './campaign';

const W = 'packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx';
const S = 'packages/theia-product/src/main/browser/kairo-run-configuration-service.ts';
const SCHEMA = 'packages/config-schema/src/run-configuration.ts';

test.describe.serial('ch22 run configurations @contract', () => {
  test('TC-RUN-C01 widget registration markers', async () => {
    expectContract(W, 'configuration');
  });
  test('TC-RUN-C02 default tomcat template', async () => {
    expectContract(S, 'tomcat', 'mode');
  });
  test('TC-RUN-C03 six form groups', async () => {
    expectContract(W, 'General', 'Server', 'Build', 'Deploy');
  });
  test('TC-RUN-C04 unique name validation', async () => {
    expectContract(SCHEMA, /duplicate|unique/i);
  });
  test('TC-RUN-C05 httpPort != debugPort', async () => {
    expectContract(S, 'httpPort', 'debugPort');
  });
  test('TC-RUN-C06 artifact path traversal rejected', async () => {
    expectContract(SCHEMA, '..');
  });
  test('TC-RUN-C07 env secrets must use ${env:}', async () => {
    expectContract(SCHEMA, 'PASSWORD', '${env:');
  });
  test('TC-RUN-C08 env line format', async () => {
    expectContract(S, 'NAME=value');
  });
  test('TC-RUN-C09 beforeLaunch build before deploy', async () => {
    expectContract(S, 'beforeLaunch');
  });
  test('TC-RUN-C10 ID immutable while editing', async () => {
    expectContract(S, 'cannot be changed');
  });
  test('TC-RUN-C11 delete confirm', async () => {
    expectContract(S, /delete/i);
  });
  test('TC-RUN-C12 Run button launch', async () => {
    expectContract(S, 'launch');
  });
  test('TC-RUN-C13 Debug one-click', async () => {
    expectContract(S, 'debug', 'suspend');
  });
  test('TC-RUN-C14 port occupied banner', async () => {
    expectContract(S, 'occupied');
  });
  test('TC-RUN-C15 mutex in-progress', async () => {
    expectContract(S, 'already in progress');
  });
  test('TC-RUN-C16 project mismatch', async () => {
    expectContract(S, 'Select project');
  });
  test('TC-RUN-C17 summary panel', async () => {
    expectContract(W, 'JDWP');
  });
  test('TC-RUN-C18 default badge', async () => {
    expectContract(S, /selectedConfigurationId|default/i);
  });
  test('TC-RUN-C19 canonical JSON serialization', async () => {
    expectContract(SCHEMA, 'localeCompare');
  });
});
