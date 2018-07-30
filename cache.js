const fs = require('fs-promise');
const mkdirp = require('mkdirp-promise');

async function execute(functionName, fileName, func) {
  const cacheDirectory = `${__dirname}/cache/`;
  await mkdirp(cacheDirectory);

  const fullCacheFilePath = `${cacheDirectory}/${fileName}`;

  const existsInCache = await fs.exists(fullCacheFilePath);
  if (existsInCache) {
    const cacheContents = await fs.readFile(fullCacheFilePath);
    return JSON.parse(cacheContents);
  }

  const result = await func();

  let resultString;
  try {
    resultString = JSON.stringify(result);
  } catch (err) {
    console.log(`Unable to cache: ${functionName}, error: ${err}`);
  }

  if (resultString) {
    fs.writeFile(fullCacheFilePath, resultString);
  }

  return result;
}

module.exports = {
  execute,
};
