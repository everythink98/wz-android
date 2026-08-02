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
const METRO_RESOLUTION_EXTENSIONS = ['.android.ts', '.android.tsx', '.native.ts', '.native.tsx', ...CODE_EXTENSIONS];
const APP_COMPOSITION_ALLOWED_INTERNAL_IMPORTS = new Set([
  './AppRoutes',
  './useAppRuntime',
  '@/features/account/AccountHosts',
  '@/platform/media/mediaSessionEpoch',
  '@/ui/theme/ReaderStyleProvider'
]);
const APP_ROUTES_ALLOWED_INTERNAL_IMPORTS = new Set([
  './AppNavigator',
  '@/features/feed/FeedRoute',
  '@/features/library/LibraryRoute',
  '@/features/more/MoreRoute',
  '@/features/search/SearchRoute',
  '@/features/topic/TopicRoute',
  '@/features/user/UserRoute'
]);
const FORBIDDEN_RAW_STATE_HOOKS = new Set(['useCallback', 'useEffect', 'useRef', 'useState']);
const FORBIDDEN_LEGACY_MODULE_NAMES = new Set([
  'AppControls',
  'GlobalModalHost',
  'MorePanels',
  'TopicPresentationContext',
  'backHandlerHelpers',
  'controllerResults',
  'htmlImages',
  'screenHelpers',
  'sessionControllerHelpers',
  'sharedStyles',
  'topicBackStack',
  'topicPresentationCache',
  'topicPresentationContext',
  'topicRouteSnapshotStore',
  'topicRouteSnapshots',
  'useDeferredNavigationTask',
  'useMainTabScrollToTop',
  'userReturnSnapshot',
  'aggregateRead'
]);

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

function importedRawStateHooks(filePath) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const hooks = new Set();
  const reactNamespaces = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'react') continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) reactNamespaces.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      reactNamespaces.add(clause.namedBindings.name.text);
    } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const importedName = element.propertyName?.text || element.name.text;
        if (FORBIDDEN_RAW_STATE_HOOKS.has(importedName)) hooks.add(importedName);
      }
    }
  }

  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      reactNamespaces.has(node.expression.text) &&
      FORBIDDEN_RAW_STATE_HOOKS.has(node.name.text)
    ) {
      hooks.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...hooks];
}

function appRuntimeImportIssues(filePath, fromFile) {
  if (fromFile !== 'app/useAppRuntime.ts' && fromFile !== 'app/useAppRuntime.tsx') return [];
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!isInternalSpecifier(specifier)) continue;
    if (/(?:^|\/)components(?:\/|$)/.test(specifier) || /Screen$/.test(moduleName(specifier))) {
      issues.push({
        code: 'app-runtime-presentation-import',
        message: `${fromFile} 不得依赖 Screen/component：${specifier}`
      });
    }
    const namedImports = statement.importClause?.namedBindings;
    const typeOnlyImport =
      statement.importClause?.isTypeOnly ||
      (namedImports && ts.isNamedImports(namedImports) && namedImports.elements.every((element) => element.isTypeOnly));
    if (/^@\/features\/[^/]+\/[^/]*Route$/.test(specifier) && !typeOnlyImport) {
      issues.push({
        code: 'app-runtime-route-value-import',
        message: `${fromFile} 对 route entry 只允许 type import：${specifier}`
      });
    }
  }
  return issues;
}

function lastEntityName(name) {
  return ts.isIdentifier(name) ? name.text : name.name.text;
}

function routeRuntimeProjectionIssues(filePath, fromFile) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const issues = [];
  const visitRuntimeType = (node, ownerName) => {
    if (
      ts.isTypeReferenceNode(node) &&
      lastEntityName(node.typeName) === 'ComponentProps' &&
      node.typeArguments?.some(
        (argument) => ts.isTypeQueryNode(argument) && lastEntityName(argument.exprName).endsWith('Screen')
      )
    ) {
      issues.push({
        code: 'route-runtime-screen-projection',
        message: `${fromFile} 的 ${ownerName} 不得投影 Screen ComponentProps`
      });
    }
    ts.forEachChild(node, (child) => visitRuntimeType(child, ownerName));
  };
  for (const statement of sourceFile.statements) {
    if (
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) &&
      /RouteRuntime/.test(statement.name.text)
    ) {
      visitRuntimeType(statement, statement.name.text);
    }
  }
  return issues;
}

