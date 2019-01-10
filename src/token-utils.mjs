import moo from './moo.mjs'

const trimQuotes = str => str.slice(1, -1).replace(/\\(.)/g, '$1')
const toNumber = (str) => Number(str.replace(/_/g, ''))

const baseTokenizer = moo.states({
  main: {
    line: { match: /\n\s*/, lineBreaks: true },
    ignore: [
      { match: /(?: |\t)+/ },
      { match: '//', next: 'lineComment' },
      { match: '/*', next: 'blockComment' },
    ],
    value: [
      { match: /"(?:\\["\\]|[^\n"\\])*"/, value: trimQuotes },
      { match: /'(?:\\['\\]|[^\n'\\])*'/, value: trimQuotes },
      { match: /-?[0-9_]+(?:\.[0-9_]*)?(?:[eE]-?[0-9_])?/, value: toNumber },
      { match: /0x[0-9A-Fa-f_]+/, value: toNumber },
      { match: /0o[0-7_]+/, value: toNumber },
      { match: /0b[0-1_]+/, value: toNumber },
    ],
    identifier: { match: /[$_\p{ID_Start}][$\p{ID_Continue}]*/ },
    punctuation: { match: /[,;(){}[\]]/ },
    operator: { match: /[!@#%^&*\-+=|/:<>.?~]+/ },
  },
  lineComment: {
    ignore: { match: /[^\n]+/ },
    line: { match: /\n+\s*/, lineBreaks: true, next: 'main' },
  },
  blockComment: {
    ignore: [
      { match: /(?:\*[^/]|[^*])+/, lineBreaks: true },
      { match: '*/', next: 'main' },
    ],
  },
})

/**
 * @param {[String]} strs
 * @param {[Object]} interpolations
 */
export function tokenize (strs, interpolations, terminalMap = {}) {
  return skeletonize(tokenizeWithInterpolations(strs, interpolations), terminalMap)
}

function * tokenizeWithInterpolations (strs, interpolations) {
  let lastState
  for (const str of strs) {
    yield * baseTokenizer.reset(str, lastState)
    lastState = baseTokenizer.save()
    if (interpolations.length) {
      let value = interpolations.shift()
      // don't yield interpolated values in comments
      if (lastState.state === 'main') {
        yield { type: 'value', value }
      }
    }
  }
}

function skeletonize (tokens, terminalMap) {
  const stack = [{ value: [] }]
  let isConsolidatingLines = false
  for (const tok of tokens) {
    if (tok.type === 'ignore') { continue }
    if (tok.type === 'line') {
      if (isConsolidatingLines) { continue }
      isConsolidatingLines = true
    }
    isConsolidatingLines = false

    if (tok.type === 'value') {
      stack[stack.length - 1].value.push(tok)
    } else if (terminalMap[tok.value] === 'startToken') {
      stack.push({
        type: 'structure',
        value: [],
        offset: tok.offset,
        line: tok.line,
        col: tok.col,
        startToken: tok,
      })
    } else if (terminalMap[tok.value] === 'endToken') {
      const structure = stack.pop()
      structure.endToken = tok
      const top = stack[stack.length - 1]
      top.value.push(structure)
    } else {
      stack[stack.length - 1].value.push(tok)
    }
  }
  // TODO: error handling
  return stack[0].value
}
