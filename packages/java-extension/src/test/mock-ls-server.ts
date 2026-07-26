// SPDX-License-Identifier: Apache-2.0
//
// Mock Language Server — a minimal LSP server implementation
// that speaks the vscode-jsonrpc framing over stdin/stdout.
// Used by the Java Language Server Contribution tests to
// verify the start/stop lifecycle, message routing, and
// crash recovery without needing a real JDT LS process.
//
// This mock is a *real* Node.js child process entry point
// (not a fake inside the test process). The test spawns it
// via child_process.fork() and talks to it over IPC.

import { createInterface } from 'readline';

interface LSPMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const CAPABILITIES = {
  textDocumentSync: 1,
  completionProvider: {
    resolveProvider: true,
    triggerCharacters: ['.', '@', '#', '*', ' '],
  },
  hoverProvider: true,
  definitionProvider: true,
  referencesProvider: true,
  documentSymbolProvider: true,
  workspaceSymbolProvider: true,
  codeActionProvider: { codeActionKinds: ['quickfix', 'refactor', 'source'] },
  renameProvider: { prepareProvider: true },
  signatureHelpProvider: {
    triggerCharacters: ['(', ','],
    retriggerCharacters: [','],
  },
  implementationProvider: true,
  typeDefinitionProvider: true,
  callHierarchyProvider: true,
  typeHierarchyProvider: true,
  codeLensProvider: { resolveProvider: false },
  documentFormattingProvider: true,
  documentRangeFormattingProvider: true,
  inlayHintProvider: true,
  foldingRangeProvider: true,
  selectionRangeProvider: true,
  workspace: {
    workspaceFolders: {
      supported: true,
      changeNotifications: true,
    },
  },
};

const DIAGNOSTICS_SAMPLE = {
  uri: 'file:///workspace/Test.java',
  diagnostics: [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      severity: 1,
      code: 'test-001',
      source: 'Mock LS',
      message: 'Mock diagnostic: everything is fine.',
    },
  ],
};

const COMPLETION_SAMPLE = {
  isIncomplete: false,
  items: [
    {
      label: 'mockMethod',
      kind: 6,
      detail: 'void',
      documentation: 'A mock method for testing',
      sortText: '0',
      filterText: 'mockMethod',
      insertText: 'mockMethod()',
      insertTextFormat: 2,
    },
    {
      label: 'mockField',
      kind: 8,
      detail: 'int',
      documentation: 'A mock field for testing',
      sortText: '1',
      filterText: 'mockField',
      insertText: 'mockField',
    },
  ],
};

const HOVER_SAMPLE = {
  contents: {
    kind: 'markdown',
    value: '```java\nint mockField\n```\n\nA mock field for testing.',
  },
};

const DEFINITION_SAMPLE = {
  uri: 'file:///workspace/Test.java',
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  },
};

function sendMessage(msg: LSPMessage): void {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

function handleRequest(msg: LSPMessage): void {
  if (!msg.id || !msg.method) return;

  const id = msg.id;
  const params = msg.params || {};

  switch (msg.method) {
    case 'initialize': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          capabilities: CAPABILITIES,
          serverInfo: {
            name: 'Mock JDT Language Server',
            version: '1.0.0-test',
          },
        },
      });
      break;
    }
    case 'shutdown': {
      sendMessage({ jsonrpc: '2.0', id, result: null });
      // Graceful shutdown: the client sends 'exit' notification after this.
      break;
    }
    case 'textDocument/completion': {
      sendMessage({ jsonrpc: '2.0', id, result: COMPLETION_SAMPLE });
      break;
    }
    case 'textDocument/hover': {
      sendMessage({ jsonrpc: '2.0', id, result: HOVER_SAMPLE });
      break;
    }
    case 'textDocument/definition': {
      sendMessage({ jsonrpc: '2.0', id, result: [DEFINITION_SAMPLE] });
      break;
    }
    case 'textDocument/references': {
      sendMessage({ jsonrpc: '2.0', id, result: [DEFINITION_SAMPLE] });
      break;
    }
    case 'textDocument/implementation': {
      sendMessage({ jsonrpc: '2.0', id, result: [DEFINITION_SAMPLE] });
      break;
    }
    case 'textDocument/signatureHelp': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          signatures: [{ label: 'mockMethod(int x, String y)', parameters: [] }],
          activeSignature: 0,
          activeParameter: 0,
        },
      });
      break;
    }
    case 'textDocument/documentSymbol': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: [
          {
            name: 'MockClass',
            kind: 5,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 10, character: 1 },
            },
            selectionRange: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
          },
        ],
      });
      break;
    }
    case 'workspace/symbol': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: [
          {
            name: 'MockClass',
            kind: 5,
            location: {
              uri: 'file:///workspace/MockClass.java',
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
            },
          },
        ],
      });
      break;
    }
    case 'textDocument/codeAction': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: [
          {
            title: 'Mock quick fix',
            kind: 'quickfix',
            edit: {
              changes: {
                'file:///workspace/Test.java': [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 0 },
                    },
                    newText: '// fixed',
                  },
                ],
              },
            },
          },
        ],
      });
      break;
    }
    case 'textDocument/rename': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          changes: {
            'file:///workspace/Test.java': [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
                newText: (params as Record<string, unknown>).newName as string || 'renamed',
              },
            ],
          },
        },
      });
      break;
    }
    case 'textDocument/formatting': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'formatted',
          },
        ],
      });
      break;
    }
    case 'textDocument/codeLens': {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            command: {
              title: 'Mock Reference',
              command: 'mock.command',
            },
          },
        ],
      });
      break;
    }
    default: {
      sendMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      });
      break;
    }
  }
}

