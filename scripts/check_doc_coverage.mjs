#!/usr/bin/env node
/**
 * @file Automated AST-based documentation coverage checker.
 * Verifies 100% documentation coverage across all files, modules, classes,
 * interfaces, type aliases, enums, functions, methods, properties, and parameters
 * in the `src/` directory. Also bans `@ts-ignore`, `@ts-expect-error`, and `v8 ignore`.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Recursively collects all `.ts` files in a directory.
 * @param dirPath The root directory path to scan.
 * @returns Array of absolute file paths.
 */
function collectTsFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extracts non-empty JSDoc text attached to a TypeScript AST node.
 * @param node The AST node to inspect.
 * @param sourceFile The containing source file.
 * @returns Combined JSDoc comment string, or empty string if missing.
 */
function getJsDocComment(node, sourceFile) {
  const jsDocs = ts.getJSDocCommentsAndTags(node);
  if (!jsDocs || jsDocs.length === 0) {
    return "";
  }
  return jsDocs
    .map((doc) => doc.getText(sourceFile).trim())
    .join(`
`)
    .trim();
}

/**
 * Extracts documented `@param` names from a JSDoc node list.
 * @param node The function, method, or constructor node.
 * @returns A Set of parameter names documented with `@param`.
 */
function getDocumentedParamNames(node) {
  const names = new Set();
  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (
      ts.isJSDocParameterTag(tag) &&
      tag.name &&
      ts.isIdentifier(tag.name)
    ) {
      const commentText =
        typeof tag.comment === "string"
          ? tag.comment.trim()
          : Array.isArray(tag.comment)
            ? tag.comment.map((c) => c.text).join("").trim()
            : "";
      if (commentText.length > 0) {
        names.add(tag.name.text);
      }
    }
  }
  return names;
}

const srcDir = path.resolve(process.cwd(), "src");
const files = collectTsFiles(srcDir);

let totalItems = 0;
let documentedItems = 0;
const missing = [];
const bannedDirectives = [];

for (const filePath of files) {
  const relPath = path.relative(process.cwd(), filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.ES2022,
    true,
  );

  // Check for banned directives in source files
  if (/\/\/\s*@ts-ignore|\/\*\s*@ts-ignore/.test(content)) {
    bannedDirectives.push(`${relPath}: contains forbidden @ts-ignore`);
  }
  if (/\/\/\s*@ts-expect-error|\/\*\s*@ts-expect-error/.test(content)) {
    bannedDirectives.push(`${relPath}: contains forbidden @ts-expect-error`);
  }
  if (/v8 ignore|c8 ignore|istanbul ignore/.test(content)) {
    bannedDirectives.push(`${relPath}: contains forbidden coverage ignore directive`);
  }

  // 1. Check file/module-level docblock
  totalItems++;
  const leadingComments =
    ts.getLeadingCommentRanges(content, 0) || [];
  const hasFileDoc = leadingComments.some((range) => {
    const text = content.slice(range.pos, range.end);
    return text.startsWith("/**") && text.includes("@module");
  });
  if (hasFileDoc) {
    documentedItems++;
  } else {
    missing.push(`${relPath}:1 - File/Module missing top-level /** @module ... */ docblock`);
  }

  /**
   * Visits AST nodes recursively to verify JSDoc coverage.
   * @param node The current AST node.
   */
  function visit(node) {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;

    if (
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      const kindName = ts.SyntaxKind[node.kind];
      const name = node.name ? node.name.text : "<anonymous>";
      totalItems++;
      if (getJsDocComment(node, sourceFile).length > 0) {
        documentedItems++;
      } else {
        missing.push(`${relPath}:${line} - ${kindName} '${name}' is missing JSDoc`);
      }
    } else if (
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isEnumMember(node)
    ) {
      const name = node.name ? node.name.getText(sourceFile) : "<property>";
      totalItems++;
      if (getJsDocComment(node, sourceFile).length > 0) {
        documentedItems++;
      } else {
        missing.push(`${relPath}:${line} - Property '${name}' is missing JSDoc`);
      }
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const name = ts.isConstructorDeclaration(node)
        ? "constructor"
        : node.name
          ? node.name.getText(sourceFile)
          : "<function>";
      totalItems++;
      const docText = getJsDocComment(node, sourceFile);
      if (docText.length > 0) {
        documentedItems++;
      } else {
        missing.push(`${relPath}:${line} -Callable '${name}' is missing JSDoc`);
      }

      // Check each parameter has @param <name> description
      const documentedParams = getDocumentedParamNames(node);
      for (const param of node.parameters) {
        const paramName = param.name.getText(sourceFile);
        totalItems++;
        if (documentedParams.has(paramName)) {
          documentedItems++;
        } else {
          missing.push(
            `${relPath}:${line} - Parameter '${paramName}' of '${name}' is missing @param JSDoc`,
          );
        }
      }
    } else if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          const name = decl.name.getText(sourceFile);
          totalItems++;
          if (getJsDocComment(node, sourceFile).length > 0) {
            documentedItems++;
          } else {
            missing.push(
              `${relPath}:${line} - Exported variable '${name}' is missing JSDoc`,
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

const pct =
  totalItems === 0 ? 100 : Math.floor((documentedItems / totalItems) * 100);
console.log(
  `Doc coverage: ${documentedItems}/${totalItems} (${pct}%)`,
);

if (missing.length > 0) {
  console.error("Missing documentation items:");
  for (const item of missing) {
    console.error(`  - ${item}`);
  }
}

if (bannedDirectives.length > 0) {
  console.error("Forbidden directives found:");
  for (const item of bannedDirectives) {
    console.error(`  - ${item}`);
  }
}

if (missing.length > 0 || bannedDirectives.length > 0 || pct < 100) {
  process.exit(1);
}
