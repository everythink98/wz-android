import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stableMarkdownFiles = [
  'docs/product-charter.md',
  'docs/product-map.md',
  'docs/regression-corpus.md',
  'docs/architecture.md',
  'docs/code-standards.md',
  'docs/testing-standard.md',
  'docs/operator-runbook.md',
  'docs/handoff.md',
  'docs/code-cleanup-map.md',
  'tests/live/agent-live.md'
];
const optionalRepositoryPaths = new Set([
  'docs/emulator-baseline.md',
  'android/app/build/outputs/apk/release',
  'android/app/build/outputs/apk/release/app-arm64-v8a-release.apk',
  'android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk',
  'release-manifest.json'
]);
const retiredUserFacingTerms = ['生物凭证', '生物认证', '身份识别保护', '身份安全识别'];
const regressionStatuses = new Set(['OPEN', 'RESOLVED', 'SUPERSEDED', 'EVIDENCE_GAP']);

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function normalizeRepositoryPath(value) {
  return value
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/[?#].*$/, '');
}

function isExternalReference(value) {
  return value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value);
}

function resolveReference(root, markdownFile, value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const withoutAnchor = decoded.replace(/[?#].*$/, '');
  if (!withoutAnchor) return undefined;
  return path.resolve(root, path.dirname(markdownFile), withoutAnchor);
}

function repositoryRelativePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replaceAll('\\', '/')
    : undefined;
}

function withoutFencedCode(text) {
  return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\r\n]/g, ' '));
}

function fencedCodeBlocks(text) {
  return [...text.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```|~~~[^\r\n]*\r?\n([\s\S]*?)~~~/g)].map((match) => {
    const content = match[1] ?? match[2] ?? '';
    return {
      content,
      index: (match.index ?? 0) + match[0].indexOf(content)
    };
  });
}

function isRepositoryPath(root, value) {
  if (!value || /\s|[*?{}<>|]/.test(value) || isExternalReference(value) || path.isAbsolute(value)) return false;
  const normalized = normalizeRepositoryPath(value);
  if (!normalized.includes('/')) return /\.(?:md|tsx?|jsx?|mjs|cjs|json|ya?ml)$/i.test(normalized);
  const [topLevel] = normalized.split('/');
  return topLevel === 'docs' || existsSync(path.join(root, topLevel));
}

function addMissingReference(errors, root, markdownFile, text, index, reference, targetPath) {
  const relativeTarget = repositoryRelativePath(root, targetPath);
  if (relativeTarget && optionalRepositoryPaths.has(relativeTarget)) return;
  if (!relativeTarget || !existsSync(targetPath)) {
    errors.push(`${markdownFile.replaceAll('\\', '/')}:${lineNumberAt(text, index)} 引用不存在：${reference}`);
  }
}

export function findBrokenDocReferences(root, markdownFiles) {
  const errors = [];

  for (const markdownFile of markdownFiles) {
    const absoluteMarkdownFile = path.join(root, markdownFile);
    if (!existsSync(absoluteMarkdownFile)) {
      errors.push(`${markdownFile} 不存在`);
      continue;
    }

    const text = readFileSync(absoluteMarkdownFile, 'utf8');
    const prose = withoutFencedCode(text);
    const inlineLinkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
    const referenceLinkPattern = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;

    for (const pattern of [inlineLinkPattern, referenceLinkPattern]) {
      for (const match of prose.matchAll(pattern)) {
        const reference = match[1] ?? match[2];
        if (isExternalReference(reference)) continue;
        const targetPath = resolveReference(root, markdownFile, reference);
        if (targetPath) addMissingReference(errors, root, markdownFile, text, match.index, reference, targetPath);
      }
    }

    for (const match of prose.matchAll(/`([^`\r\n]+)`/g)) {
      const reference = match[1].replace(/[.,;:]$/, '');
      if (!isRepositoryPath(root, reference)) continue;
      const normalized = normalizeRepositoryPath(reference);
      addMissingReference(errors, root, markdownFile, text, match.index, reference, path.resolve(root, normalized));
    }

    for (const block of fencedCodeBlocks(text)) {
      for (const match of block.content.matchAll(/\S+/g)) {
        const reference = match[0].replace(/^[('"`]+|[)'"`,;:]+$/g, '');
        if (!isRepositoryPath(root, reference)) continue;
        const normalized = normalizeRepositoryPath(reference);
        addMissingReference(
          errors,
          root,
          markdownFile,
          text,
          block.index + match.index,
          reference,
          path.resolve(root, normalized)
        );
      }
    }
  }

  return errors;
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolutePath) : [absolutePath];
  });
}

