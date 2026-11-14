const { createLocalServer } = require('./run-headless.cjs');

const server = createLocalServer();
server.on('error', error => {
    console.error('Local HTTP server failed:', error);
    process.exitCode = 1;
});
server.listen(0, '127.0.0.1', () => {
    console.log(`Open http://127.0.0.1:${server.address().port}/ in Safari. Press Ctrl+C to stop.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        server.close(error => {
            if (error) {
                console.error('Could not close the local HTTP server:', error);
                process.exitCode = 1;
            }
        });
        server.closeIdleConnections();
    });
}
