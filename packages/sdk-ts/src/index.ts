import type { paths as AdminPaths } from './generated/admin.js';
import type { paths as GatewayPaths } from './generated/gateway.js';
import { AmsClient, type ClientOptions } from './client.js';

export type { AdminPaths, GatewayPaths };
export type { components as AdminComponents, operations as AdminOperations } from './generated/admin.js';
export type { components as GatewayComponents, operations as GatewayOperations } from './generated/gateway.js';
export { AmsClient, ApiError } from './client.js';
export type { ClientOptions, ErrorBody, Result, SuccessOf } from './client.js';
export { createDeviceSigner } from './device-signer.js';

/** Client API quan tri / cong khach hang (cookie phien + CSRF). */
export const createAdminClient = (o: ClientOptions): AmsClient<AdminPaths> => new AmsClient<AdminPaths>(o);
/** Client cho gateway thiet bi (dung `sign: createDeviceSigner(...)`). Chu yeu cho app mo phong/kiem thu; app TV dung Kotlin (docs/openapi/kotlin). */
export const createGatewayClient = (o: ClientOptions): AmsClient<GatewayPaths> => new AmsClient<GatewayPaths>(o);