function parseRegressionEntries(text) {
  const headings = [...text.matchAll(/^## `((?:REG)-[A-Z0-9]+-\d+)`[^\r\n]*$/gm)];
  return headings.map((heading, index) => ({
    id: heading[1],
    index: heading.index ?? 0,
    text: text.slice(heading.index ?? 0, headings[index + 1]?.index ?? text.length)
  }));
}

function regressionField(entry, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\|\\s*${escapedField}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm').exec(entry.text)?.[1].trim();
}

function testCallKind(expression) {
  let current = expression;
  let each = false;
  let failing = false;
  while (true) {
    if (ts.isPropertyAccessExpression(current)) {
      each ||= current.name.text === 'each';
      failing ||= current.name.text === 'failing';
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return ts.isIdentifier(current) && (current.text === 'it' || current.text === 'test') ? { each, failing } : undefined;
}

function findTestTitleErrors(root, files, knownRegressionIds, statusByRegressionId) {
  const errors = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.getScriptKindFromFileName(file)
    );
    const relativeFile = path.relative(root, file).replaceAll('\\', '/');
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const kind = testCallKind(node.expression);
        if (kind) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const titleNode = node.arguments[0];
          if (kind.each && kind.failing) {
            errors.push(
              `${relativeFile}:${line} 不支持 .failing.each；请拆成使用静态字符串标题的 it.failing/test.failing`
            );
          } else if (kind.failing && (!titleNode || !ts.isStringLiteral(titleNode))) {
            errors.push(`${relativeFile}:${line} it.failing 必须使用含一个 canonical REG ID 的静态字符串标题`);
          } else if (titleNode && ts.isStringLiteralLike(titleNode)) {
            const ids = [...titleNode.text.matchAll(/\bREG-[A-Z0-9]+-\d+\b/g)].map((match) => match[0]);
            if (!kind.failing && ids.length) {
              errors.push(`${relativeFile}:${line} 通过测试标题不得包含 REG；请改为当前行为标题`);
            } else if (kind.failing) {
              if (ids.length !== 1) {
                errors.push(`${relativeFile}:${line} it.failing 必须且只能引用一个 canonical REG ID`);
              } else if (!knownRegressionIds.has(ids[0])) {
                errors.push(`${relativeFile}:${line} it.failing 引用的 ${ids[0]} 不存在`);
              } else if (statusByRegressionId.get(ids[0]) !== 'OPEN') {
                errors.push(`${relativeFile}:${line} it.failing 引用的 ${ids[0]} 状态不是 OPEN`);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return errors;
}

export function findKnowledgeContractErrors(root, markdownFiles = stableMarkdownFiles) {
  const errors = [];
  const productMapPath = path.join(root, 'docs', 'product-map.md');
  const regressionCorpusPath = path.join(root, 'docs', 'regression-corpus.md');
  if (!existsSync(productMapPath) || !existsSync(regressionCorpusPath)) return errors;

  const productMap = readFileSync(productMapPath, 'utf8');
  const capabilitySection = productMap.match(/## 能力清单([\s\S]*?)(?=\r?\n## (?:四|五)站能力矩阵)/)?.[1] ?? '';
  const capabilityIds = [...capabilitySection.matchAll(/^\|\s*`([A-Z]+-\d+)`\s*\|/gm)].map((match) => match[1]);
  const knownCapabilities = new Set(capabilityIds);
  for (const capabilityId of knownCapabilities) {
    if (capabilityIds.filter((value) => value === capabilityId).length > 1) {
      errors.push(`docs/product-map.md：${capabilityId} 重复定义`);
    }
  }

  const regressionCorpus = readFileSync(regressionCorpusPath, 'utf8');
  const regressionEntries = parseRegressionEntries(regressionCorpus);
  const knownRegressionIds = new Set(regressionEntries.map((entry) => entry.id));
  const statusByRegressionId = new Map();
  for (const entry of regressionEntries) {
    const status = regressionField(entry, '状态')?.replaceAll('`', '').trim();
    const capability = regressionField(entry, '能力 ID');
    const history = regressionField(entry, '历史症状与根因');
    const owner = regressionField(entry, '当前 owner');
    if (!status || !regressionStatuses.has(status)) {
      errors.push(`docs/regression-corpus.md：${entry.id} 缺少合法状态`);
    } else {
      statusByRegressionId.set(entry.id, status);
    }
    if (!capability || !/\b[A-Z]+-\d+\b/.test(capability)) {
      errors.push(`docs/regression-corpus.md：${entry.id} 缺少 capability`);
    }
    if (!history || /^(?:-|TBD|无)$/i.test(history.trim())) {
      errors.push(`docs/regression-corpus.md：${entry.id} 缺少历史症状与根因`);
    }
    if (!owner || /^(?:-|TBD|无)$/i.test(owner.replaceAll('`', '').trim())) {
      errors.push(`docs/regression-corpus.md：${entry.id} 缺少当前 owner`);
    }
  }
  const checkedMarkdown = markdownFiles
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => ({ file, text: readFileSync(path.join(root, file), 'utf8') }));
  if (capabilityIds.length) {
    const capabilityFamilies = [...new Set(capabilityIds.map((id) => id.slice(0, id.lastIndexOf('-'))))];
    const capabilityFamilyPattern = capabilityFamilies.join('|');
    const capabilityPattern = new RegExp(
      `(?<![A-Z/-])(${capabilityFamilyPattern})-(\\d+)((?:/(?:(?:${capabilityFamilyPattern})-)?\\d+)*)\\b`,
      'g'
    );
    for (const { file, text } of checkedMarkdown) {
      for (const match of text.matchAll(capabilityPattern)) {
        let family = match[1];
        const references = [`${family}-${match[2]}`];
        for (const suffix of match[3].split('/').filter(Boolean)) {
          const parsedSuffix = /^(?:([A-Z]+)-)?(\d+)$/.exec(suffix);
          family = parsedSuffix?.[1] ?? family;
          references.push(`${family}-${parsedSuffix?.[2]}`);
        }
        for (const capabilityId of references) {
          if (!knownCapabilities.has(capabilityId)) {
            errors.push(
              `${file.replaceAll('\\', '/')}:${lineNumberAt(text, match.index ?? 0)} 引用的能力 ${capabilityId} 不存在`
            );
          }
        }
      }
    }
  }
  const regressionPattern = /(?<![A-Z0-9/-])REG-([A-Z0-9]+)-(\d+)((?:\/(?:[A-Z0-9]+-)?\d+)*)\b/g;
  for (const { file, text } of checkedMarkdown) {
    for (const match of text.matchAll(regressionPattern)) {
      let family = match[1];
      const references = [`REG-${family}-${match[2]}`];
      for (const suffix of match[3].split('/').filter(Boolean)) {
        const parsedSuffix = /^(?:([A-Z0-9]+)-)?(\d+)$/.exec(suffix);
        family = parsedSuffix?.[1] ?? family;
        references.push(`REG-${family}-${parsedSuffix?.[2]}`);
      }
      for (const regressionId of references) {
        if (!knownRegressionIds.has(regressionId)) {
          errors.push(
            `${file.replaceAll('\\', '/')}:${lineNumberAt(text, match.index ?? 0)} 引用的回归 ${regressionId} 不存在`
          );
        }
      }
    }
  }

  const sourceFiles = filesBelow(path.join(root, 'src')).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
  const testFiles = filesBelow(path.join(root, 'tests')).filter((file) => /\.(?:[cm]?[jt]sx?|ad)$/.test(file));
  for (const file of [...sourceFiles, ...testFiles]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bREG-[A-Z0-9]+-\d+\b/g)) {
      if (!knownRegressionIds.has(match[0])) {
        errors.push(
          `${path.relative(root, file).replaceAll('\\', '/')}:${lineNumberAt(text, match.index ?? 0)} 引用的回归 ${match[0]} 不存在`
        );
      }
    }
  }

  const packageJsonPath = path.join(root, 'package.json');
  if (existsSync(packageJsonPath)) {
    const packageScripts = new Set(Object.keys(JSON.parse(readFileSync(packageJsonPath, 'utf8')).scripts ?? {}));
    const npmScriptPattern = /\bnpm\s+run\s+([A-Za-z0-9][A-Za-z0-9:._-]*)(?=$|[\s`"'|;&<>()\],，。！？；：])/g;
    for (const { file, text } of checkedMarkdown) {
      for (const match of text.matchAll(npmScriptPattern)) {
        const script = packageScripts.has(match[1]) ? match[1] : match[1].replace(/[.!?;:]+$/, '');
        if (!packageScripts.has(script)) {
          errors.push(
            `${file.replaceAll('\\', '/')}:${lineNumberAt(text, match.index ?? 0)} 引用的 npm script ${script} 不存在`
          );
        }
      }
    }
  }
  const executableTestFiles = [...new Set([...sourceFiles, ...testFiles])].filter((file) =>
    /\.test\.[cm]?[jt]sx?$/.test(file)
  );
  errors.push(...findTestTitleErrors(root, executableTestFiles, knownRegressionIds, statusByRegressionId));

  const stableDocs = stableMarkdownFiles.map((file) => path.join(root, file)).filter(existsSync);
  for (const file of [...sourceFiles, ...stableDocs]) {
    const text = readFileSync(file, 'utf8');
    for (const term of retiredUserFacingTerms) {
      const index = text.indexOf(term);
      if (index >= 0) {
        errors.push(
          `${path.relative(root, file).replaceAll('\\', '/')}:${lineNumberAt(text, index)} 禁止旧用户可见术语：${term}`
        );
      }
    }
  }
  return errors;
}

function trackedMarkdownFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '--', '*.md'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const markdownFiles = [...new Set([...trackedMarkdownFiles(rootDir), ...stableMarkdownFiles])];
  const errors = [
    ...findBrokenDocReferences(rootDir, markdownFiles),
    ...findKnowledgeContractErrors(rootDir, markdownFiles)
  ];
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`文档引用检查通过（${markdownFiles.length} 个 Markdown 文件）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
