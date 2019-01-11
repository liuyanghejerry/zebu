import { nil, alt, seq, repeat, token, lit, wrappedWith, sepBy, left, right } from './parse-utils.mjs'
import { tag, createCompiler, createTTS } from './compiler-utils'

class MismatchedOperatorExpressionError extends Error {}
class UnknownRuleError extends Error {}
class ScopeNotDefinedError extends Error {}
class WrapCtxError extends Error {
  constructor (value, top, bottom) {
    super()
    this.message = `"${value}" cannot be used as both ${top} and ${bottom}`
  }
}

const id = (x) => x
const _2 = (_, x) => x
const list = (...xs) => xs

const drop = (p) => seq(() => null, p)
const dlit = (x) => drop(lit(x))
const asLeftFn = (fn) => (...xs) => (acc) => fn(acc, ...xs)
const asRightFn = (fn) => (...xs) => (acc) => fn(...xs, acc)

const line = token('line')
const ignoreLines = drop(alt(line, nil))
const wrapIgnoreLines = (parser) => seq(_2, alt(line, nil), parser, alt(line, nil))
const op = (str) => wrapIgnoreLines(dlit(str))

const terminal = seq(tag('literal'), token('value'))

const mapFn = seq(_2, dlit(':'), token('value'))

const baseExpr = alt(
  wrappedWith('(', () => expr, ')'),
  seq(tag('wrapped'), wrappedWith(
    '[', () => seq(list, token('value'), sepExpr, token('value'), alt(mapFn, nil)), ']'
  )),
  seq(tag('include'), dlit('include'), token('value')),
  seq(tag('identifier'), token('identifier')),
  terminal
)

// prefix and postfix operators, mutually exclusive
const postExpr = alt(
  seq(tag('repeat0'), baseExpr, dlit('*')),
  seq(tag('repeat1'), baseExpr, dlit('+')),
  seq(tag('maybe'), baseExpr, dlit('?')),
  baseExpr
)

// Expr / "," -> Expr, Expr, Expr ...
const sepExpr = alt(
  seq(tag('sepByMaybe'), postExpr, dlit('**'), postExpr),
  seq(tag('sepBy'), postExpr, dlit('++'), postExpr),
  postExpr
)
const seqExpr = seq(
  tag('seq'),
  repeat(sepExpr, 1), alt(seq(_2, ignoreLines, mapFn), nil)
)

const altExpr = seq(tag('alt'), sepBy(seqExpr, op('|')))
// AddExpr = < . "+" MultExpr >
const infixExpr = alt(
  seq(tag('leftInfix'),
    dlit('<'), dlit('.'), repeat(sepExpr, 1), dlit('>'), mapFn),
  seq(tag('rightInfix'),
    dlit('<'), repeat(sepExpr, 1), dlit('.'), dlit('>'), mapFn),
)
const expr = alt(
  seq(
    tag('altInfix'),
    sepBy(infixExpr, op('|')),
    drop(op('|')), altExpr,
  ),
  altExpr
)
const rule = seq(tag('rule'), token('identifier'), dlit('='), expr)

const program = alt(
  seq(tag('program'), wrapIgnoreLines(sepBy(rule, line))),
  seq(tag('rootExpr'), wrapIgnoreLines(expr)),
  seq(tag('nil'), wrapIgnoreLines(nil))
)

const compileTerminal = (parser) => (value) => (value && value.parse) ? value : parser(value)

const baseScope = {
  line: token('line'),
  value: token('value'),
  identifier: token('identifier'),
  operator: token('operator'),
  nil: nil,
}

