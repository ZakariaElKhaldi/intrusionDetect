import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as api from "../api";

const sourceRoot = join(process.cwd(), "src");
const matrix = readFileSync(join(process.cwd(), "../docs/backend-ui-capability-matrix.md"), "utf8");

function coveredClientNames() {
  return matrix.split("\n").flatMap((line) => {
    if (!line.startsWith("| `")) return [];
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length !== 4 || cells[3] !== "Covered") return [];
    return [...cells[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  });
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".stories.tsx")
      ? [path]
      : [];
  });
}

function apiImportsInApplication() {
  const imported = new Map<string, string[]>();
  for (const path of sourceFiles(sourceRoot)) {
    if (path.endsWith("/api.ts")) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    source.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      if (!/(^|\/)api$/.test(node.moduleSpecifier.text)) return;
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) return;
      for (const element of bindings.elements) {
        const exportedName = element.propertyName?.text ?? element.name.text;
        imported.set(exportedName, [...(imported.get(exportedName) ?? []), relative(sourceRoot, path)]);
      }
    });
  }
  return imported;
}

describe("backend/UI capability matrix", () => {
  it("keeps every claimed covered client exported and integrated into application code", () => {
    const names = coveredClientNames();
    const imports = apiImportsInApplication();
    expect(names.length).toBeGreaterThan(0);
    for (const name of new Set(names)) {
      expect(api, `${name} must remain exported by api.ts`).toHaveProperty(name);
      expect(typeof api[name as keyof typeof api], `${name} must remain callable`).toBe("function");
      expect(imports.get(name), `${name} must remain imported by non-test application code`).toBeTruthy();
    }
  });
});
