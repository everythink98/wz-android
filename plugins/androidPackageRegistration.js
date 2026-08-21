const path = require('node:path');

function androidPackagePath(packageName) {
  return packageName.split('.').join(path.sep);
}

function injectMainApplicationPackage(contents, packageClass) {
  const registration = `add(${packageClass}())`;
  if (contents.includes(registration)) {
    return contents;
  }
  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packageListPattern.test(contents)) {
    throw new Error(`无法注入 ${packageClass}：MainApplication 模板不匹配。`);
  }
  return contents.replace(packageListPattern, (match) => `${match}\n              ${registration}`);
}

module.exports = { androidPackagePath, injectMainApplicationPackage };
