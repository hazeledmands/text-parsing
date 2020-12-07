import _ from "lodash";
import fs from "fs";
import chalk from "chalk";

export class CodeLocation {
  constructor({ file, ln, col }) {
    Object.assign(this, { file, ln, col });
  }
}

export class CodeSnippet {
  constructor({ start, end }) {
    if (start.file !== end.file) {
      throw new Error(
        "Attempted to create a code snippet between two distinct files"
      );
    }
    Object.assign(this, { file: start.file, start, end });
  }

  toString() {
    return this.read();
  }

  read() {
    return this.file.read(this.start, this.end);
  }

  static join(snippets) {
    const files = _.map(snippets, "file");
    if (_.uniq(files) > 1)
      throw new Error("Can't join code snippets from multiple files!");

    const [start] = _.map(snippets, "start").sort((a, b) =>
      a.ln == b.ln ? a.col - b.col : a.ln - b.ln
    );
    const [end] = _.map(snippets, "end").sort((b, a) =>
      a.ln == b.ln ? a.col - b.col : a.ln - b.ln
    );

    return new CodeSnippet({ file: _.first(files), start, end });
  }
}

export class File {
  constructor(file) {
    Object.assign(this, file);
  }

  read(startLocation, endLocation) {
    let result = "";
    for (let i = startLocation.ln - 1; i < endLocation.ln; ++i) {
      const start = i === startLocation.ln - 1 ? startLocation.col - 1 : 0;
      const end =
        i === endLocation.ln - 1 ? endLocation.col - 1 : this.lines[i].length;
      result += this.lines[i].slice(start, end);
    }
    return result;
  }

  static async loadFrom(filepath) {
    process.stdout.write(`Reading from ${chalk.red(filepath)}. `);
    const code = fs.readFileSync(filepath, { encoding: "utf-8" });
    const lines = code.split("\n");
    process.stdout.write(`${code.length} chars, ${lines.length} lines.\n`);
    return new File({ path: filepath, lines, code });
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
