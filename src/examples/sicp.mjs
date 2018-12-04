import { lang } from '../root-language'

const _eval = (ctx, { type, value }) => ({
  value: () => value,
  expr: () => _eval(ctx, value[0])(ctx, value.slice(1)),
  identifier: () => ctx[value],
})[type]()

const lispInterpreter = (exprs) => (initCtx = baseCtx) =>
  exprs.reduce(({ ctx }, expr) => _eval(ctx, expr), initCtx)

const asValue = ({ value }) => ({ type: 'value', value })

export const sicp = lang`
    Prog = Expr * ${lispInterpreter}
    Expr = ~":" Expr ${asValue}
         | ~"(" Expr* ")" ${(value) => ({ type: 'expr', value })}
         | string   ${asValue}
         | number   ${asValue}
         | function ${asValue} # interpolate JS fns as macros,
         | identifier          # returning { ctx, value }
    Ident = identifier | (!") 
`

const fn = (f) => (ctx, ...args) => ({ ctx, value: f(...args) })
const def = (ctx, name, value) => {
  ctx[name] = value // NOTE: mutates current scope
  return { ctx }
}

const baseCtx = sicp`
    (${(ctx) => def(ctx, 'def', def)}) ; def "def"
    (def car ${fn(([x]) => x)})
    (def cdr ${fn(([_, ...xs]) => xs)})
    (def cons ${fn((l, r) => [l, ...r])})
`({}).ctx
