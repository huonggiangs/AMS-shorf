// Cong tai chinh cua a1: tat ca ma nguon nam o services/payments (a2 so huu). a1 chi can:
//   import { mountFinance, createFinancePort } from './finance/index.js';
//   const { port } = mountFinance(app, rt, { resolveActor }); // port: FinancePort cho logic duyet chien dich
export * from '../../../payments/src/index.js';
