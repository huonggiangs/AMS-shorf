// Tien trinh Node (Dockerfile goi tep nay).
import { startConsumer } from './node.js';

const srv = await startConsumer();
const stop = () => void srv.close().finally(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
