/**
 * Shared network utilities — used by both the desktop main process
 * and the server entry to discover free loopback ports.
 */

import { createServer } from 'net';

export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            server.close(() => resolve(port));
        });
    });
}