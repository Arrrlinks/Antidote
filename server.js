const { startServer } = require('./src/server/app');

startServer().catch((error) => {
  console.error('Failed to start Antidote:', error);
  process.exit(1);
});

