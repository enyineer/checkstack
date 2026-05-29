import type { SourceRange } from "./types";

/**
 * AST node kinds for the expression sublanguage. Templates are made up of
 * `TextNode` + `ExpressionNode` at the top level; expressions form their
 * own tree of `Expr` nodes.
 */
export type TemplateNode = TextNode | ExpressionNode;

export interface TextNode {
  kind: "text";
  value: string;
  range: SourceRange;
}

export interface ExpressionNode {
  kind: "expression";
  expression: Expr;
  range: SourceRange;
}

/**
 * Expression AST. Discriminated union over `kind`. Every node carries a
 * source range for error reporting.
 */
export type Expr =
  | LiteralExpr
  | IdentifierExpr
  | MemberExpr
  | IndexExpr
  | TernaryExpr
  | BinaryExpr
  | UnaryExpr
  | PipeExpr;

export interface LiteralExpr {
  kind: "literal";
  value: string | number | boolean | null;
  range: SourceRange;
}

export interface IdentifierExpr {
  kind: "identifier";
  name: string;
  range: SourceRange;
}

export interface MemberExpr {
  kind: "member";
  object: Expr;
  property: string;
  range: SourceRange;
}

export interface IndexExpr {
  kind: "index";
  object: Expr;
  index: Expr;
  range: SourceRange;
}

export interface TernaryExpr {
  kind: "ternary";
  condition: Expr;
  consequent: Expr;
  alternate: Expr;
  range: SourceRange;
}

export type BinaryOp =
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "&&"
  | "||";

export interface BinaryExpr {
  kind: "binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
  range: SourceRange;
}

export interface UnaryExpr {
  kind: "unary";
  op: "!";
  operand: Expr;
  range: SourceRange;
}

export interface PipeExpr {
  kind: "pipe";
  value: Expr;
  filter: string;
  args: Expr[];
  range: SourceRange;
}
