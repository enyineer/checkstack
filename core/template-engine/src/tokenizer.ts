import { TemplateParseError, pointRange } from "./errors";
import type { SourcePosition, SourceRange } from "./types";

/**
 * Tokens produced by the template tokenizer.
 *
 * Templates are a sequence of LITERAL text segments interleaved with
 * `{{ ... }}` expression blocks. Inside an expression block the tokens
 * are typed (idents, literals, operators).
 */
export type TokenKind =
  // Top-level segments
  | "LITERAL"        // text outside {{ }}
  | "EXPR_OPEN"      // {{
  | "EXPR_CLOSE"     // }}
  // Inside an expression
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "TRUE"
  | "FALSE"
  | "NULL"
  | "DOT"
  | "COMMA"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "QUESTION"
  | "COLON"
  | "PIPE"
  | "EQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  | "AND"
  | "OR"
  | "NOT"
  | "EOF";

export interface Token {
  kind: TokenKind;
  value: string;
  range: SourceRange;
}

/**
 * Tokenizer state machine.
 *
 * Switches between "literal" mode (collecting raw text) and "expression"
 * mode (lexing identifiers, operators, etc.). The mode flips on `{{` and
 * back on `}}`.
 */
export class Tokenizer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private mode: "literal" | "expression" = "literal";

  constructor(private readonly source: string) {}

  /**
   * Drive the tokenizer to completion and return all tokens. Empty LITERAL
   * tokens are skipped — they add nothing but noise.
   */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      const token = this.next();
      if (token.kind === "LITERAL" && token.value.length === 0) continue;
      tokens.push(token);
    }
    tokens.push({
      kind: "EOF",
      value: "",
      range: pointRange(this.position()),
    });
    return tokens;
  }

  private next(): Token {
    if (this.mode === "literal") {
      return this.readLiteral();
    }
    return this.readExpression();
  }

  private readLiteral(): Token {
    const start = this.position();
    let value = "";
    while (this.pos < this.source.length) {
      // Check for {{ — start of expression
      if (this.peek() === "{" && this.peekAt(1) === "{") {
        if (value.length === 0) {
          // No literal before — emit EXPR_OPEN
          const openStart = this.position();
          this.advance();
          this.advance();
          this.mode = "expression";
          return {
            kind: "EXPR_OPEN",
            value: "{{",
            range: { start: openStart, end: this.position() },
          };
        }
        // Emit accumulated literal; next call will see {{
        return {
          kind: "LITERAL",
          value,
          range: { start, end: this.position() },
        };
      }
      value += this.peek();
      this.advance();
    }
    return {
      kind: "LITERAL",
      value,
      range: { start, end: this.position() },
    };
  }

  private readExpression(): Token {
    this.skipWhitespace();
    if (this.pos >= this.source.length) {
      throw new TemplateParseError({
        message: "Unterminated expression: missing closing `}}`",
        source: this.source,
        range: pointRange(this.position()),
      });
    }
    const start = this.position();

    // Closing braces }}
    if (this.peek() === "}" && this.peekAt(1) === "}") {
      this.advance();
      this.advance();
      this.mode = "literal";
      return {
        kind: "EXPR_CLOSE",
        value: "}}",
        range: { start, end: this.position() },
      };
    }

    const c = this.peek();

    // Numeric literal
    if (this.isDigit(c)) {
      return this.readNumber(start);
    }

    // String literal
    if (c === '"' || c === "'") {
      return this.readString(start, c);
    }

    // Identifier / keyword
    if (this.isIdentStart(c)) {
      return this.readIdentifier(start);
    }

    // Operators & punctuation
    return this.readOperator(start);
  }

  private readNumber(start: SourcePosition): Token {
    let value = "";
    while (this.pos < this.source.length && this.isDigit(this.peek())) {
      value += this.peek();
      this.advance();
    }
    if (this.peek() === "." && this.isDigit(this.peekAt(1) ?? "")) {
      value += ".";
      this.advance();
      while (this.pos < this.source.length && this.isDigit(this.peek())) {
        value += this.peek();
        this.advance();
      }
    }
    return {
      kind: "NUMBER",
      value,
      range: { start, end: this.position() },
    };
  }

  private readString(start: SourcePosition, quote: string): Token {
    this.advance(); // skip opening quote
    let value = "";
    while (this.pos < this.source.length && this.peek() !== quote) {
      if (this.peek() === "\\") {
        this.advance();
        const esc = this.peek();
        const escMap: Record<string, string> = {
          n: "\n",
          t: "\t",
          r: "\r",
          "\\": "\\",
          '"': '"',
          "'": "'",
        };
        value += escMap[esc] ?? esc;
        this.advance();
      } else {
        value += this.peek();
        this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw new TemplateParseError({
        message: "Unterminated string literal",
        source: this.source,
        range: { start, end: this.position() },
      });
    }
    this.advance(); // closing quote
    return {
      kind: "STRING",
      value,
      range: { start, end: this.position() },
    };
  }

  private readIdentifier(start: SourcePosition): Token {
    let value = "";
    while (this.pos < this.source.length && this.isIdentCont(this.peek())) {
      value += this.peek();
      this.advance();
    }
    const range = { start, end: this.position() };
    if (value === "true") return { kind: "TRUE", value, range };
    if (value === "false") return { kind: "FALSE", value, range };
    if (value === "null") return { kind: "NULL", value, range };
    return { kind: "IDENT", value, range };
  }

  private readOperator(start: SourcePosition): Token {
    const c = this.peek();
    const next = this.peekAt(1);

    const two = c + (next ?? "");
    const twoMap: Record<string, TokenKind> = {
      "==": "EQ",
      "!=": "NEQ",
      "<=": "LTE",
      ">=": "GTE",
      "&&": "AND",
      "||": "OR",
    };
    if (twoMap[two]) {
      this.advance();
      this.advance();
      return {
        kind: twoMap[two],
        value: two,
        range: { start, end: this.position() },
      };
    }

    const oneMap: Record<string, TokenKind> = {
      ".": "DOT",
      ",": "COMMA",
      "(": "LPAREN",
      ")": "RPAREN",
      "[": "LBRACKET",
      "]": "RBRACKET",
      "?": "QUESTION",
      ":": "COLON",
      "|": "PIPE",
      "<": "LT",
      ">": "GT",
      "!": "NOT",
    };
    if (oneMap[c]) {
      this.advance();
      return {
        kind: oneMap[c],
        value: c,
        range: { start, end: this.position() },
      };
    }

    throw new TemplateParseError({
      message: `Unexpected character "${c}" in expression`,
      source: this.source,
      range: pointRange(start),
    });
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  private peek(): string {
    return this.source[this.pos] ?? "";
  }

  private peekAt(offset: number): string | undefined {
    return this.source[this.pos + offset];
  }

  private advance(): void {
    const c = this.source[this.pos];
    this.pos += 1;
    if (c === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
  }

  private position(): SourcePosition {
    return { line: this.line, column: this.column };
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isIdentStart(c: string): boolean {
    return (
      (c >= "a" && c <= "z") ||
      (c >= "A" && c <= "Z") ||
      c === "_" ||
      c === "$"
    );
  }

  private isIdentCont(c: string): boolean {
    return this.isIdentStart(c) || this.isDigit(c);
  }
}