const compiler = createCompiler({
  program: (rules, ctx) => {
    const firstRuleID = rules[0][1]
    ctx.scope = { ...baseScope }
    // iterate through rules bottom-to-top
    for (let i = rules.length - 1; i >= 0; i--) {
      ctx.eval(rules[i])
    }
    return createTTS(ctx.scope[firstRuleID])
  },
  rootExpr: (expr, ctx) => {
    ctx.scope = { ...baseScope }
    return createTTS(ctx.eval(expr))
  },
  nil: () => createTTS(nil),
  rule: (name, rule, ctx) => {
    ctx.scope[name] = ctx.eval(rule)
  },
  altInfix: (ts, base, ctx) => {
    base = ctx.eval(base)
    const hTag = ts[0][0]
    const asInfixFn = hTag === 'leftInfix' ? asLeftFn : asRightFn

    const seqs = []
    for (const [tTag, tSeq, tFn] of ts) {
      if (tTag !== hTag) { throw new MismatchedOperatorExpressionError(tag) }
      seqs.push(seq(asInfixFn(tFn), ...tSeq.map(ctx.eval)))
    }
    if (hTag === 'leftInfix') {
      return seq(
        (init, fns) => fns.reduce((acc, fn) => fn(acc), init),
        base, repeat(alt(...seqs), 0)
      )
    } else {
      return seq(
        (fns, init) => fns.reduceRight((acc, fn) => fn(acc), init),
        repeat(alt(...seqs), 0), base
      )
    }
  },
  leftInfix: (xs, fn, ctx, base) =>
    left(fn, ctx.eval(base), ...xs.map(ctx.eval)),
  rightInfix: (xs, fn, ctx, base) =>
    right((p) => alt(seq(fn, ...xs.map(ctx.eval), p), ctx.eval(base))),
  alt: (xs, ctx) => alt(...xs.map(ctx.eval)),
  seq: (exprs, fn = id, ctx) => seq(fn, ...exprs.map(ctx.eval)),
  sepByMaybe: (expr, sep, ctx) => {
    sep = ctx.eval(sep)
    return alt(sepBy(
      ctx.eval(expr),
      seq(id, alt(sep, seq(_2, ignoreLines, sep)), ignoreLines)
    ), seq(() => [], nil))
  },
  sepBy: (expr, sep, ctx) => {
    sep = ctx.eval(sep)
    return sepBy(
      ctx.eval(expr),
      seq(id, alt(sep, seq(_2, ignoreLines, sep)), ignoreLines)
    )
  },
  repeat0: (expr, ctx) => repeat(ctx.eval(expr), 0),
  repeat1: (expr, ctx) => repeat(ctx.eval(expr), 1),
  maybe: (expr, ctx) => alt(ctx.eval(expr), nil),
  wrapped: ([start, content, end], ctx) =>
    wrappedWith(
      start,
      () => wrapIgnoreLines(ctx.eval(content)),
      end,
    ),
  identifier: (name, ctx) => {
    if (!ctx.scope) { throw new ScopeNotDefinedError(name) }
    const rule = ctx.scope[name]
    if (!rule) {
      throw new UnknownRuleError(name)
    }
    return rule
  },
  include: (getParser, ctx) => getParser(ctx.scope),
  token: compileTerminal(token),
  literal: compileTerminal(lit),
})

export const lang = createTTS(seq(compiler, program))

export function test_lang_nil_language (expect) {
  const nil = lang``
  expect(nil`
  `).toEqual(undefined)
}

export function test_lang_single_expression (expect) {
  const num = lang`"return" value : ${(_, x) => x}`
  expect(num`return 123`).toEqual(123)
}

export function test_lang_recursive_rules (expect) {
  const math = lang`
    Neg   = "-" Expr      : ${(_, value) => -value}
          | Expr
    Expr  = ["(" Neg ")"  : ${(_, x) => x}]
          | value
  `
  expect(math`123`).toEqual(123)
  expect(math`-123`).toEqual(-123)
  expect(math`(123)`).toEqual(123)
  expect(math`-(-(123))`).toEqual(123)
}

export function test_lang_recursive_rule_errors (expect) {
  expect(() => { lang`Rule = ["( value "("]` }).toThrow()
  expect(() => {
    lang`
      Root = ["( Value ")"]
      Value = "("
    `
  }).toThrow()
}

export function test_lang_repeaters (expect) {
  const list = lang`
    Expr  = ["(" Expr* ")"]
          | identifier
  `
  expect(list`(foo bar (baz quux) xyzzy)`)
    .toEqual(['foo', 'bar', ['baz', 'quux'], 'xyzzy'])

  const nonEmptyList = lang`
    Expr  = ["(" Expr+ ")"]
          | identifier
  `
  expect(nonEmptyList`(foo bar (baz quux) xyzzy)`)
    .toEqual(['foo', 'bar', ['baz', 'quux'], 'xyzzy'])
  expect(() => nonEmptyList`()`).toThrow()
}

export function test_lang_operator_precedence_assoc (expect) {
  const math = lang`
    AddExpr = < . (line? "+") MulExpr > : ${(l, _, r) => l + r}
            | < . (line? "-") MulExpr > : ${(l, _, r) => l - r}
            | MulExpr
    MulExpr = < . (line? "*") PowNeg >  : ${(l, _, r) => l * r}
            | < . (line? "/") PowNeg >  : ${(l, _, r) => l / r}
            | PowNeg
    PowNeg  = NegExpr 
            | PowExpr
    NegExpr = "-" Expr                  : ${(_, x) => -x}
    PowExpr = < Expr (line? "**") . >   : ${(l, _, r) => l ** r}
            | Expr
    Expr    = ["(" AddExpr ")"] 
            | value
  `
  expect(math`3 * 4 / 5 * 6`).toEqual((3 * 4) / 5 * 6)
  expect(math`3 * (4 / 5) * 6`).toEqual(3 * (4 / 5) * 6)
  expect(math`1 
    + 2 
    * 3 
    - 4`).toEqual(1 + (2 * 3) - 4)
  expect(math`2 ** 3 ** 2`).toEqual(2 ** (3 ** 2))
}

export function test_lang_maybe (expect) {
  const trailingCommas = lang`value "," value ","? : ${(a, _, b) => [a, b]}`
  expect(trailingCommas`1, 2`).toEqual([1, 2])
  expect(trailingCommas`1, 2,`).toEqual([1, 2])
}

export function test_lang_with_line_separators (expect) {
  const lines = lang`value+ ++ line`
  const text = lines`
    1 2 
  
    3 4
  `
  expect(text).toEqual([[1, 2], [3, 4]])
}

export function test_interpolated_parser (expect) {
  const num = lang`value`
  const list = lang`${num}+`
  expect(list`1 2 3`).toEqual([1, 2, 3])
}
