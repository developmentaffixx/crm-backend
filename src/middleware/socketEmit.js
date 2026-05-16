const { emitEvent } = require('../config/socket');

/**
 * Middleware that attaches an `emitSocket` helper to the response object.
 * Controllers can call `res.emitSocket(event, data)` after a successful mutation.
 */
function socketEmitMiddleware(req, res, next) {
  res.emitSocket = (event, data = {}) => {
    emitEvent(event, data);
  };
  next();
}

module.exports = socketEmitMiddleware;
