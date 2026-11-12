import { startMediaWorker } from './node.js';

const srv = await startMediaWorker();
const stop = () => void srv.close().finally(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
