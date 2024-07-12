const { listen } = require("@colyseus/tools");

// Import arena config
const app = require("./app.config");

// Create and listen on 2567 (or PORT environment variable.)
//listen(app, +process.env.PORT);
listen(app);
