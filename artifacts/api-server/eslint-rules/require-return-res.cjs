/**
 * Custom ESLint rule: require-return-res
 *
 * Flags response-terminating Express calls (e.g. `res.json(...)`, `res.send(...)`,
 * `res.status(400).json(...)`) used as bare ExpressionStatements when the next
 * statement does not short-circuit execution. Without an explicit `return` (or a
 * trailing `return;`), the handler can fall through and execute code after the
 * response was already sent.
 *
 * The autofix inserts an explicit `return;` on the next line, but ONLY when
 * the response-terminating statement is the last statement in its containing
 * block. When other statements follow, the autofix is intentionally withheld
 * because automatically inserting `return;` would make that trailing code
 * unreachable (e.g. fire-and-forget `void (async () => {...})()` work or
 * `await writeAudit(...)` calls). In those cases the developer must reorder
 * by hand: run the post-response side-effects BEFORE the response.
 *
 * Inserting `return;` (rather than prepending `return ` to the response call)
 * keeps wrapper functions typed `Promise<void>` happy and avoids TS2322
 * ("Response is not assignable to void") errors.
 *
 * Only triggers when the callee chain ultimately resolves to a parameter /
 * variable named `res` (or `_res`), so unrelated `foo.json()` calls are not
 * affected.
 */

const TERMINATORS = new Set([
  "json",
  "send",
  "sendStatus",
  "end",
  "redirect",
  "sendFile",
  "download",
  "render",
  "jsonp",
]);

const RES_NAMES = new Set(["res", "_res"]);

function getCalleeChainRoot(node) {
  let cur = node;
  while (cur) {
    if (cur.type === "MemberExpression") {
      cur = cur.object;
      continue;
    }
    if (cur.type === "CallExpression") {
      cur = cur.callee;
      continue;
    }
    return cur;
  }
  return null;
}

function getTerminatorName(callee) {
  if (callee.type !== "MemberExpression") return null;
  const prop = callee.property;
  if (!prop) return null;
  if (prop.type === "Identifier") return prop.name;
  if (prop.type === "Literal" && typeof prop.value === "string") return prop.value;
  return null;
}

function getSiblingStatements(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (parent.type === "BlockStatement" || parent.type === "Program") {
    return parent.body;
  }
  if (parent.type === "SwitchCase") {
    return parent.consequent;
  }
  return null;
}

function isInBlockContext(node) {
  const parent = node.parent;
  if (!parent) return false;
  return (
    parent.type === "BlockStatement" ||
    parent.type === "Program" ||
    parent.type === "SwitchCase"
  );
}

function nextSiblingShortCircuits(node) {
  const siblings = getSiblingStatements(node);
  if (!siblings) return false;
  const idx = siblings.indexOf(node);
  if (idx < 0) return false;
  const next = siblings[idx + 1];
  if (!next) {
    // Last statement in the block. Walk up: if the block is the body of a
    // function (arrow, function expression, function declaration, or method),
    // then there is nothing after the call that can run, so it is safe.
    const parent = node.parent;
    if (!parent) return false;
    if (parent.type !== "BlockStatement") return false;
    const grand = parent.parent;
    if (!grand) return false;
    if (
      grand.type === "FunctionDeclaration" ||
      grand.type === "FunctionExpression" ||
      grand.type === "ArrowFunctionExpression"
    ) {
      return true;
    }
    return false;
  }
  return next.type === "ReturnStatement";
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Express response-terminating calls (res.json, res.send, ...) to be followed by a return so handlers cannot fall through after sending a response",
    },
    fixable: "code",
    schema: [],
    messages: {
      missingReturn:
        "Response-terminating call `res.{{name}}(...)` may fall through. Add an explicit `return` so execution stops after the response is sent.",
    },
  },
  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode;
    return {
      ExpressionStatement(node) {
        const expr = node.expression;
        if (!expr) return;
        if (expr.type !== "CallExpression") return;

        const terminator = getTerminatorName(expr.callee);
        if (!terminator || !TERMINATORS.has(terminator)) return;

        const root = getCalleeChainRoot(expr.callee);
        if (!root || root.type !== "Identifier") return;
        if (!RES_NAMES.has(root.name)) return;

        if (!isInBlockContext(node)) return;
        if (nextSiblingShortCircuits(node)) return;

        context.report({
          node,
          messageId: "missingReturn",
          data: { name: terminator },
          fix(fixer) {
            // Only autofix when this is the LAST statement in its containing
            // block. Otherwise inserting `return;` would make subsequent
            // statements (fire-and-forget IIFEs, audit writes, etc.)
            // unreachable. The developer must reorder by hand.
            const siblings = getSiblingStatements(node);
            if (!siblings) return null;
            const idx = siblings.indexOf(node);
            if (idx < 0 || idx !== siblings.length - 1) return null;
            const line = sourceCode.lines[node.loc.start.line - 1] || "";
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : "";
            return fixer.insertTextAfter(node, `\n${indent}return;`);
          },
        });
      },
    };
  },
};
