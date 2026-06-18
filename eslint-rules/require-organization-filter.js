/**
 * @fileoverview 멀티테넌트 격리 강제 ESLint 규칙.
 *
 * tenant-scoped Firestore 도메인 파일에서 `query()` 호출이 속한 함수에
 * `where('organizationId', ...)` 제약이 하나도 없으면 에러로 보고한다.
 *
 * 프로젝트의 두 가지 쿼리 작성 방식 모두를 함수 스코프로 커버한다.
 *   1) 인라인:  query(coll(), where('organizationId', '==', orgId), where(...))
 *   2) 동적:    constraints.push(where('organizationId', '==', orgId)); query(coll(), ...constraints)
 * 두 경우 모두 같은 함수 본문 안에 where('organizationId', ...) 가 존재한다.
 *
 * 한계(의도된 트레이드오프): 한 함수가 여러 query()를 호출하고 그중 일부에만
 * org 필터가 필요한 경우는 통과시킨다(거짓음성). 거짓양성으로 정상 코드를 막아
 * 하드 게이트(CI lint)를 깨뜨리는 것보다 안전한 쪽을 택했다.
 */

const ORG_FIELD = 'organizationId'

/** 노드의 가장 가까운 함수 조상을 찾는다. */
function enclosingFunction(node) {
  let cur = node.parent
  while (cur) {
    if (
      cur.type === 'FunctionDeclaration' ||
      cur.type === 'FunctionExpression' ||
      cur.type === 'ArrowFunctionExpression'
    ) {
      return cur
    }
    cur = cur.parent
  }
  return null
}

/** 함수 본문 내에 where('organizationId', ...) 호출이 하나라도 있는지 AST로 확인한다. */
function hasOrgWhere(fnNode) {
  let found = false
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Identifier' &&
      n.callee.name === 'where' &&
      n.arguments.length > 0 &&
      n.arguments[0].type === 'Literal' &&
      n.arguments[0].value === ORG_FIELD
    ) {
      found = true
      return
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent') continue
      const child = n[key]
      if (Array.isArray(child)) {
        child.forEach((c) => c && typeof c.type === 'string' && visit(c))
      } else if (child && typeof child.type === 'string') {
        visit(child)
      }
    }
  }
  visit(fnNode)
  return found
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: '멀티테넌트 Firestore 쿼리에 organizationId 격리 필터를 강제한다',
    },
    schema: [],
    messages: {
      missingOrgFilter:
        "멀티테넌트 격리 위반: 이 query()가 속한 함수에 where('organizationId', ...) 필터가 없습니다. " +
        '조직 격리 조건을 추가하세요 (다른 기관 데이터 유출/권한 거부 위험). ' +
        '의도된 전역 쿼리라면 다음 줄 주석으로 사유와 함께 예외 처리하세요: ' +
        '// eslint-disable-next-line local/require-organization-filter -- <사유>',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'query') return
        const fn = enclosingFunction(node)
        if (!fn) return
        if (!hasOrgWhere(fn)) {
          context.report({ node, messageId: 'missingOrgFilter' })
        }
      },
    }
  },
}
