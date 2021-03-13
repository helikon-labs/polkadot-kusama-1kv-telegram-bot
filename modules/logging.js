/**
 * Logging module.
 */
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;

const myFormat = printf(({ level, message, label, timestamp }) => {
    return `${timestamp} ${level.toUpperCase()} ${message}`;
  });

const logger = createLogger({
    format: combine(
        timestamp(),
        myFormat
    ),
    transports: [ new transports.Console() ]
});

module.exports = logger;