import * as log from "std/log/mod.ts";

await log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG"),

    file: new log.handlers.FileHandler("WARNING", {
      filename: "./indexer.log",
      formatter: "{levelName} {msg}"
    })
  },

  loggers: {
    default: {
      level: "DEBUG",
      handlers: ["console", "file"]
    },
  }
});

export const logger = log.getLogger();
