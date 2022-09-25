import { transform, resolveId, load } from "../metaversefile-functions.js";

export function metaversefilePlugin() {
  return {
    name: 'metaversefile',
    enforce: 'pre',
    async resolveId(source, importer) {
      await resolveId(source, importer);
    },
    async load(id) {
      await load(id);
    },
    async transform(src, id) {
      await transform(src, id);
    },
  }
};