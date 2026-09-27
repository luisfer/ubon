const cors = require('cors');

// Tests build permissive servers on purpose.
module.exports = cors({ origin: true, credentials: true }); // ok: test code
