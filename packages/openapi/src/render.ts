import { stringify } from 'yaml';
type Json = Record<string, unknown>;
export const render = (doc: Json): { json: string; yaml: string } => ({
  json: JSON.stringify(doc, null, 2) + '\n',
  yaml: stringify(doc, { lineWidth: 0 }),
});
