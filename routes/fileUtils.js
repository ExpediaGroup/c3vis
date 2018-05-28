const fs = require('fs');

module.exports = {
  readJsonFile: (path) => {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  },
};
