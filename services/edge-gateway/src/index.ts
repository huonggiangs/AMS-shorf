// Diem vao tien trinh Node (Dockerfile goi tep nay). Thu vien: import { createGateway } from '@ams/edge-gateway'.
import { startNode } from './node.js';

const srv = await startNode();
const stop = () => void srv.close().finally(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
