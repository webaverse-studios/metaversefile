export {transform, load, resolveId, loaders, contracts} from "./metaversefile-functions.js";
export {metaversefilePlugin} from "./plugins/rollup.js";
class Metaversefile extends EventTarget {
  constructor() {
    super();
  }
  setApi(o) {
    for (const k in o) {
      Object.defineProperty(this, k, {
        value: o[k],
      });
    }
    Object.freeze(this);
  }
}
const metaversefile = new Metaversefile();

export default metaversefile;