function handleNotification(msg: LSPMessage): void {
  if (!msg.method) return;

  switch (msg.method) {
    case 'initialized': {
      // After initialized, send a mock diagnostic
      sendMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: DIAGNOSTICS_SAMPLE,
      });
      break;
    }
    case 'exit': {
      process.exit(0);
      break;
    }
    case 'textDocument/didOpen':
    case 'textDocument/didChange':
    case 'textDocument/didClose':
    case 'textDocument/didSave':
    case 'workspace/didChangeConfiguration':
    case 'workspace/didChangeWatchedFiles':
    case '$/cancelRequest':
    case '$/setTrace':
    case 'window/workDoneProgress/cancel':
      // Acknowledge silently
      break;
    default: {
      // Unknown notification — ignore silently
      break;
    }
  }
}

function parseHeaders(line: string): number | null {
  const match = line.match(/^Content-Length: (\d+)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

// Main loop: read LSP messages from stdin
const rl = createInterface({ input: process.stdin });

let contentLength: number | null = null;
const _bodyBuffer = '';

rl.on('line', (line: string) => {
  if (contentLength === null) {
    const parsed = parseHeaders(line);
    if (parsed !== null) {
      contentLength = parsed;
    }
    // Skip other header lines
  } else if (line === '') {
    // Empty line = end of headers, body follows
    // Body is read from the same stream; we need to accumulate
    // until we have contentLength bytes. But readline gives us
    // lines, not raw bytes. For simplicity, we assume the body
    // is a single line (JSON without newlines).
    // In production, the mock reads the body via a raw stream.
    // For the test harness, we use a simpler approach.
  }
});

// Read raw stdin for body data
let rawBuffer = '';
let headerParsed = false;
let expectedLength = 0;

process.stdin.on('data', (chunk: Buffer) => {
  rawBuffer += chunk.toString('utf-8');

  while (true) {
    if (!headerParsed) {
      const headerEnd = rawBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const headerPart = rawBuffer.substring(0, headerEnd);
      const clMatch = headerPart.match(/Content-Length: (\d+)/i);
      if (!clMatch) {
        // Invalid header; skip
        rawBuffer = rawBuffer.substring(headerEnd + 4);
        continue;
      }

      expectedLength = parseInt(clMatch[1], 10);
      rawBuffer = rawBuffer.substring(headerEnd + 4);
      headerParsed = true;
    }

    if (headerParsed && rawBuffer.length >= expectedLength) {
      const body = rawBuffer.substring(0, expectedLength);
      rawBuffer = rawBuffer.substring(expectedLength);
      headerParsed = false;
      expectedLength = 0;

      try {
        const msg: LSPMessage = JSON.parse(body);
        if (msg.id !== undefined && msg.id !== null) {
          handleRequest(msg);
        } else {
          handleNotification(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    } else {
      break;
    }
  }
});

// Signal readiness to parent
if (process.send) {
  process.send({ type: 'ready' });
}