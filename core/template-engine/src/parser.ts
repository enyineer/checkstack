import type {
  Expr,
  TemplateNode,
} from "./ast";
import { TemplateParseError, pointRange } from "./errors";
import { Tokenizer, type Token, type TokenKind } from "./tokenizer";
import type { ParsedCondition, ParsedTemplate, SourceRange } from "./types";

/**
 * Parse a template string — literal text interleaved with `{{ expr }}`
 * blocks — into a `ParsedTemplate` that can be rendered.
 */
export function parseTemplate(source: string): ParsedTemplate {
  const tokens = new Tokenizer(source).tokenize();
  const parser = new Parser(tokens, source);
  const nodes = parser.parseTemplateNodes();
  return { version: 1, nodes, source };
}

/**
 * Parse a single expression with no surrounding text. Used for conditions
 * (`when: "..."` fields, `condition` action guards, trigger filters).
 *
 * The input is the raw expression source — the parser does NOT expect or
 * accept surrounding `{{ }}`.
 */
export function parseCondition(source: string): ParsedCondition {
  // Wrap source so the tokenizer enters expression mode.
  const wrapped = `{{${source}}}`;
  const tokens = new Tokenizer(wrapped).tokenize();
  const parser = new Parser(tokens, wrapped);
  // Skip the synthesized EXPR_OPEN.
  parser.expect("EXPR_OPEN");
  const expr = parser.parseExpression();
  parser.expect("EXPR_CLOSE");
  return { version: 1, root: expr, source };
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parseTemplateNodes(): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (!this.eof()) {
      const t = this.peek();
      if (t.kind === "LITERAL") {
        this.advance();
        nodes.push({ kind: "text", value: t.value, range: t.range });
      } else if (t.kind === "EXPR_OPEN") {
        const start = t.range.start;
        this.advance();
        const expr = this.parseExpression();
        const close = this.expect("EXPR_CLOSE");
        nodes.push({
          kind: "expression",
          expression: expr,
          range: { start, end: close.range.end },
        });
      } else {
        throw new TemplateParseError({
          message: `Unexpected token ${t.kind} at top level`,
          source: this.source,
          range: t.range,
        });
      }
    }
    return nodes;
  }

  /**
   * Parse an expression with full operator precedence.
   *
   * Grammar (lowest precedence first):
   *
   *   expression := ternary
   *   ternary    := pipe ('?' expression ':' expression)?
   *   pipe       := or ('|' IDENT ('(' args ')')?)*
   *   or         := and ('||' and)*
   *   and        := eq ('&&' eq)*
   *   eq         := cmp (('==' | '!=') cmp)*
   *   cmp        := unary (('<' | '>' | '<=' | '>=') unary)*
   *   unary      := '!' unary | primary
   *   primary    := literal | identifier (member | index)* | '(' expression ')'
   */
  parseExpression(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const cond = this.parsePipe();
    if (this.match("QUESTION")) {
      const consequent = this.parseExpression();
      this.expect("COLON");
      const alternate = this.parseExpression();
      return {
        kind: "ternary",
        condition: cond,
        consequent,
        alternate,
        range: this.span(cond.range, alternate.range),
      };
    }
    return cond;
  }

  private parsePipe(): Expr {
    let value = this.parseOr();
    while (this.match("PIPE")) {
      const filterTok = this.expect("IDENT");
      const args: Expr[] = [];
      if (this.match("LPAREN")) {
        if (!this.check("RPAREN")) {
          args.push(this.parseExpression());
          while (this.match("COMMA")) {
            args.push(this.parseExpression());
          }
        }
        this.expect("RPAREN");
      }
      value = {
        kind: "pipe",
        value,
        filter: filterTok.value,
        args,
        range: this.span(
          value.range,
          args.length > 0 ? args.at(-1)!.range : filterTok.range,
        ),
      };
    }
    return value;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.check("OR")) {
      const opTok = this.advance();
      const right = this.parseAnd();
      left = {
        kind: "binary",
        op: "||",
        left,
        right,
        range: this.span(left.range, right.range),
      };
      void opTok;
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.check("AND")) {
      this.advance();
      const right = this.parseEquality();
      left = {
        kind: "binary",
        op: "&&",
        left,
        right,
        range: this.span(left.range, right.range),
      };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.check("EQ") || this.check("NEQ")) {
      const opTok = this.advance();
      const right = this.parseComparison();
      left = {
        kind: "binary",
        op: opTok.kind === "EQ" ? "==" : "!=",
        left,
        right,
        range: this.span(left.range, right.range),
      };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseUnary();
    while (
      this.check("LT") ||
      this.check("GT") ||
      this.check("LTE") ||
      this.check("GTE")
    ) {
      const opTok = this.advance();
      const right = this.parseUnary();
      const op =
        opTok.kind === "LT"
          ? "<"
          : opTok.kind === "GT"
            ? ">"
            : opTok.kind === "LTE"
              ? "<="
              : ">=";
      left = {
        kind: "binary",
        op,
        left,
        right,
        range: this.span(left.range, right.range),
      };
    }
    return left;
  }

  private parseUnary(): Expr {
    // Negation: the `!` operator OR the `not` keyword as a prefix. `not` is
    // tokenized as an identifier, so we accept it positionally here (a bare
    // leading `not`). The `not` FILTER (`value | not`) is a filter name parsed
    // after a PIPE and is unaffected; member access (`x.not`) is parsed after a
    // DOT and is likewise unaffected.
    const tok = this.peek();
    if (tok.kind === "NOT" || (tok.kind === "IDENT" && tok.value === "not")) {
      const opTok = this.advance();
      const operand = this.parseUnary();
      return {
        kind: "unary",
        op: "!",
        operand,
        range: this.span(opTok.range, operand.range),
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    // Member / index access chain
    while (this.check("DOT") || this.check("LBRACKET")) {
      if (this.match("DOT")) {
        const propTok = this.expect("IDENT");
        expr = {
          kind: "member",
          object: expr,
          property: propTok.value,
          range: this.span(expr.range, propTok.range),
        };
      } else {
        this.expect("LBRACKET");
        const indexExpr = this.parseExpression();
        const closeTok = this.expect("RBRACKET");
        expr = {
          kind: "index",
          object: expr,
          index: indexExpr,
          range: this.span(expr.range, closeTok.range),
        };
      }
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === "NUMBER") {
      this.advance();
      return { kind: "literal", value: Number(t.value), range: t.range };
    }
    if (t.kind === "STRING") {
      this.advance();
      return { kind: "literal", value: t.value, range: t.range };
    }
    if (t.kind === "TRUE") {
      this.advance();
      return { kind: "literal", value: true, range: t.range };
    }
    if (t.kind === "FALSE") {
      this.advance();
      return { kind: "literal", value: false, range: t.range };
    }
    if (t.kind === "NULL") {
      this.advance();
      return { kind: "literal", value: null, range: t.range };
    }
    if (t.kind === "IDENT") {
      this.advance();
      return { kind: "identifier", name: t.value, range: t.range };
    }
    if (t.kind === "LPAREN") {
      this.advance();
      const inner = this.parseExpression();
      this.expect("RPAREN");
      return inner;
    }
    throw new TemplateParseError({
      message: `Unexpected token ${t.kind} (${t.value || "EOF"}) in expression`,
      source: this.source,
      range: t.range.start.line === 0 ? pointRange(t.range.start) : t.range,
    });
  }

  // ─── Token utilities ─────────────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    const t = this.tokens[this.pos]!;
    this.pos += 1;
    return t;
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private match(kind: TokenKind): boolean {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new TemplateParseError({
        message: `Expected ${kind} but found ${t.kind}`,
        source: this.source,
        range: t.range,
      });
    }
    return this.advance();
  }

  private eof(): boolean {
    return this.peek().kind === "EOF";
  }

  private span(a: SourceRange, b: SourceRange): SourceRange {
    return { start: a.start, end: b.end };
  }
}
