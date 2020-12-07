import _ from "lodash";
import chalk from "chalk";

import { CodeSnippet, CodeLocation } from "./file.js";

export class Token extends CodeSnippet {
  constructor({ lexeme, start, end }) {
    super({ start, end });
    Object.assign(this, {
      lexeme,
      type: lexeme.name,
      ignore: lexeme.ignore,
    });
  }

  value() {
    return this.lexeme.evaluate(this);
  }

  debugString() {
    return `${this.type}(${this.read()})`;
  }
}

export class Clause extends CodeSnippet {
  constructor({ rule, parts, start, end }) {
    super({ start, end });
    Object.assign(this, { rule, type: rule.name, parts });
  }

  value() {
    return this.rule.evaluate(this);
  }

  debugString() {
    return `${this.type}(${this.read()})`;
  }
}

export class Lexeme {
  constructor(name, { re, ignore, evaluate }) {
    if (evaluate == null) evaluate = (token) => token.read();
    Object.assign(this, { name, type: name, re, ignore, evaluate });
  }
}

export class Rule {
  constructor(name, { syntax, evaluate }) {
    if (evaluate == null)
      evaluate = (clause) => clause.parts.map((part) => part.value());
    Object.assign(this, { name, type: name, syntax, evaluate });
  }
}

export class LineNumberError extends Error {
  constructor({ message, file, ln, col }) {
    const loc = chalk.bold([file.path, ln, col].join(":"));

    super(
      [
        `Parsing failed at ${loc}: ${message}`,
        file.lines[ln - 1],
        `${_.repeat(" ", col - 1)}^`,
      ].join("\n")
    );
  }
}

export class Grammar {
  constructor(definitions) {
    const lexemes = definitions.filter((d) => d instanceof Lexeme);
    const rules = _(definitions)
      .filter((d) => d instanceof Rule)
      .keyBy("name")
      .value();

    /* validate: */
    const definitionNames = new Set();
    for (const d of definitions) definitionNames.add(d.name);

    _.forEach(rules, (clause, name) => {
      for (const option of clause.syntax) {
        for (const subClause of option) {
          if (!definitionNames.has(subClause)) {
            throw new Error(
              `Grammar rule for ${chalk.blue(
                name
              )} references invalid sub-clause ${chalk.red(subClause)}`
            );
          }
        }
      }
    });

    Object.assign(this, { rules, lexemes });
  }

  tokenize(file) {
    const { code: input } = file;

    const tokens = [];
    let readHead = 0;
    let ln = 1;
    let col = 1;

    tokens: while (readHead < input.length) {
      const remain = input.slice(readHead);
      for (const lexeme of this.lexemes) {
        const result = remain.match(lexeme.re);
        if (result == null || result.index != 0) continue;

        const text = result[0];
        readHead += text.length;

        const newLines = Array.from(text.matchAll(/\n[^\n]*/g));
        let endCol;
        if (newLines.length > 0) endCol = _.last(newLines)[0].length;
        else endCol = col + text.length;

        tokens.push(
          new Token({
            lexeme,
            ignore: lexeme.ignore,
            start: new CodeLocation({ file, ln, col }),
            end: new CodeLocation({
              file,
              ln: ln + newLines.length,
              col: endCol,
            }),
          })
        );

        ln += newLines.length;
        col = endCol;
        continue tokens;
      }

      throw new LineNumberError({
        message: `unparsable character ${chalk.red(input[readHead])}`,
        file,
        ln,
        col,
      });
    }

    return tokens;
  }

  parse(file, entry) {
    const remainingTokensM = new WeakMap();
    const { rules } = this;

    if (rules[entry] == null) {
      throw new Error(
        `Could find a rule describing entrypoint ${chalk.red(entry)}`
      );
    }

    const tokens = this.tokenize(file);
    const ast = parse(tokens, entry);

    const remainingTokens = remainingTokensM.get(ast);
    if (remainingTokens.length > 0) {
      const failedAtToken = _.first(remainingTokens);
      throw new LineNumberError({
        message: `unexpected token ${chalk.red(failedAtToken.type)}`,
        file,
        ...failedAtToken.start,
      });
    }

    return ast;

    function parse(tokens, expectedType) {
      const rule = rules[expectedType];
      if (rule == null) return null;

      debugLog(chalk.blue("parse"), {
        expectedType,
        code: debugTokens(tokens),
      });

      option: for (const option of rule.syntax) {
        let remainingTokens = tokens;
        const resultParts = [];

        parts: for (const part of option) {
          debugLog(chalk.blue("clause"), `[${option.join(" ")}]: ${part}`);

          const token = remainingTokens[0];
          if (token != null && token.type == part) {
            debugLog(chalk.green("match"), token.debugString());
            resultParts.push(token);
            remainingTokens = remainingTokens.slice(1);
            continue parts;
          }

          const subClause = parse(remainingTokens, part);
          if (subClause != null) {
            debugLog(chalk.green("match"), subClause.debugString());

            remainingTokens = remainingTokensM.get(subClause);

            if (subClause.type === expectedType) {
              /* append repeats rather than nesting them: */
              resultParts.push(...subClause.parts);
            } else {
              resultParts.push(subClause);
            }

            continue parts;
          }

          debugLog(chalk.red("fail"), `[${option.join(" ")}]: ${part}`);
          continue option;
        }

        const clause = new Clause({
          rule,
          type: expectedType,
          parts: resultParts.filter((part) => !part.ignore),
          ...CodeSnippet.join(resultParts),
        });

        remainingTokensM.set(clause, remainingTokens);
        return clause;
      }

      return null;
    }
  }
}

function debugTokens(tokens) {
  return elideString(tokens.map((t) => t.debugString()).join(" "), 500);
}

function elideString(string, maxLength) {
  if (string.length < maxLength) return string;
  return string.slice(0, maxLength - 3) + "...";
}

function debugLog(...args) {
  // console.log(...args);
}
