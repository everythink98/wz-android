import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT_MODULES = ['app', 'domain', 'features', 'platform', 'sources', 'ui'];

const ROOT_MODULE_SET = new Set(ROOT_MODULES);
const PROVIDER_MODULES = new Set(['linuxdo', 'nodeimage', 'nodeseek', 'v2ex', 'xiaoyinsi', 'yaohuo']);
const ALLOWED_DEPENDENCIES = {
  app: new Set(ROOT_MODULES),
  domain: new Set(['domain']),
  features: new Set(['domain', 'features', 'platform', 'sources', 'ui']),
  platform: new Set(['domain', 'platform']),
  sources: new Set(['domain', 'platform', 'sources']),
  ui: new Set(['domain', 'platform', 'ui'])
};
const CODE_EXTENSIONS = ['.ts', '.tsx'];

function normalizedPath(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function relativePath(srcDir, filePath) {
  return path.relative(srcDir, filePath).replaceAll('\\', '/');
}

function listCodeFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listCodeFiles(entryPath);
    return CODE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [entryPath] : [];
  });
}

function importedModuleSpecifiers(filePath) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const specifiers = new Set();
  const addStringLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ) {
        addStringLiteral(node.arguments[0]);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addStringLiteral(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

function resolveInternalModule(fromFile, specifier, srcDir, filesByPath) {
  let basePath;
  if (specifier.startsWith('@/')) {
    basePath = path.join(srcDir, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    ...CODE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...CODE_EXTENSIONS.map((extension) => path.join(basePath, `index${extension}`))
  ];
  for (const candidate of candidates) {
    const target = filesByPath.get(normalizedPath(candidate));
    if (target) return target;
  }
  return null;
}

function moduleParts(relativeFile) {
  return relativeFile.split('/');
}

function ownershipUnit(relativeFile) {
  const [root, owner] = moduleParts(relativeFile);
  if (root === 'app') return root;
  return owner && relativeFile.includes('/') && moduleParts(relativeFile).length > 2 ? `${root}/${owner}` : root;
}

function importStyleIssue(fromFile, toFile, specifier) {
  const sameUnit = ownershipUnit(fromFile) === ownershipUnit(toFile);
  if (sameUnit && specifier.startsWith('@/')) {
    return {
      code: 'import-style',
      message: `${fromFile} 在同一模块内应使用相对路径导入 ${toFile}`
    };
  }
  if (!sameUnit && specifier.startsWith('.')) {
    return {
      code: 'import-style',
      message: `${fromFile} 跨模块应使用 @/ 导入 ${toFile}`
    };
  }
  return null;
}

function dependencyIssue(fromFile, toFile) {
  const fromParts = moduleParts(fromFile);
  const toParts = moduleParts(toFile);
  const fromRoot = fromParts[0];
  const toRoot = toParts[0];
  if (!ALLOWED_DEPENDENCIES[fromRoot]?.has(toRoot)) {
    return {
      code: 'dependency-direction',
      message: `${fromFile} 不得依赖 ${toFile}`
    };
  }
  if (fromRoot === 'features' && toRoot === 'features' && fromParts[1] !== toParts[1]) {
    return {
      code: 'cross-feature',
      message: `${fromFile} 不得跨 feature 依赖 ${toFile}`
    };
  }
  if (fromRoot === 'sources' && toRoot === 'sources') {
    const fromProvider = fromParts.length > 2 ? fromParts[1] : null;
    const toProvider = toParts.length > 2 ? toParts[1] : null;
    if (toProvider && PROVIDER_MODULES.has(toProvider) && fromProvider !== toProvider && fromProvider !== null) {
      return {
        code: 'cross-provider',
        message: `${fromFile} 不得横向依赖 provider ${toFile}`
      };
    }
  }
  return null;
}

export function findDependencyCycles(graph) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  const visit = (node) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) || []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(dependency)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) cycles.push(component.sort());
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return cycles;
}

export function analyzeArchitecture(srcDir) {
  const resolvedSrcDir = path.resolve(srcDir);
  const issues = [];
  const entries = existsSync(resolvedSrcDir) ? readdirSync(resolvedSrcDir, { withFileTypes: true }) : [];
  const rootDirectories = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));

  for (const requiredRoot of ROOT_MODULES) {
    if (!rootDirectories.has(requiredRoot)) {
      issues.push({ code: 'missing-root', message: `缺少 src/${requiredRoot}/` });
    }
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      issues.push({ code: 'root-file', message: `src/ 根目录不得包含源码文件：${entry.name}` });
    } else if (entry.isDirectory() && !ROOT_MODULE_SET.has(entry.name)) {
      issues.push({ code: 'unexpected-root', message: `src/ 仅允许六类 ownership 目录：${entry.name}/` });
    }
  }

  const files = listCodeFiles(resolvedSrcDir);
  const filesByPath = new Map(files.map((file) => [normalizedPath(file), file]));
  const graph = new Map(files.map((file) => [relativePath(resolvedSrcDir, file), new Set()]));

  for (const file of files) {
    const fromFile = relativePath(resolvedSrcDir, file);
    if (/\/(?:index)\.tsx?$/.test(`/${fromFile}`)) {
      issues.push({ code: 'barrel', message: `禁止 barrel 文件：${fromFile}` });
    }
    for (const specifier of importedModuleSpecifiers(file)) {
      const target = resolveInternalModule(file, specifier, resolvedSrcDir, filesByPath);
      if (!target) continue;
      const toFile = relativePath(resolvedSrcDir, target);
      graph.get(fromFile).add(toFile);
      const styleIssue = importStyleIssue(fromFile, toFile, specifier);
      if (styleIssue) issues.push(styleIssue);
      const issue = dependencyIssue(fromFile, toFile);
      if (issue) issues.push(issue);
    }
  }

  for (const cycle of findDependencyCycles(graph)) {
    issues.push({ code: 'cycle', message: `检测到依赖环：${cycle.join(' -> ')}` });
  }

  return { files: files.map((file) => relativePath(resolvedSrcDir, file)), graph, issues };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = analyzeArchitecture(path.join(process.cwd(), 'src'));
  if (result.issues.length > 0) {
    for (const issue of result.issues) console.error(`[${issue.code}] ${issue.message}`);
    process.exitCode = 1;
  } else {
    console.log(`Architecture check passed (${result.files.length} modules).`);
  }
}
