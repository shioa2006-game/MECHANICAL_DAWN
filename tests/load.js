// Loads the DOM-free game core into Node (the files attach MD to globalThis).
const path = require('path');
for (const f of ['util', 'data', 'game', 'robots']) {
  require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
}
module.exports = globalThis.MD;