function rawAccountSessionIssues(filePath, fromFile) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const issues = [];
  const report = () => {
    if (issues.length === 0) {
      issues.push({ code: 'raw-account-session', message: `${fromFile} 不得读取 accountRuntime.session` });
    }
  };
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'accountRuntime' &&
      node.name.text === 'session'
    ) {
      report();
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'accountRuntime' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'session'
    ) {
      report();
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === 'accountRuntime' &&
      ts.isObjectBindingPattern(node.name) &&
      node.name.elements.some((element) => (element.propertyName || element.name).getText(sourceFile) === 'session')
    ) {
      report();
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function behaviorTestSourceReadIssues(projectRoot) {
  const issues = [];
  for (const relativeDirectory of ['tests/integration', 'tests/ui']) {
    const directory = path.join(projectRoot, relativeDirectory);
    for (const filePath of listCodeFiles(directory)) {
      const sourceText = readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const importsProductionSource = sourceFile.statements.some((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) return false;
        if (!['fs', 'fs/promises', 'node:fs', 'node:fs/promises'].includes(statement.moduleSpecifier.text)) {
          return false;
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) return /\breadFile(?:Sync)?\b/.test(sourceText);
        if (bindings && ts.isNamedImports(bindings)) {
          return bindings.elements.some((element) =>
            ['readFile', 'readFileSync'].includes(element.propertyName?.text || element.name.text)
          );
        }
        return /\breadFile(?:Sync)?\b/.test(sourceText);
      });
      if (importsProductionSource) {
        issues.push({
          code: 'behavior-test-source-read',
          message: `${path.relative(projectRoot, filePath).replaceAll('\\', '/')} 不得读取生产源码字符串证明行为`
        });
      }
    }
  }
  return issues;
}

function isInternalSpecifier(specifier) {
  return specifier.startsWith('@/') || specifier.startsWith('.');
}

function moduleName(modulePath) {
  const withoutExtension = modulePath.replace(/(?:\.android|\.native)?\.tsx?$/, '');
  return path.posix.basename(withoutExtension);
}

function internalModulePath(fromFile, specifier) {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  return null;
}

function compositionIssue(fromFile, specifier) {
  if (!isInternalSpecifier(specifier)) return null;
  if (fromFile === 'app/AppRoot.tsx' && specifier !== './AppComposition') {
    return {
      code: 'app-root-import',
      message: `${fromFile} 只能直接依赖 AppComposition：${specifier}`
    };
  }
  if (fromFile === 'app/AppComposition.tsx' && !APP_COMPOSITION_ALLOWED_INTERNAL_IMPORTS.has(specifier)) {
    return {
      code: 'app-composition-import',
      message: `${fromFile} 只能依赖深 runtime、全局 owner host 与 AppRoutes：${specifier}`
    };
  }
  if (fromFile === 'app/AppRoutes.tsx' && !APP_ROUTES_ALLOWED_INTERNAL_IMPORTS.has(specifier)) {
    return {
      code: 'app-routes-import',
      message: `${fromFile} 只能映射 feature route entry：${specifier}`
    };
  }
  if (fromFile === 'app/AppNavigator.tsx' && specifier.startsWith('@/features/')) {
    return {
      code: 'app-navigator-feature',
      message: `${fromFile} 不得依赖 feature：${specifier}`
    };
  }
  if (fromFile === 'app/useAppTheme.ts' && specifier.startsWith('@/features/')) {
    return {
      code: 'app-theme-feature-import',
      message: `${fromFile} 不得依赖 feature：${specifier}`
    };
  }
  return null;
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
    ...METRO_RESOLUTION_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...METRO_RESOLUTION_EXTENSIONS.map((extension) => path.join(basePath, `index${extension}`))
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
    if (FORBIDDEN_LEGACY_MODULE_NAMES.has(moduleName(fromFile))) {
      issues.push({ code: 'legacy-path', message: `禁止恢复旧模块：${fromFile}` });
    }
    if (fromFile === 'app/AppRoot.tsx') {
      for (const hook of importedRawStateHooks(file)) {
        issues.push({ code: 'app-root-state-hook', message: `${fromFile} 不得持有 React 业务状态 hook：${hook}` });
      }
    }
    if (fromFile === 'app/useAppRuntime.ts' || fromFile === 'app/useAppRuntime.tsx') {
      for (const hook of importedRawStateHooks(file)) {
        issues.push({ code: 'app-runtime-state-hook', message: `${fromFile} 不得持有 React 业务状态 hook：${hook}` });
      }
    }
    issues.push(...appRuntimeImportIssues(file, fromFile));
    issues.push(...routeRuntimeProjectionIssues(file, fromFile));
    issues.push(...rawAccountSessionIssues(file, fromFile));
    for (const specifier of importedModuleSpecifiers(file)) {
      const importedPath = internalModulePath(fromFile, specifier);
      if (importedPath && FORBIDDEN_LEGACY_MODULE_NAMES.has(moduleName(importedPath))) {
        issues.push({ code: 'legacy-path', message: `${fromFile} 不得导入旧模块：${specifier}` });
      }
      const appIssue = compositionIssue(fromFile, specifier);
      if (appIssue) issues.push(appIssue);
      const target = resolveInternalModule(file, specifier, resolvedSrcDir, filesByPath);
      if (!target) continue;
      const toFile = relativePath(resolvedSrcDir, target);
      if (fromFile === 'app/AppNavigator.tsx' && toFile.startsWith('features/')) {
        issues.push({ code: 'app-navigator-feature', message: `${fromFile} 不得依赖 feature：${toFile}` });
      }
      graph.get(fromFile).add(toFile);
      const styleIssue = importStyleIssue(fromFile, toFile, specifier);
      if (styleIssue) issues.push(styleIssue);
      const issue = dependencyIssue(fromFile, toFile);
      if (issue) issues.push(issue);
    }
  }

  issues.push(...behaviorTestSourceReadIssues(path.dirname(resolvedSrcDir)));

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
